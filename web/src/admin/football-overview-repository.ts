import "server-only";

import type { Pool, PoolClient } from "pg";

import { getDbPool } from "../db";
import {
  API_FOOTBALL_PROVIDER, SERIE_A_CURRENT_SEASON, SERIE_A_PROVIDER_LEAGUE_ID,
  SERIE_A_FOUNDATION_JOB_TYPE, SERIE_A_FOUNDATION_IDEMPOTENCY_KEY,
  SERIE_A_MATCHES_JOB_TYPE, SERIE_A_MATCHES_IDEMPOTENCY_KEY,
  SERIE_A_STANDINGS_JOB_TYPE, SERIE_A_STANDINGS_IDEMPOTENCY_KEY,
  SERIE_A_SQUADS_JOB_TYPE, SERIE_A_SQUADS_IDEMPOTENCY_KEY,
  SERIE_A_PLAYER_STATISTICS_JOB_TYPE, SERIE_A_PLAYER_STATISTICS_IDEMPOTENCY_KEY,
  SERIE_A_MATCH_EVENTS_JOB_TYPE, SERIE_A_MATCH_LINEUPS_JOB_TYPE, SERIE_A_MATCH_STATISTICS_JOB_TYPE,
} from "../football/foundation";
import { quoteIdentifier } from "../jobs/config";
import { listFinishedMatchBackfillSnapshots } from "../jobs/match-data-backfill-repository";
import type { JobExecutionStatus } from "../jobs/types";

type Queryable = Pool | PoolClient;

export type OverviewDatasetId = "foundation" | "matches" | "standings" | "squads" |
  "player-statistics" | "events" | "lineups" | "statistics";

// Display metadata for the existing eight canonical jobs; this is not a runner registry.
export const OVERVIEW_DATASETS = [
  { id: "foundation", label: "Лига, сезон и клубы", jobType: SERIE_A_FOUNDATION_JOB_TYPE, key: SERIE_A_FOUNDATION_IDEMPOTENCY_KEY },
  { id: "matches", label: "Матчи", jobType: SERIE_A_MATCHES_JOB_TYPE, key: SERIE_A_MATCHES_IDEMPOTENCY_KEY },
  { id: "standings", label: "Турнирная таблица", jobType: SERIE_A_STANDINGS_JOB_TYPE, key: SERIE_A_STANDINGS_IDEMPOTENCY_KEY },
  { id: "squads", label: "Текущие составы клубов", jobType: SERIE_A_SQUADS_JOB_TYPE, key: SERIE_A_SQUADS_IDEMPOTENCY_KEY },
  { id: "player-statistics", label: "Сезонная статистика игроков", jobType: SERIE_A_PLAYER_STATISTICS_JOB_TYPE, key: SERIE_A_PLAYER_STATISTICS_IDEMPOTENCY_KEY },
  { id: "events", label: "События матчей", jobType: SERIE_A_MATCH_EVENTS_JOB_TYPE, key: null },
  { id: "lineups", label: "Стартовые составы матчей", jobType: SERIE_A_MATCH_LINEUPS_JOB_TYPE, key: null },
  { id: "statistics", label: "Статистика матчей", jobType: SERIE_A_MATCH_STATISTICS_JOB_TYPE, key: null },
] as const;

export type OverviewFacts = {
  season_count: number;
  clubs: number;
  matches: number;
  standings: number;
  squad_clubs: number;
  squad_memberships: number;
  squad_players: number;
  player_statistics: number;
  statistics_players: number;
  events: number;
  lineups: number;
  statistics: number;
  observations: Record<OverviewDatasetId, { oldest: string | null; newest: string | null }>;
};

export type OverviewJobSummary = {
  type: string;
  pending: number;
  retries: number;
  running: number;
  expired: number;
  failed_scopes: number;
  last_success_at: Date | null;
};

export type OverviewExecution = {
  id: string;
  type: string;
  match_id: string | null;
  status: JobExecutionStatus;
  attempt_count: number;
  max_attempts: number;
  created_at: Date;
  finished_at: Date | null;
  available_at: Date;
  last_error_code: string | null;
  admin_requested: boolean;
};

