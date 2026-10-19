import { createHash, randomUUID } from "node:crypto";
import type { CoachRow, CoachSnapshot, CoachProfileFacts } from "./coaches";
import { projectCoachProfile, usableCoachName, usableCoachPhoto } from "./coaches";
import { getCoachesByIds, getLastKnownTeamCoach, lockCoachMatch, type CoachQueryable } from "./coaches-repository";
import { reconcileLockedLineupCoaches } from "./lineup-coaches-reconciliation";
import { API_FOOTBALL_PROVIDER, SERIE_A_CURRENT_SEASON, SERIE_A_PROVIDER_LEAGUE_ID } from "./foundation";

export const COACH_PLAN_MAX_MATCHES = 380;
export const COACH_PLAN_BATCH_SIZE = 50;
export type CoachOperatorStage = "local" | "staging";
export type CoachOperatorTarget = { stage: CoachOperatorStage; database: string };
export type CoachPlanPass = "profiles" | "links";
export class CoachReconciliationError extends Error {
  constructor(readonly code: string) { super(code); this.name = "CoachReconciliationError"; }
}
export function requireCoachCondition(value: unknown, code: string): asserts value {
  if (!value) throw new CoachReconciliationError(code);
}
export const coachUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  return JSON.stringify(value);
}
export function coachPlanHash(value: unknown): string { return createHash("sha256").update(canonical(value)).digest("hex"); }

type SourceLineup = CoachSnapshot & { id: string; clubId: string; coachId: string | null };
type SourceMatch = { id: string; fingerprint: string; kickoffAt: Date | null; clubIds: string[]; lineups: SourceLineup[] };
type SourceCoach = CoachRow & { name_source_at: Date | null; photo_source_at: Date | null };
type Conflict = { matchId: string; providerCoachId: number; fields: ("name" | "photo")[] };
type ManifestMatch = { id: string; fingerprint: string; lineups: { id: string; providerCoachId: number | null; coachId: string | null }[] };
export type CoachReconciliationManifest = {
  version: 1; planId: string; createdAt: string; target: CoachOperatorTarget;
  scope: { provider: string; league: number; season: number };
  batchSize: 50; batchCount: number; matches: ManifestMatch[];
  baselineCoaches: { id: string; providerCoachId: number; nameRu: string | null; reviewStatus: string | null; revision: number }[];
  forecast: { createCoaches: number; updateProfiles: number; linkLineups: number; alreadyLinked: number;
    missingProviderId: number; missingProfileName: number; conflicts: Conflict[]; contradictions: string[] };
  hash: string;
};

