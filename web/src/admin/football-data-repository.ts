import "server-only";
import type { Pool, PoolClient } from "pg";
import { getDbPool } from "../db";
import { API_FOOTBALL_PROVIDER, SERIE_A_CURRENT_SEASON, SERIE_A_PROVIDER_LEAGUE_ID, SERIE_A_MATCH_EVENTS_JOB_TYPE } from "../football/foundation";
import { listCurrentSerieAClubs } from "../football/repository";
import { getCurrentSerieAClubPageData } from "../football/club-page-repository";
import { listCurrentSerieAMatches } from "../football/matches-repository";
import { getCurrentSerieAMatchPageData } from "../football/match-page-repository";
import { listCurrentSerieAStandings } from "../football/standings-repository";
import { resolveFootballProperName } from "../football/localization";
import { quoteIdentifier } from "../jobs/config";
import { dataPage, includesDataQuery, FOOTBALL_DATA_PAGE_SIZE, type FootballDataQuery, type MatchDatasetEvidence, type DataPage } from "./football-data";

type Queryable = Pick<Pool | PoolClient, "query">;
const seasonSql = `select s.id from football.seasons s join football.competitions comp on comp.id=s.competition_id
  where comp.provider=$1 and comp.provider_competition_id=$2 and s.provider=$1 and s.provider_season_year=$3`;
const scope = [API_FOOTBALL_PROVIDER, SERIE_A_PROVIDER_LEAGUE_ID, SERIE_A_CURRENT_SEASON];
type NameRow = { provider_name: string; name_ru: string | null; name_ru_review_status: string | null };
const properName = (row: NameRow) => resolveFootballProperName({ providerName: row.provider_name, nameRu: row.name_ru, reviewStatus: row.name_ru_review_status });
export type AdminPlayer = {
  id: string; slug: string; provider: string; provider_player_id: number; provider_name: string;
  displayName: string; age: number | null; firstname: string | null; lastname: string | null;
  birth_date: string | null; birth_place: string | null; birth_country: string | null; nationality: string | null;
  height: string | null; weight: string | null; injured: boolean | null; publicEligible: boolean;
};
type PlayerRow = Omit<AdminPlayer, "displayName" | "publicEligible"> & NameRow & { public_eligible: boolean };
export type AdminPlayerMembership = { clubId: string; slug: string; displayName: string; shirtNumber: number | null; position: string; currentSerieA: boolean };
export type AdminPlayerStatistic = {
  id: string; season: string; competition: string; club: string; appearances: number | null; lineups: number | null; minutes: number | null;
  goals: number | null; assists: number | null; rating: string | null; shots: number | null; passes: number | null;
  tackles: number | null; yellow: number | null; red: number | null;
};
export type AdminPlayerDetail = { player: AdminPlayer; memberships: AdminPlayerMembership[]; statistics: AdminPlayerStatistic[] };
const playerColumns = `p.id, p.slug, p.provider, p.provider_player_id, p.provider_name, p.name_ru, p.name_ru_review_status,
  p.firstname, p.lastname, p.age, p.birth_date::text, p.birth_place, p.birth_country, p.nationality, p.height, p.weight, p.injured,
  (p.provider=$1 and (exists (select 1 from football.squad_memberships sm join football.season_clubs sc on sc.club_id=sm.club_id
      join current_season s on s.id=sc.season_id where sm.player_id=p.id)
    or exists (select 1 from football.player_statistics ps join current_season s on s.id=ps.season_id where ps.player_id=p.id))) as public_eligible`;