export type FootballOverviewData = {
  checkedAt: Date;
  facts: OverviewFacts;
  finishedMatches: Awaited<ReturnType<typeof listFinishedMatchBackfillSnapshots>>;
  jobs: OverviewJobSummary[];
  recentExecutions: OverviewExecution[];
};

const currentSeasonSql = `
  select season.id from football.competitions competition
  join football.seasons season on season.competition_id = competition.id
  where competition.provider = $1 and competition.provider_competition_id = $2
    and season.provider = $1 and season.provider_season_year = $3
`;
const scopeParameters = [API_FOOTBALL_PROVIDER, SERIE_A_PROVIDER_LEAGUE_ID, SERIE_A_CURRENT_SEASON];

/** Internal read model. Call only after the Football Admin server-side access policy. */
export async function readFootballOverview(queryable: Queryable, jobsSchema: string): Promise<FootballOverviewData> {
  const executions = `${quoteIdentifier(jobsSchema)}.executions`;
  const requests = `${quoteIdentifier(jobsSchema)}.admin_requests`;
  const facts = await queryable.query<OverviewFacts & { checked_at: Date }>(`
    with current_season as (${currentSeasonSql}),
    clubs as (select sc.* from football.season_clubs sc join current_season s on s.id = sc.season_id
      join football.clubs c on c.id = sc.club_id where c.provider = $1),
    matches as (select m.* from football.matches m join current_season s on s.id = m.season_id),
    standings as (select st.* from football.standings st join current_season s on s.id = st.season_id),
    squads as (select sm.* from football.squad_memberships sm join clubs c on c.club_id = sm.club_id),
    player_stats as (select ps.* from football.player_statistics ps join current_season s on s.id = ps.season_id),
    lineups as (select l.* from football.match_lineups l join matches m on m.id = l.match_id
      where l.club_id in (m.home_club_id, m.away_club_id)),
    statistics as (select st.* from football.match_statistics st join matches m on m.id = st.match_id
      where st.scope = 'full_match' and st.club_id in (m.home_club_id, m.away_club_id)),
    observations as (
      select 'foundation' as dataset, min(updated_at) at time zone 'UTC' as oldest, max(updated_at) at time zone 'UTC' as newest from clubs
      union all select 'matches', min(updated_at) at time zone 'UTC', max(updated_at) at time zone 'UTC' from matches
      union all select 'standings', min(updated_at) at time zone 'UTC', max(updated_at) at time zone 'UTC' from standings
      union all select 'squads', min(updated_at) at time zone 'UTC', max(updated_at) at time zone 'UTC' from squads
      union all select 'player-statistics', min(updated_at) at time zone 'UTC', max(updated_at) at time zone 'UTC' from player_stats
      union all select 'events', null::timestamptz, null::timestamptz
      union all select 'lineups', min(observed_at), max(observed_at) from lineups
      union all select 'statistics', min(observed_at), max(observed_at) from statistics
    )
    select now() as checked_at,
      (select count(*)::int from current_season) as season_count,
      (select count(*)::int from clubs) as clubs,
      (select count(*)::int from matches) as matches,
      (select count(*)::int from standings) as standings,
      (select count(distinct club_id)::int from squads) as squad_clubs,
      (select count(*)::int from squads) as squad_memberships,
      (select count(distinct player_id)::int from squads) as squad_players,
      (select count(*)::int from player_stats) as player_statistics,
      (select count(distinct player_id)::int from player_stats) as statistics_players,
      (select count(*)::int from football.match_events e join matches m on m.id = e.match_id) as events,
      (select count(*)::int from lineups) as lineups,
      (select count(*)::int from statistics) as statistics,
      (select jsonb_object_agg(dataset, jsonb_build_object('oldest', oldest, 'newest', newest)) from observations) as observations
  `, scopeParameters);

  // Scope by canonical keys and persisted current-season Matches, not by an unbounded type prefix.
  const scopedSql = `
    with current_season as (${currentSeasonSql}),
    fixed_jobs as (select * from unnest($4::text[], $5::text[]) as fixed(type, key)),
    match_jobs as (select * from unnest($6::text[], $7::text[]) as scoped(type, suffix)),
    scoped as (
      select e.* from ${executions} e
      where exists (select 1 from fixed_jobs f where f.type = e.type and f.key = e.idempotency_key)
      or exists (
        select 1 from match_jobs j
        join football.matches m on m.id = e.payload ->> 'matchId'
        join current_season s on s.id = m.season_id
        where j.type = e.type and e.idempotency_key =
          $8 || m.id || ':' || j.suffix
      )
    )
  `;
  const fixed = OVERVIEW_DATASETS.filter((dataset) => dataset.key !== null);
  const match = OVERVIEW_DATASETS.filter((dataset) => dataset.key === null);
  const jobParameters = [...scopeParameters, fixed.map((d) => d.jobType), fixed.map((d) => d.key),
    match.map((d) => d.jobType), match.map((d) => d.id),
    `${API_FOOTBALL_PROVIDER}:league:${SERIE_A_PROVIDER_LEAGUE_ID}:season:${SERIE_A_CURRENT_SEASON}:match:`];
  const jobs = await queryable.query<OverviewJobSummary>(`${scopedSql},
    ranked as (select *, row_number() over (partition by type, idempotency_key order by created_at desc, id desc) as rank from scoped)
    select type,
      count(*) filter (where status = 'pending')::int as pending,
      count(*) filter (where status = 'pending' and attempt_count > 0)::int as retries,
      count(*) filter (where status = 'running')::int as running,
      count(*) filter (where status = 'running' and lease_expires_at <= now() at time zone 'UTC')::int as expired,
      count(*) filter (where rank = 1 and status = 'failed')::int as failed_scopes,
      max(finished_at) filter (where status = 'succeeded') at time zone 'UTC' as last_success_at
    from ranked group by type
  `, jobParameters);
  const recent = await queryable.query<OverviewExecution>(`${scopedSql}
    select e.id, e.type, e.payload ->> 'matchId' as match_id, e.status,
      e.attempt_count, e.max_attempts, e.created_at at time zone 'UTC' as created_at,
      e.finished_at at time zone 'UTC' as finished_at, e.available_at at time zone 'UTC' as available_at,
      e.last_error_code, exists (select 1 from ${requests} r where r.execution_id = e.id) as admin_requested
    from scoped e order by e.created_at desc, e.id desc limit 20
  `, jobParameters);

  const finishedMatches = await listFinishedMatchBackfillSnapshots(queryable, jobsSchema);
  // Reuse the existing finished/two-sided snapshot read model. For zero-row Events,
  // additionally require the exact canonical key, rather than type + payload alone.
  const confirmedEvents = await queryable.query<{ id: string }>(`${scopedSql}
    select m.id from football.matches m where m.id = any($9::text[]) and (
      exists (select 1 from football.match_events event where event.match_id = m.id)
      or exists (select 1 from scoped e where e.type = $10 and e.status = 'succeeded'
        and e.payload ->> 'matchId' = m.id)
    )
  `, [...jobParameters, finishedMatches.map((match) => match.matchId), SERIE_A_MATCH_EVENTS_JOB_TYPE]);
  const eventMatchIds = new Set(confirmedEvents.rows.map((row) => row.id));

  return {
    checkedAt: facts.rows[0].checked_at,
    facts: facts.rows[0],
    finishedMatches: finishedMatches.map((match) => ({ ...match, eventsComplete: eventMatchIds.has(match.matchId) })),
    jobs: jobs.rows,
    recentExecutions: recent.rows,
  };
}

export async function loadFootballOverview(): Promise<FootballOverviewData> {
  const client = await getDbPool().connect();
  try {
    // One consistent view, including when a job replaces a snapshot during this request.
    await client.query("begin isolation level repeatable read read only");
    const result = await readFootballOverview(client, process.env.DATABASE_JOBS_SCHEMA?.trim() || "jobs");
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}