// Caller owns a transaction; READ ONLY + REPEATABLE READ for plan/verification, locked Match for apply.
async function readSources(db: CoachQueryable, ids?: readonly string[]): Promise<SourceMatch[]> {
  const result = await db.query<{ id: string; kickoff_at: Date | null; home_club_id: string; away_club_id: string;
    lineups: SourceLineup[]; evidence: unknown }>(`
    select m.id,m.kickoff_at,m.home_club_id,m.away_club_id,
      (select jsonb_agg(jsonb_build_object('id',l.id,'clubId',l.club_id,'coachId',l.coach_id,
        'providerCoachId',l.provider_coach_id,'providerCoachName',l.provider_coach_name,
        'providerCoachPhotoUrl',l.provider_coach_photo_url) order by l.provider_coach_id nulls first,l.id)
        from football.match_lineups l where l.match_id=m.id) as lineups,
      jsonb_build_object('match',to_jsonb(m),'lineups',
        (select jsonb_agg((to_jsonb(l)-'coach_id') || jsonb_build_object('entries',
          (select coalesce(jsonb_agg(to_jsonb(e) order by e.id),'[]') from football.match_lineup_entries e where e.lineup_id=l.id)) order by l.id)
          from football.match_lineups l where l.match_id=m.id)) as evidence
    from football.matches m join football.seasons s on s.id=m.season_id
    join football.competitions c on c.id=s.competition_id
    where m.provider=$1 and s.provider=$1 and c.provider=$1 and c.provider_competition_id=$2
      and s.provider_season_year=$3 and ($4::text[] is null or m.id=any($4::text[]))
      and exists(select 1 from football.match_lineups l where l.match_id=m.id)
    order by m.kickoff_at desc nulls last,m.id limit 381`,
  [API_FOOTBALL_PROVIDER, SERIE_A_PROVIDER_LEAGUE_ID, SERIE_A_CURRENT_SEASON, ids ?? null]);
  requireCoachCondition(result.rows.length <= COACH_PLAN_MAX_MATCHES, "COACH_SCOPE_TOO_LARGE");
  if (ids) requireCoachCondition(result.rows.length === ids.length, "COACH_SCOPE_MISSING_OR_CHANGED");
  return result.rows.map((row) => {
    const clubIds = [row.home_club_id, row.away_club_id];
    requireCoachCondition(row.lineups.length <= 2 && row.lineups.every((l) => clubIds.includes(l.clubId)), "COACH_INVALID_PARTICIPANT");
    return { id: row.id, kickoffAt: row.kickoff_at, clubIds, lineups: row.lineups, fingerprint: coachPlanHash(row.evidence) };
  });
}
async function readCoaches(db: CoachQueryable, sources: readonly SourceMatch[]): Promise<SourceCoach[]> {
  const lineups = sources.flatMap((m) => m.lineups);
  return (await db.query<SourceCoach>(`select c.*,n.kickoff_at as name_source_at,p.kickoff_at as photo_source_at
    from football.coaches c join football.matches n on n.id=c.name_source_match_id
    left join football.matches p on p.id=c.photo_source_match_id
    where (c.provider=$1 and c.provider_coach_id=any($2::int[])) or c.id=any($3::text[]) order by c.provider_coach_id`,
  [API_FOOTBALL_PROVIDER, lineups.map((l) => l.providerCoachId).filter((id) => id !== null),
    lineups.map((l) => l.coachId).filter((id) => id !== null)])).rows;
}
function facts(coach: CoachProfileFacts): CoachProfileFacts {
  return { provider_name: coach.provider_name, provider_photo_url: coach.provider_photo_url,
    name_source_match_id: coach.name_source_match_id, photo_source_match_id: coach.photo_source_match_id };
}
export async function createCoachReconciliationPlan(db: CoachQueryable, target: CoachOperatorTarget, ids?: readonly string[]): Promise<CoachReconciliationManifest> {
  if (ids) requireCoachCondition(ids.length > 0 && ids.length <= COACH_PLAN_MAX_MATCHES && new Set(ids).size === ids.length && ids.every((id) => coachUuid.test(id)), "COACH_INVALID_SCOPE");
  const sources = await readSources(db, ids), existing = await readCoaches(db, sources);
  const dates = new Map<string, Date | null>();
  for (const coach of existing) {
    dates.set(coach.name_source_match_id, coach.name_source_at);
    if (coach.photo_source_match_id) dates.set(coach.photo_source_match_id, coach.photo_source_at);
  }
  for (const source of sources) dates.set(source.id, source.kickoffAt);
  const initial = new Map(existing.filter((c) => c.provider === API_FOOTBALL_PROVIDER).map((c) => [c.provider_coach_id, facts(c)]));
  const profiles = new Map(initial);
  const forecast: CoachReconciliationManifest["forecast"] = { createCoaches: 0, updateProfiles: 0, linkLineups: 0,
    alreadyLinked: 0, missingProviderId: 0, missingProfileName: 0, conflicts: [], contradictions: [] };
  for (const match of sources) for (const lineup of match.lineups) {
    const id = lineup.providerCoachId;
    if (lineup.coachId && !existing.some((c) => c.id === lineup.coachId && c.provider === API_FOOTBALL_PROVIDER && c.provider_coach_id === id)) forecast.contradictions.push(lineup.id);
    if (id === null) continue;
    let profile = profiles.get(id);
    const name = usableCoachName(lineup.providerCoachName), photo = usableCoachPhoto(lineup.providerCoachPhotoUrl);
    if (!profile && name) {
      profile = { provider_name: name, provider_photo_url: photo, name_source_match_id: match.id, photo_source_match_id: photo ? match.id : null };
      forecast.createCoaches++;
    }
    if (!profile) continue;
    const next = projectCoachProfile(profile, lineup, match.id, match.kickoffAt,
      dates.get(profile.name_source_match_id) ?? null, dates.get(profile.photo_source_match_id!) ?? null);
    profiles.set(id, next.facts);
    if (next.conflicts.length) forecast.conflicts.push({ matchId: match.id, providerCoachId: id, fields: next.conflicts });
  }
  for (const [id, profile] of profiles) if (initial.has(id) && coachPlanHash(initial.get(id)) !== coachPlanHash(profile)) forecast.updateProfiles++;
  // Final link forecast includes ID-only rows resolved by named observations in later batches.
  for (const lineup of sources.flatMap((m) => m.lineups)) {
    if (lineup.coachId) forecast.alreadyLinked++;
    else if (lineup.providerCoachId === null) forecast.missingProviderId++;
    else if (!profiles.has(lineup.providerCoachId)) forecast.missingProfileName++;
    else forecast.linkLineups++;
  }
  const body: Omit<CoachReconciliationManifest, "hash"> = {
    version: 1, planId: randomUUID(), createdAt: new Date().toISOString(), target,
    scope: { provider: API_FOOTBALL_PROVIDER, league: SERIE_A_PROVIDER_LEAGUE_ID, season: SERIE_A_CURRENT_SEASON },
    batchSize: COACH_PLAN_BATCH_SIZE, batchCount: Math.ceil(sources.length / COACH_PLAN_BATCH_SIZE),
    matches: sources.map((m) => ({ id: m.id, fingerprint: m.fingerprint,
      lineups: m.lineups.map((l) => ({ id: l.id, providerCoachId: l.providerCoachId, coachId: l.coachId })) })),
    baselineCoaches: existing.filter((c) => c.provider === API_FOOTBALL_PROVIDER).map((c) => ({ id: c.id,
      providerCoachId: c.provider_coach_id, nameRu: c.name_ru, reviewStatus: c.name_ru_review_status, revision: c.localization_revision })), forecast,
  };
  return { ...body, hash: coachPlanHash(body) };
}

