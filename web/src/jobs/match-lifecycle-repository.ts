import { Pool } from "pg";

import {
  API_FOOTBALL_PROVIDER,
  SERIE_A_CURRENT_SEASON,
  SERIE_A_MATCHES_JOB_TYPE,
  SERIE_A_MATCH_EVENTS_JOB_TYPE,
  SERIE_A_MATCH_LINEUPS_JOB_TYPE,
  SERIE_A_MATCH_STATISTICS_JOB_TYPE,
  SERIE_A_PROVIDER_LEAGUE_ID,
} from "../football/foundation";
import type { NormalizedFixtureState } from "../football/api-football/fixture-status";
import { quoteIdentifier } from "./config";
import type {
  DispatcherExecution,
  MatchLifecycleSnapshot,
} from "./match-lifecycle-policy";
import type { JobExecutionStatus, JsonObject } from "./types";

const advisoryLockKeys = [910_230_201, 230_000_007];

type MatchRow = {
  id: string;
  status: NormalizedFixtureState;
  kickoff_at: Date | null;
  status_changed_at: Date | null;
  lineup_home_observed_at: Date | null;
  lineup_away_observed_at: Date | null;
  statistics_home_observed_at: Date | null;
  statistics_away_observed_at: Date | null;
};

type ExecutionRow = {
  id: string;
  type: string;
  match_id: string | null;
  status: JobExecutionStatus;
  payload: unknown;
  available_at: Date;
  started_at: Date | null;
  finished_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

function asJsonObject(value: unknown): JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : {};
}

function mapExecution(row: ExecutionRow): DispatcherExecution {
  return {
    id: row.id,
    type: row.type,
    matchId: row.match_id,
    status: row.status,
    payload: asJsonObject(row.payload),
    availableAt: row.available_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export type MatchLifecycleLock = {
  release: () => Promise<void>;
};

export class MatchLifecycleRepository {
  private readonly pool: Pool;
  private readonly executionsTable: string;

  constructor(input: { databaseUrl: string; jobsSchema: string }) {
    this.pool = new Pool({ connectionString: input.databaseUrl, max: 4 });
    this.executionsTable = `${quoteIdentifier(input.jobsSchema)}.${quoteIdentifier("executions")}`;
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  async tryAcquireLock(): Promise<MatchLifecycleLock | null> {
    const client = await this.pool.connect();

    try {
      const result = await client.query<{ locked: boolean }>(
        "select pg_try_advisory_lock($1, $2) as locked",
        advisoryLockKeys,
      );

      if (!result.rows[0]?.locked) {
        client.release();
        return null;
      }

      return {
        release: async () => {
          try {
            await client.query("select pg_advisory_unlock($1, $2)", advisoryLockKeys);
          } finally {
            client.release();
          }
        },
      };
    } catch (error) {
      client.release();
      throw error;
    }
  }

  async listCurrentSerieAMatches(): Promise<MatchLifecycleSnapshot[]> {
    const result = await this.pool.query<MatchRow>(
      `
        select
          m.id,
          m.status,
          m.kickoff_at,
          m.status_changed_at,
          home_lineup.observed_at as lineup_home_observed_at,
          away_lineup.observed_at as lineup_away_observed_at,
          home_statistics.observed_at as statistics_home_observed_at,
          away_statistics.observed_at as statistics_away_observed_at
        from football.competitions competition
        join football.seasons season on season.competition_id = competition.id
        join football.matches m on m.season_id = season.id
        left join football.match_lineups home_lineup
          on home_lineup.match_id = m.id
          and home_lineup.club_id = m.home_club_id
        left join football.match_lineups away_lineup
          on away_lineup.match_id = m.id
          and away_lineup.club_id = m.away_club_id
        left join football.match_statistics home_statistics
          on home_statistics.match_id = m.id
          and home_statistics.club_id = m.home_club_id
          and home_statistics.scope = 'full_match'
        left join football.match_statistics away_statistics
          on away_statistics.match_id = m.id
          and away_statistics.club_id = m.away_club_id
          and away_statistics.scope = 'full_match'
        where competition.provider = $1
          and competition.provider_competition_id = $2
          and season.provider = $1
          and season.provider_season_year = $3
        order by m.kickoff_at nulls last, m.provider_fixture_id
      `,
      [API_FOOTBALL_PROVIDER, SERIE_A_PROVIDER_LEAGUE_ID, SERIE_A_CURRENT_SEASON],
    );

    return result.rows.map((row) => ({
      id: row.id,
      status: row.status,
      kickoffAt: row.kickoff_at,
      statusChangedAt: row.status_changed_at,
      lineupHomeObservedAt: row.lineup_home_observed_at,
      lineupAwayObservedAt: row.lineup_away_observed_at,
      statisticsHomeObservedAt: row.statistics_home_observed_at,
      statisticsAwayObservedAt: row.statistics_away_observed_at,
    }));
  }

  async listLifecycleExecutions(): Promise<DispatcherExecution[]> {
    const result = await this.pool.query<ExecutionRow>(
      `
        select
          id,
          type,
          null::text as match_id,
          status,
          payload,
          available_at,
          started_at,
          finished_at,
          created_at,
          updated_at
        from ${this.executionsTable}
        where type = $1
        order by created_at desc
        limit 50
      `,
      [SERIE_A_MATCHES_JOB_TYPE],
    );

    return result.rows.map(mapExecution);
  }

  async listMatchExecutions(managedFrom: Date): Promise<DispatcherExecution[]> {
    const result = await this.pool.query<ExecutionRow>(
      `
        select
          execution.id,
          execution.type,
          execution.payload ->> 'matchId' as match_id,
          execution.status,
          execution.payload,
          execution.available_at,
          execution.started_at,
          execution.finished_at,
          execution.created_at,
          execution.updated_at
        from ${this.executionsTable} execution
        join football.matches match
          on match.id = execution.payload ->> 'matchId'
        join football.seasons season on season.id = match.season_id
        join football.competitions competition
          on competition.id = season.competition_id
        where execution.type = any($1::text[])
          and (
            execution.status in ('pending', 'running')
            or execution.created_at >= $2
          )
          and competition.provider = $3
          and competition.provider_competition_id = $4
          and season.provider = $3
          and season.provider_season_year = $5
        order by execution.created_at desc
      `,
      [
        [
          SERIE_A_MATCH_EVENTS_JOB_TYPE,
          SERIE_A_MATCH_LINEUPS_JOB_TYPE,
          SERIE_A_MATCH_STATISTICS_JOB_TYPE,
        ],
        managedFrom,
        API_FOOTBALL_PROVIDER,
        SERIE_A_PROVIDER_LEAGUE_ID,
        SERIE_A_CURRENT_SEASON,
      ],
    );

    return result.rows.map(mapExecution);
  }
}

export type MatchLifecycleRepositoryContract = Pick<
  MatchLifecycleRepository,
  | "tryAcquireLock"
  | "listCurrentSerieAMatches"
  | "listLifecycleExecutions"
  | "listMatchExecutions"
>;