function player(row: PlayerRow): AdminPlayer {
  // Explicit projection: raw provider snapshots and unused localization state do not enter the UI.
  return { id: row.id, slug: row.slug, provider: row.provider, provider_player_id: row.provider_player_id, provider_name: row.provider_name,
    displayName: properName(row), age: row.age, firstname: row.firstname, lastname: row.lastname, birth_date: row.birth_date,
    birth_place: row.birth_place, birth_country: row.birth_country, nationality: row.nationality, height: row.height, weight: row.weight,
    injured: row.injured, publicEligible: row.public_eligible };
}
export async function listAdminPlayers(db: Queryable, filter: FootballDataQuery): Promise<DataPage<AdminPlayer>> {
  const pattern = `%${filter.query.replaceAll("!", "!!").replaceAll("%", "!%").replaceAll("_", "!_")}%`;
  const result = await db.query<{ total: number; items: PlayerRow[] }>(`
    with current_season as (${seasonSql}), filtered as materialized (
      select ${playerColumns} from football.players p
      where p.provider_name ilike $4 escape '!' or p.name_ru ilike $4 escape '!'
        or p.id=$5 or p.provider_player_id::text=$5
    ), page as (select * from filtered order by lower(provider_name), id limit $6 offset $7)
    select (select count(*)::int from filtered) as total,
      coalesce((select jsonb_agg(t order by lower(t.provider_name), t.id) from page t), '[]'::jsonb) as items
  `, [...scope, pattern, filter.query, FOOTBALL_DATA_PAGE_SIZE, (filter.page - 1) * FOOTBALL_DATA_PAGE_SIZE]);
  const row = result.rows[0];
  return { items: row.items.map(player), total: row.total, page: filter.page, totalPages: Math.ceil(row.total / FOOTBALL_DATA_PAGE_SIZE) };
}
export async function readAdminPlayer(db: Queryable, id: string): Promise<AdminPlayerDetail | null> {
  const found = await db.query<PlayerRow>(`with current_season as (${seasonSql}) select ${playerColumns} from football.players p where p.id=$4`, [...scope, id]);
  if (!found.rows[0]) return null;
  const memberships = await db.query<NameRow & { id: string; slug: string; shirt_number: number | null; position: string; current_serie_a: boolean }>(`
    with current_season as (${seasonSql})
    select c.id, c.slug, c.provider_name, c.name_ru, c.name_ru_review_status, sm.shirt_number, sm.position,
      exists(select 1 from football.season_clubs sc join current_season s on s.id=sc.season_id where sc.club_id=c.id) as current_serie_a
    from football.squad_memberships sm join football.clubs c on c.id=sm.club_id where sm.player_id=$4 order by lower(c.provider_name), c.id
  `, [...scope, id]);
  const stats = await db.query<Omit<AdminPlayerStatistic, "competition" | "club"> & {
    competition_provider_name: string; competition_name_ru: string | null; competition_review: string | null;
    club_provider_name: string; club_name_ru: string | null; club_review: string | null;
  }>(`
    select ps.id, s.display_label as season,
      comp.provider_name as competition_provider_name, comp.name_ru as competition_name_ru, comp.name_ru_review_status as competition_review,
      c.provider_name as club_provider_name, c.name_ru as club_name_ru, c.name_ru_review_status as club_review,
      ps.appearances, ps.lineups, ps.minutes, ps.goals_total as goals, ps.goals_assists as assists, ps.rating,
      ps.shots_total as shots, ps.passes_total as passes, ps.tackles_total as tackles, ps.cards_yellow as yellow, ps.cards_red as red
    from football.player_statistics ps join football.clubs c on c.id=ps.club_id
    join football.seasons s on s.id=ps.season_id join football.competitions comp on comp.id=s.competition_id
    where ps.player_id=$1 order by s.provider_season_year desc, comp.id, c.id, ps.id
  `, [id]);
  return { player: player(found.rows[0]), memberships: memberships.rows.map((row) => ({ clubId: row.id, slug: row.slug,
    displayName: properName(row), shirtNumber: row.shirt_number, position: row.position, currentSerieA: row.current_serie_a })), statistics: stats.rows.map((row) => ({
      id: row.id, season: row.season, competition: resolveFootballProperName({ providerName: row.competition_provider_name, nameRu: row.competition_name_ru, reviewStatus: row.competition_review }),
      club: resolveFootballProperName({ providerName: row.club_provider_name, nameRu: row.club_name_ru, reviewStatus: row.club_review }), appearances: row.appearances, lineups: row.lineups,
      minutes: row.minutes, goals: row.goals, assists: row.assists, rating: row.rating, shots: row.shots, passes: row.passes, tackles: row.tackles, yellow: row.yellow, red: row.red,
    })) };
}

