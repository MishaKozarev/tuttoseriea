import "server-only";
import type { Pool, PoolClient } from "pg";
import { getDbPool } from "../db";
import { FootballLocalizationRepository } from "../football/localization-repository";
import { getCoachesByIds, getLastKnownTeamCoach } from "../football/coaches-repository";
import { resolveFootballProperName } from "../football/localization";
import type { CoachSource, LastKnownTeamCoach } from "../football/coaches";
import type { FootballCoachesQuery } from "./football-coaches";

type Queryable = Pick<Pool | PoolClient, "query">;
export type CoachClubObservation = {
  clubId: string; displayName: string; snapshots: number;
  sources: (Pick<CoachSource, "matchId" | "lineupObservedAt"> & { kickoffAt: string | null; status: string })[];
  lastKnown: LastKnownTeamCoach;
};
type ObservationRow = {
  club_id: string; provider_name: string; name_ru: string | null; name_ru_review_status: string | null;
  snapshots: number; match_id: string; kickoff_at: Date | null; observed_at: Date; status: string;
};
export async function readAdminCoachObservations(db: Queryable, coachId: string, asOf: Date): Promise<CoachClubObservation[]> {
  // Current saved snapshots are evidence, not career history. A missing FK may resolve by
  // exact provider identity; contradictory references must never become another Coach's evidence.
  const rows = (await db.query<ObservationRow>(`
    with observations as (
      select c.id as club_id,c.provider_name,c.name_ru,c.name_ru_review_status,
        m.id as match_id,m.kickoff_at,m.status,l.observed_at,
        count(*) over(partition by c.id)::int as snapshots,
        dense_rank() over(partition by c.id order by m.kickoff_at desc nulls last) as position
      from football.coaches coach join football.matches m on m.provider=coach.provider
      join football.match_lineups l on l.match_id=m.id and l.provider_coach_id=coach.provider_coach_id
        and (l.coach_id=coach.id or l.coach_id is null)
      join football.clubs c on c.id=l.club_id and c.provider=m.provider
      where coach.id=$1 and l.club_id in (m.home_club_id,m.away_club_id)
    ) select * from observations where position=1 order by lower(provider_name),club_id,match_id`, [coachId])).rows;
  const clubs = new Map<string, CoachClubObservation>();
  for (const row of rows) {
    let club = clubs.get(row.club_id);
    if (!club) {
      club = { clubId: row.club_id, displayName: resolveFootballProperName({ providerName: row.provider_name,
        nameRu: row.name_ru, reviewStatus: row.name_ru_review_status }), snapshots: row.snapshots, sources: [],
        lastKnown: await getLastKnownTeamCoach(db, row.club_id, asOf) };
      clubs.set(row.club_id, club);
    }
    club.sources.push({ matchId: row.match_id, kickoffAt: row.kickoff_at?.toISOString() ?? null,
      lineupObservedAt: row.observed_at.toISOString(), status: row.status });
  }
  return [...clubs.values()];
}
export async function readFootballCoaches(db: Queryable, filter: FootballCoachesQuery) {
  const checkedAt = (await db.query<{ checked_at: Date }>("select now() as checked_at")).rows[0].checked_at;
  const localization = new FootballLocalizationRepository(db);
  const page = await localization.list({ ...filter, kind: "coaches" });
  const cards = await getCoachesByIds(db, [...page.items.map((item) => item.id), ...(filter.id ? [filter.id] : [])]);
  const photo = (id: string) => cards.find((card) => card.id === id)?.providerPhotoUrl ?? null;
  const entity = filter.id ? await localization.get("coaches", filter.id) : null;
  const facts = entity ? (await db.query<{ provider_coach_id: number; name_source_match_id: string; photo_source_match_id: string | null }>(
    "select provider_coach_id,name_source_match_id,photo_source_match_id from football.coaches where id=$1", [entity.id])).rows[0] : null;
  return { checkedAt, page: { ...page, items: page.items.map((item) => ({ ...item, providerPhotoUrl: photo(item.id) })) },
    detail: entity && facts ? { entity, providerPhotoUrl: photo(entity.id), providerCoachId: facts.provider_coach_id,
      nameSourceMatchId: facts.name_source_match_id, photoSourceMatchId: facts.photo_source_match_id,
      observations: await readAdminCoachObservations(db, entity.id, checkedAt) } : null };
}
export type FootballCoachesModel = Awaited<ReturnType<typeof readFootballCoaches>>;
export async function loadFootballCoaches(filter: FootballCoachesQuery): Promise<FootballCoachesModel> {
  const client = await getDbPool().connect();
  try {
    await client.query("begin isolation level repeatable read read only");
    const data = await readFootballCoaches(client, filter);
    await client.query("commit"); return data;
  } catch (error) { await client.query("rollback"); throw error; }
  finally { client.release(); }
}