export function validateCoachManifest(input: unknown, target: CoachOperatorTarget): CoachReconciliationManifest {
  requireCoachCondition(input && typeof input === "object" && !Array.isArray(input), "COACH_INVALID_MANIFEST");
  const value = input as CoachReconciliationManifest;
  requireCoachCondition(value.version === 1 && value.target?.stage === target.stage && value.target.database === target.database &&
    value.scope?.provider === API_FOOTBALL_PROVIDER && value.scope.league === SERIE_A_PROVIDER_LEAGUE_ID && value.scope.season === SERIE_A_CURRENT_SEASON &&
    value.batchSize === COACH_PLAN_BATCH_SIZE && Array.isArray(value.matches) && value.matches.length <= COACH_PLAN_MAX_MATCHES &&
    value.batchCount === Math.ceil(value.matches.length / COACH_PLAN_BATCH_SIZE) && coachUuid.test(value.planId) && Number.isFinite(Date.parse(value.createdAt)) &&
    Array.isArray(value.baselineCoaches) && value.baselineCoaches.length <= 760 && value.forecast && Array.isArray(value.forecast.conflicts) &&
    Array.isArray(value.forecast.contradictions) && /^[a-f0-9]{64}$/.test(value.hash), "COACH_INVALID_MANIFEST");
  const { hash, ...body } = value;
  requireCoachCondition(hash === coachPlanHash(body), "COACH_MANIFEST_HASH_MISMATCH");
  requireCoachCondition(Object.keys(value).every((key) => ["version", "planId", "createdAt", "target", "scope", "batchSize", "batchCount", "matches", "baselineCoaches", "forecast", "hash"].includes(key)) &&
    new Date(value.createdAt).toISOString() === value.createdAt && value.baselineCoaches.every((c) => coachUuid.test(c.id) &&
      Number.isInteger(c.providerCoachId) && c.providerCoachId > 0 && (c.nameRu === null || typeof c.nameRu === "string") &&
      (c.reviewStatus === null || ["unreviewed", "reviewed"].includes(c.reviewStatus)) && Number.isInteger(c.revision) && c.revision >= 0) &&
    ["createCoaches", "updateProfiles", "linkLineups", "alreadyLinked", "missingProviderId", "missingProfileName"].every((key) => {
      const count = value.forecast[key as keyof typeof value.forecast]; return typeof count === "number" && Number.isInteger(count) && count >= 0 && count <= 760;
    }) && value.forecast.conflicts.length <= 760 && value.forecast.conflicts.every((c) => coachUuid.test(c.matchId) && Number.isInteger(c.providerCoachId) &&
      c.providerCoachId > 0 && Array.isArray(c.fields) && c.fields.length > 0 && c.fields.length <= 2 && c.fields.every((f) => f === "name" || f === "photo")) &&
    value.forecast.contradictions.length <= 760 && value.forecast.contradictions.every((id) => coachUuid.test(id)), "COACH_INVALID_MANIFEST");
  requireCoachCondition(new Set(value.matches.map((m) => m.id)).size === value.matches.length && value.matches.every((m) =>
    coachUuid.test(m.id) && /^[a-f0-9]{64}$/.test(m.fingerprint) && Array.isArray(m.lineups) && m.lineups.length <= 2 &&
    m.lineups.every((l) => coachUuid.test(l.id) && (l.providerCoachId === null || Number.isInteger(l.providerCoachId) && l.providerCoachId > 0) &&
      (l.coachId === null || coachUuid.test(l.coachId)))), "COACH_INVALID_MANIFEST");
  return value;
}
function assertSources(sources: readonly SourceMatch[], manifest: CoachReconciliationManifest) {
  for (const match of sources) {
    const expected = manifest.matches.find((m) => m.id === match.id);
    requireCoachCondition(expected && expected.fingerprint === match.fingerprint && expected.lineups.length === match.lineups.length && match.lineups.every((lineup) => {
      const before = expected.lineups.find((l) => l.id === lineup.id);
      return before && before.providerCoachId === lineup.providerCoachId && (!before.coachId || before.coachId === lineup.coachId);
    }), "COACH_SOURCE_DRIFT");
  }
}

