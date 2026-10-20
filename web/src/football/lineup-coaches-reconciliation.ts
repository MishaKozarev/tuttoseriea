import type { PoolClient } from "pg";
import { lockCoachMatch, resolveLineupCoach, type CoachQueryable } from "./coaches-repository";
import type { CoachSnapshot } from "./coaches";
import { API_FOOTBALL_PROVIDER, SERIE_A_CURRENT_SEASON, SERIE_A_PROVIDER_LEAGUE_ID } from "./foundation";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export function parseCoachReconciliationArguments(args: readonly string[]): { matchIds: string[]; apply: boolean } {
  const matchIds: string[] = []; let apply = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--apply" && !apply) apply = true;
    else if (args[i] === "--match-id" && uuid.test(args[i + 1] ?? "")) matchIds.push(args[++i]);
    else throw new Error("Use --match-id <canonical-uuid> (1..50 distinct Matches), optionally --apply");
  }
  if (!matchIds.length || matchIds.length > 50 || new Set(matchIds).size !== matchIds.length) throw new Error("Explicit scope must contain 1..50 distinct Matches");
  return { matchIds: matchIds.sort(), apply };
}
type StoredLineup = { id: string; coach_id: string | null; provider_coach_id: number | null;
  provider_coach_name: string | null; provider_coach_photo_url: string | null };
export async function reconcileLockedLineupCoaches(db: CoachQueryable, matchId: string) {
  const match = await lockCoachMatch(db, matchId);
  if (!match.in_scope) throw new Error("Reconciliation Match is outside current Serie A scope");
  const rows = (await db.query<StoredLineup>(`select id,coach_id,provider_coach_id,provider_coach_name,provider_coach_photo_url
    from football.match_lineups where match_id=$1 order by provider_coach_id nulls first,id`, [matchId])).rows;
  const results: { lineupId: string; providerCoachId: number | null; coachId: string | null; created: boolean; linked: boolean }[] = [];
  for (const row of rows) {
    const input: CoachSnapshot = { providerCoachId: row.provider_coach_id, providerCoachName: row.provider_coach_name,
      providerCoachPhotoUrl: row.provider_coach_photo_url };
    if (row.coach_id) {
      const existing = (await db.query("select id from football.coaches where id=$1 and provider=$2 and provider_coach_id=$3",
        [row.coach_id, match.provider, row.provider_coach_id])).rows[0];
      if (!existing) throw new Error("Existing Coach reference contradicts provider snapshot");
    }
    const resolved = await resolveLineupCoach(db, match, input);
    if (row.coach_id && resolved.id !== row.coach_id) throw new Error("Existing Coach reference changed unexpectedly");
    const linked = !row.coach_id && resolved.id !== null;
    if (linked) await db.query("update football.match_lineups set coach_id=$2 where id=$1 and coach_id is null", [row.id, resolved.id]);
    results.push({ lineupId: row.id, providerCoachId: row.provider_coach_id, coachId: resolved.id,
      created: resolved.created, linked });
  }
  return results;
}

export async function previewLineupCoaches(db: CoachQueryable, matchIds: readonly string[]) {
  // Caller uses a READ ONLY transaction. This preview has no creation/upsert path.
  return (await db.query(`select m.id as match_id, count(l.id)::int as snapshots,
      count(l.id) filter(where l.coach_id is null and l.provider_coach_id is not null)::int as unresolved_references,
      count(l.id) filter(where l.provider_coach_id is null)::int as missing_provider_ids
    from football.matches m join football.seasons s on s.id=m.season_id
    join football.competitions c on c.id=s.competition_id
    left join football.match_lineups l on l.match_id=m.id
    where m.id=any($1::text[]) and m.provider=$2 and s.provider=$2 and c.provider=$2
      and c.provider_competition_id=$3 and s.provider_season_year=$4 group by m.id order by m.id`,
  [matchIds, API_FOOTBALL_PROVIDER, SERIE_A_PROVIDER_LEAGUE_ID, SERIE_A_CURRENT_SEASON])).rows;
}

export async function applyLineupCoaches(client: PoolClient, matchId: string) {
  await client.query("begin isolation level read committed");
  try {
    await client.query("set local lock_timeout='5s'");
    const result = await reconcileLockedLineupCoaches(client, matchId);
    await client.query("commit");
    return result;
  } catch (error) { await client.query("rollback"); throw error; }
}