export async function readMatchDatasetEvidence(db: Queryable, matchId: string, jobsSchema: string): Promise<MatchDatasetEvidence> {
  const result = await db.query<{ event_rows: number; events_succeeded_at: Date | null; lineups: MatchDatasetEvidence["lineups"]; statistics: MatchDatasetEvidence["statistics"] }>(`
    select (select count(*)::int from football.match_events e where e.match_id=m.id) as event_rows,
      (select max(e.finished_at) at time zone 'UTC' from ${quoteIdentifier(jobsSchema)}.executions e
        where e.type=$2 and e.status='succeeded' and e.payload->>'matchId'=m.id and e.idempotency_key=$3) as events_succeeded_at,
      coalesce((select jsonb_agg(jsonb_build_object('clubId', l.club_id, 'observedAt', l.observed_at) order by l.club_id)
        from football.match_lineups l where l.match_id=m.id and l.club_id in(m.home_club_id,m.away_club_id)), '[]'::jsonb) as lineups,
      coalesce((select jsonb_agg(jsonb_build_object('clubId', st.club_id, 'observedAt', st.observed_at) order by st.club_id)
        from football.match_statistics st where st.match_id=m.id and st.scope='full_match' and st.club_id in(m.home_club_id,m.away_club_id)), '[]'::jsonb) as statistics
    from football.matches m where m.id=$1
  `, [matchId, SERIE_A_MATCH_EVENTS_JOB_TYPE, `${API_FOOTBALL_PROVIDER}:league:${SERIE_A_PROVIDER_LEAGUE_ID}:season:${SERIE_A_CURRENT_SEASON}:match:${matchId}:events`]);
  const row = result.rows[0];
  if (!row) throw new Error("Selected Match disappeared from the read snapshot");
  return { eventRows: row.event_rows, eventsSucceededAt: row.events_succeeded_at, lineups: row.lineups, statistics: row.statistics };
}

/** Call only after the existing Football Admin server-side policy. No provider or admission paths. */
export async function readFootballData(db: Queryable, filter: FootballDataQuery, jobsSchema: string) {
  const checkedAt = (await db.query<{ checked_at: Date }>("select now() as checked_at")).rows[0].checked_at;
  if (filter.view === "players") return { view: "players" as const, checkedAt, page: await listAdminPlayers(db, filter),
    detail: filter.id ? await readAdminPlayer(db, filter.id) : null };
  if (filter.view === "standings") return { view: "standings" as const, checkedAt, standings: await listCurrentSerieAStandings(db) };
  const clubs = await listCurrentSerieAClubs(db);
  if (filter.view === "clubs") {
    const selected = clubs.find((club) => club.id === filter.id);
    return { view: "clubs" as const, checkedAt, page: dataPage(clubs.filter((club) => includesDataQuery(filter.query, [club.displayName, club.providerName, club.code, club.id])), filter.page),
      detail: selected ? await getCurrentSerieAClubPageData(db, selected.slug) : null };
  }
  const matches = await listCurrentSerieAMatches(db);
  const club = clubs.find((item) => item.id === filter.club);
  const page = dataPage(matches.filter((match) => (!filter.status || match.status === filter.status) &&
    (!filter.club || !!club && [match.homeClub.slug, match.awayClub.slug].includes(club.slug)) &&
    includesDataQuery(filter.query, [match.id, match.providerFixtureId, match.round, match.homeClub.displayName, match.awayClub.displayName,
      ...clubs.filter((c) => [match.homeClub.slug, match.awayClub.slug].includes(c.slug)).map((c) => c.providerName)])), filter.page);
  const selected = matches.find((match) => match.id === filter.id);
  const detail = selected ? await getCurrentSerieAMatchPageData(db, selected.slug) : null;
  return { view: "matches" as const, checkedAt, clubs, page, detail,
    evidence: detail ? await readMatchDatasetEvidence(db, detail.match.id, jobsSchema) : null };
}
export type FootballDataModel = Awaited<ReturnType<typeof readFootballData>>;
export async function loadFootballData(filter: FootballDataQuery): Promise<FootballDataModel> {
  const client = await getDbPool().connect();
  try {
    await client.query("begin isolation level repeatable read read only");
    const data = await readFootballData(client, filter, process.env.DATABASE_JOBS_SCHEMA?.trim() || "jobs");
    await client.query("commit"); return data;
  } catch (error) { await client.query("rollback"); throw error; }
  finally { client.release(); }
}