// One invocation processes <=50 Matches. Each Match commits independently, with an explicit progress callback.
export async function applyCoachManifestBatch(db: CoachQueryable, manifest: CoachReconciliationManifest, target: CoachOperatorTarget,
  pass: CoachPlanPass, batch: number, confirmedHash: string, progress: (value: unknown) => void = () => {}) {
  validateCoachManifest(manifest, target);
  requireCoachCondition(confirmedHash === manifest.hash, "COACH_EXPLICIT_CONFIRMATION_REQUIRED");
  requireCoachCondition((pass === "profiles" || pass === "links") && Number.isInteger(batch) && batch >= 1 && batch <= manifest.batchCount, "COACH_INVALID_BATCH");
  requireCoachCondition(manifest.forecast.contradictions.length === 0, "COACH_CONTRADICTORY_REFERENCE");
  const selected = manifest.matches.slice((batch - 1) * COACH_PLAN_BATCH_SIZE, batch * COACH_PLAN_BATCH_SIZE);
  const completed: string[] = []; let createdCoaches = 0, linkedLineups = 0;
  for (const match of selected) {
    await db.query("begin isolation level read committed");
    try {
      await db.query("set local lock_timeout='5s'"); await db.query("set local time zone 'UTC'");
      await lockCoachMatch(db, match.id);
      const current = await readSources(db, [match.id]); assertSources(current, manifest);
      const results = await reconcileLockedLineupCoaches(db, match.id, pass === "links");
      for (const result of results) {
        const before = manifest.baselineCoaches.find((c) => c.providerCoachId === result.providerCoachId);
        requireCoachCondition(!before || before.id === result.coachId, "COACH_IDENTITY_DRIFT");
        requireCoachCondition(result.conflicts.every((field) => manifest.forecast.conflicts.some((c) => c.matchId === match.id &&
          c.providerCoachId === result.providerCoachId && c.fields.includes(field as "name" | "photo"))), "COACH_NEW_PROFILE_CONFLICT");
      }
      await db.query("commit"); completed.push(match.id);
      createdCoaches += results.filter((r) => r.created).length; linkedLineups += results.filter((r) => r.linked).length;
      progress({ event: "match_committed", planHash: manifest.hash, pass, batch, matchId: match.id,
        createdCoaches: results.filter((r) => r.created).length, linkedLineups: results.filter((r) => r.linked).length });
    } catch (error) {
      await db.query("rollback");
      progress({ event: "batch_stopped", planHash: manifest.hash, pass, batch, failedMatchId: match.id, completed }); throw error;
    }
  }
  return { pass, batch, completed, createdCoaches, linkedLineups };
}

