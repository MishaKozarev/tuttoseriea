import { Pool, type PoolClient, type QueryResultRow } from "pg";

import {
  API_FOOTBALL_PROVIDER,
  SERIE_A_CURRENT_SEASON,
  SERIE_A_MATCH_EVENTS_JOB_TYPE,
  SERIE_A_PROVIDER_LEAGUE_ID,
} from "../football/foundation";
import { quoteIdentifier } from "./config";

const advisoryLockKeys = [910_230_201, 230_000_008];

type Queryable = Pool | PoolClient;

type BackfillMatchRow = QueryResultRow & {
  match_id: string;
  provider_fixture_id: number;
  status_changed_at: Date | null;
  events_complete: boolean;
  lineups_complete: boolean;
  statistics_complete: boolean;
};

export type MatchDataBackfillSnapshot = {
  matchId: string;
  providerFixtureId: number;
  statusChangedAt: Date | null;
  eventsComplete: boolean;
  lineupsComplete: boolean;
  statisticsComplete: boolean;
};

export type MatchDataBackfillLock = {
  release: () => Promise<void>;
};

export async function listFinishedMatchBackfillSnapshots(
  queryable: Queryable,
  jobsSchema: string,
): Promise<MatchDataBackfillSnapshot[]> {
  const executionsTable = `${quoteIdentifier(jobsSchema)}.${quoteIdentifier("executions")}`;
  const result = await queryable.query<BackfillMatchRow>(
    `
      select
        match.id as match_id,
        match.provider_fixture_id,
        match.status_changed_at,
        (
          exists (
            select 1
            from football.match_events event
            where event.match_id = match.id
          )
          or exists (
            select 1
            from ${executionsTable} execution
            where execution.type = $4
              and execution.status = 'succeeded'
              and execution.payload ->> 'matchId' = match.id
          )
        ) as events_complete,
        (
          exists (
            select 1
            from football.match_lineups home_lineup
            where home_lineup.match_id = match.id
              and home_lineup.club_id = match.home_club_id
          )
          and exists (
            select 1
            from football.match_lineups away_lineup
            where away_lineup.match_id = match.id
              and away_lineup.club_id = match.away_club_id
          )
        ) as lineups_complete,
        (
          exists (
            select 1
            from football.match_statistics home_statistics
            where home_statistics.match_id = match.id
              and home_statistics.club_id = match.home_club_id
              and home_statistics.scope = 'full_match'
          )
          and exists (
            select 1
            from football.match_statistics away_statistics
            where away_statistics.match_id = match.id
              and away_statistics.club_id = match.away_club_id
              and away_statistics.scope = 'full_match'
          )
        ) as statistics_complete
      from football.competitions competition
      join football.seasons season on season.competition_id = competition.id
      join football.matches match on match.season_id = season.id
      where competition.provider = $1
        and competition.provider_competition_id = $2
        and season.provider = $1
        and season.provider_season_year = $3
        and match.status = 'finished'
      order by match.kickoff_at nulls last, match.provider_fixture_id, match.id
    `,
    [
      API_FOOTBALL_PROVIDER,
      SERIE_A_PROVIDER_LEAGUE_ID,
      SERIE_A_CURRENT_SEASON,
      SERIE_A_MATCH_EVENTS_JOB_TYPE,
    ],
  );

  return result.rows.map((row) => ({
    matchId: row.match_id,
    providerFixtureId: row.provider_fixture_id,
    statusChangedAt: row.status_changed_at,
    eventsComplete: row.events_complete,
    lineupsComplete: row.lineups_complete,
    statisticsComplete: row.statistics_complete,
  }));
}

export class MatchDataBackfillRepository {
  private readonly pool: Pool;
  private readonly jobsSchema: string;

  constructor(input: { databaseUrl: string; jobsSchema: string }) {
    this.pool = new Pool({ connectionString: input.databaseUrl, max: 3 });
    this.jobsSchema = input.jobsSchema;
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  async listFinishedMatches(): Promise<MatchDataBackfillSnapshot[]> {
    return listFinishedMatchBackfillSnapshots(this.pool, this.jobsSchema);
  }

  async tryAcquireRunLock(): Promise<MatchDataBackfillLock | null> {
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
}

export type MatchDataBackfillRepositoryContract = Pick<
  MatchDataBackfillRepository,
  "listFinishedMatches" | "tryAcquireRunLock"
>;
