import { taggedFootballUpsert } from "./tagged-upsert";
import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { API_FOOTBALL_PROVIDER, SERIE_A_CURRENT_SEASON, SERIE_A_PROVIDER_LEAGUE_ID } from "./foundation";
import { coachCard,
  type CoachCard, type CoachCandidate, type CoachRow, type CoachSnapshot, type LastKnownTeamCoach } from "./coaches";

export type CoachQueryable = Pick<Pool | PoolClient, "query">;
export type CoachMatch = { id: string; provider: string; kickoff_at: Date | null; in_scope: boolean };
type ExpectedMatch = { providerFixtureId: number; homeClub: { id: string }; awayClub: { id: string } };

// Caller owns a READ COMMITTED transaction. Both live persistence and repair lock Match first.
export async function lockCoachMatch(db: CoachQueryable, matchId: string, expected?: ExpectedMatch): Promise<CoachMatch> {
  const result = await db.query<CoachMatch & { provider_fixture_id: number; home_club_id: string; away_club_id: string; in_scope: boolean }>(`
    /* coach:lock-match */
    select m.id, m.provider, m.kickoff_at, m.provider_fixture_id, m.home_club_id, m.away_club_id,
      exists(select 1 from football.seasons s join football.competitions c on c.id=s.competition_id
        where s.id=m.season_id and s.provider=$2 and c.provider=$2
          and s.provider_season_year=$3 and c.provider_competition_id=$4) as in_scope
    from football.matches m where m.id=$1 for no key update of m`,
  [matchId, API_FOOTBALL_PROVIDER, SERIE_A_CURRENT_SEASON, SERIE_A_PROVIDER_LEAGUE_ID]);
  const row = result.rows[0];
  if (!row || row.provider !== API_FOOTBALL_PROVIDER || expected && (!row.in_scope ||
    row.provider_fixture_id !== expected.providerFixtureId || row.home_club_id !== expected.homeClub.id || row.away_club_id !== expected.awayClub.id)) {
    throw new Error("Coach source Match disappeared or changed canonical scope/participants");
  }
  return row;
}

export type CoachResolution = { id: string | null; created: boolean };
export async function resolveLineupCoach(db: CoachQueryable, match: CoachMatch, snapshot: CoachSnapshot): Promise<CoachResolution> {
  const providerId = snapshot.providerCoachId;
  if (providerId === null) return { id: null, created: false };
  if (!Number.isInteger(providerId) || providerId <= 0) throw new Error("Invalid Coach provider identity");
  const proposedId = randomUUID();
  // Atomic identity upsert also serializes with profile/localization writes. Lineups never
  // supply profile facts, even on the first insert or when the API profile is missing.
  const row = (await db.query<CoachRow>(taggedFootballUpsert("coaches", `
      /* coach:identity */
      insert into football.coaches as existing (id,provider,provider_coach_id)
      values($1,$2,$3)
      on conflict(provider,provider_coach_id) do update set id=existing.id returning *`),
    [proposedId, match.provider, providerId])).rows[0];
  return { id: row.id, created: row.id === proposedId };
}

export async function resolveCoachesForLineups<T extends CoachSnapshot>(db: CoachQueryable, matchId: string,
  lineups: readonly T[], expected?: ExpectedMatch): Promise<(T & { coachId: string | null })[]> {
  const match = await lockCoachMatch(db, matchId, expected);
  const resolved = new Map<T, string | null>();
  for (const lineup of [...lineups].sort((a, b) => (a.providerCoachId ?? 0) - (b.providerCoachId ?? 0))) {
    const result = await resolveLineupCoach(db, match, lineup);
    resolved.set(lineup, result.id);
  }
  return lineups.map((lineup) => ({ ...lineup, coachId: resolved.get(lineup) ?? null }));
}

export async function getCoachesByIds(db: CoachQueryable, ids: readonly string[]): Promise<CoachCard[]> {
  if (!ids.length) return [];
  return (await db.query<CoachRow>("select * from football.coaches where id=any($1::text[]) order by id", [[...new Set(ids)]])).rows.map(coachCard);
}
export async function getCoachById(db: CoachQueryable, id: string): Promise<CoachCard | null> {
  return (await getCoachesByIds(db, [id]))[0] ?? null;
}

export async function getLastKnownTeamCoach(db: CoachQueryable, clubId: string, asOf = new Date()): Promise<LastKnownTeamCoach> {
  type Observation = { provider: string; provider_coach_id: number; kickoff_at: string; match_id: string;
    observed_at: string; provider_coach_name: string | null; provider_coach_photo_url: string | null; coach: CoachRow | null };
  const result = await db.query<{ incomplete: boolean; observations: Observation[] }>(`
    with eligible as materialized (
      select m.provider,m.id as match_id,m.kickoff_at,l.observed_at,l.provider_coach_id,
        l.provider_coach_name,l.provider_coach_photo_url
      from football.match_lineups l join football.matches m on m.id=l.match_id
      join football.clubs c on c.id=l.club_id and c.provider=m.provider
      where l.club_id=$1 and m.status='finished' and l.club_id in (m.home_club_id,m.away_club_id)
    ), latest as (
      select * from eligible where provider_coach_id is not null and kickoff_at<= $2
        and kickoff_at=(select max(kickoff_at) from eligible where provider_coach_id is not null and kickoff_at<= $2)
    )
    select exists(select 1 from eligible where kickoff_at is null or kickoff_at>$2) as incomplete,
      coalesce((select jsonb_agg(jsonb_build_object('provider',l.provider,'provider_coach_id',l.provider_coach_id,
        'match_id',l.match_id,'kickoff_at',l.kickoff_at,'observed_at',l.observed_at,
        'provider_coach_name',l.provider_coach_name,'provider_coach_photo_url',l.provider_coach_photo_url,
        'coach',to_jsonb(c)) order by l.provider,l.provider_coach_id,l.match_id)
        from latest l left join football.coaches c on c.provider=l.provider and c.provider_coach_id=l.provider_coach_id),
        '[]'::jsonb) as observations`, [clubId, asOf]);
  const row = result.rows[0];
  const groups = new Map<string, CoachCandidate>();
  for (const observation of row.observations) {
    const key = `${observation.provider}/${observation.provider_coach_id}`;
    let candidate = groups.get(key);
    if (!candidate) {
      candidate = { provider: observation.provider, providerCoachId: observation.provider_coach_id,
        coach: observation.coach ? coachCard(observation.coach) : null, sources: [] };
      groups.set(key, candidate);
    }
    candidate.sources.push({ matchId: observation.match_id, kickoffAt: new Date(observation.kickoff_at).toISOString(),
      lineupObservedAt: new Date(observation.observed_at).toISOString(), providerCoachName: observation.provider_coach_name,
      providerCoachPhotoUrl: observation.provider_coach_photo_url });
  }
  const candidates = [...groups.values()];
  const common = { chronologyIncomplete: row.incomplete };
  if (candidates.length > 1) return { ...common, kind: "ambiguous", candidates };
  const candidate = candidates[0];
  if (!candidate) return { ...common, kind: "unknown" };
  return candidate.coach ? { ...common, kind: "known", candidate: { ...candidate, coach: candidate.coach } }
    : { ...common, kind: "unresolved", candidate };
}