export async function verifyCoachManifest(db: CoachQueryable, manifest: CoachReconciliationManifest, target: CoachOperatorTarget) {
  validateCoachManifest(manifest, target);
  const sources = manifest.matches.length ? await readSources(db, manifest.matches.map((m) => m.id)) : [];
  assertSources(sources, manifest);
  const coaches = await readCoaches(db, sources);
  const byProvider = new Map(coaches.filter((c) => c.provider === API_FOOTBALL_PROVIDER).map((c) => [c.provider_coach_id, c]));
  let linked = 0, newlyLinked = 0, remainingLinks = 0, missingProviderId = 0, missingProfileName = 0, contradictions = 0;
  for (const match of sources) for (const lineup of match.lineups) {
    const coach = lineup.providerCoachId === null ? undefined : byProvider.get(lineup.providerCoachId);
    if (lineup.coachId) {
      if (coach?.id !== lineup.coachId) contradictions++;
      else { linked++; if (!manifest.matches.find((m) => m.id === match.id)!.lineups.find((l) => l.id === lineup.id)!.coachId) newlyLinked++; }
    } else if (lineup.providerCoachId === null) missingProviderId++;
    else if (!coach) missingProfileName++;
    else remainingLinks++;
  }
  const missingCreatableProfiles = new Set(sources.flatMap((m) => m.lineups).filter((l) => l.providerCoachId !== null && usableCoachName(l.providerCoachName) && !byProvider.has(l.providerCoachId)).map((l) => l.providerCoachId)).size;
  const localizationChanged = manifest.baselineCoaches.filter((before) => {
    const after = byProvider.get(before.providerCoachId);
    return !after || after.id !== before.id || after.name_ru !== before.nameRu || after.name_ru_review_status !== before.reviewStatus || after.localization_revision !== before.revision;
  }).map((c) => c.id);
  const ids = [...byProvider.values()].map((c) => c.id);
  const teamProjections = [];
  for (const clubId of [...new Set(sources.flatMap((s) => s.clubIds))].sort()) teamProjections.push({ clubId,
    observation: await getLastKnownTeamCoach(db, clubId, new Date(manifest.createdAt)) });
  return { planHash: manifest.hash, complete: remainingLinks === 0 && missingCreatableProfiles === 0 && contradictions === 0 && localizationChanged.length === 0,
    sourcesUnchanged: true, matches: sources.length, snapshots: sources.reduce((n, m) => n + m.lineups.length, 0),
    newCoachesSincePlan: ids.filter((id) => !manifest.baselineCoaches.some((c) => c.id === id)).length,
    linked, newlyLinked, remainingLinks, missingProviderId, missingProfileName, contradictions, missingCreatableProfiles,
    localizationChangedSincePlan: localizationChanged, coaches: await getCoachesByIds(db, ids), teamProjections };
}
