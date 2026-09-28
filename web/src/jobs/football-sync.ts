import { Pool } from "pg";

import {
  createApiFootballClient,
  type ApiFootballClient,
} from "../football/api-football/node";
import {
  SERIE_A_CURRENT_SEASON,
  SERIE_A_FOUNDATION_IDEMPOTENCY_KEY,
  SERIE_A_FOUNDATION_JOB_TYPE,
  SERIE_A_MATCHES_IDEMPOTENCY_KEY,
  SERIE_A_MATCHES_JOB_TYPE,
  SERIE_A_PROVIDER_LEAGUE_ID,
  SERIE_A_SQUADS_IDEMPOTENCY_KEY,
  SERIE_A_SQUADS_JOB_TYPE,
  SERIE_A_STANDINGS_IDEMPOTENCY_KEY,
  SERIE_A_STANDINGS_JOB_TYPE,
} from "../football/foundation";
import { syncSerieAFoundation } from "../football/serie-a-foundation-sync";
import { syncSerieAMatches } from "../football/serie-a-matches-sync";
import { syncSerieASquads } from "../football/serie-a-squads-sync";
import { syncSerieAStandings } from "../football/serie-a-standings-sync";
import {
  JobConfigError,
  JobUsageError,
  type JobDefinition,
  type JobHandlerResult,
} from "./types";

function requireDatabaseUrl(): string {
  const databaseUrl = process.env.DATABASE_URL?.trim();

  if (!databaseUrl) {
    throw new JobConfigError("DATABASE_URL is required for Football sync jobs");
  }

  return databaseUrl;
}

type FootballSyncResult =
  | { status: "success" }
  | Extract<JobHandlerResult, { status: "retry" | "failed" }>;

async function runFootballSync(
  execute: (client: ApiFootballClient, pool: Pool) => Promise<FootballSyncResult>,
): Promise<JobHandlerResult> {
  let client: ApiFootballClient | null = null;
  let pool: Pool | null = null;

  try {
    pool = new Pool({
      connectionString: requireDatabaseUrl(),
      max: 3,
    });
    client = createApiFootballClient();

    const result = await execute(client, pool);

    return result.status === "success" ? { status: "success" } : result;
  } finally {
    console.log(`api_football_requests=${client?.getRequestAttemptCount() ?? 0}`);

    await pool?.end();
  }
}

export const syncSerieAFoundationJob: JobDefinition = {
  type: SERIE_A_FOUNDATION_JOB_TYPE,
  parseArguments: (args) => {
    if (args.length !== 0) {
      throw new JobUsageError(
        `${SERIE_A_FOUNDATION_JOB_TYPE} does not accept job arguments`,
      );
    }

    return {
      idempotencyKey: SERIE_A_FOUNDATION_IDEMPOTENCY_KEY,
      payload: {
        provider: "api-football",
        leagueId: SERIE_A_PROVIDER_LEAGUE_ID,
        season: SERIE_A_CURRENT_SEASON,
      },
    };
  },
  handle: async (context) =>
    runFootballSync(async (client, pool) => {
      return syncSerieAFoundation({
        client,
        queryable: pool,
        heartbeat: context.heartbeat,
      });
    }),
};

export const syncSerieAMatchesJob: JobDefinition = {
  type: SERIE_A_MATCHES_JOB_TYPE,
  parseArguments: (args) => {
    if (args.length !== 0) {
      throw new JobUsageError(`${SERIE_A_MATCHES_JOB_TYPE} does not accept job arguments`);
    }

    return {
      idempotencyKey: SERIE_A_MATCHES_IDEMPOTENCY_KEY,
      payload: {
        provider: "api-football",
        leagueId: SERIE_A_PROVIDER_LEAGUE_ID,
        season: SERIE_A_CURRENT_SEASON,
        scope: "matches",
      },
    };
  },
  handle: async (context) =>
    runFootballSync(async (client, pool) => {
      return syncSerieAMatches({
        client,
        pool,
        heartbeat: context.heartbeat,
      });
    }),
};

export const syncSerieAStandingsJob: JobDefinition = {
  type: SERIE_A_STANDINGS_JOB_TYPE,
  parseArguments: (args) => {
    if (args.length !== 0) {
      throw new JobUsageError(
        `${SERIE_A_STANDINGS_JOB_TYPE} does not accept job arguments`,
      );
    }

    return {
      idempotencyKey: SERIE_A_STANDINGS_IDEMPOTENCY_KEY,
      payload: {
        provider: "api-football",
        leagueId: SERIE_A_PROVIDER_LEAGUE_ID,
        season: SERIE_A_CURRENT_SEASON,
        scope: "standings",
      },
    };
  },
  handle: async (context) =>
    runFootballSync(async (client, pool) => {
      return syncSerieAStandings({
        client,
        pool,
        heartbeat: context.heartbeat,
      });
    }),
};

export const syncSerieASquadsJob: JobDefinition = {
  type: SERIE_A_SQUADS_JOB_TYPE,
  parseArguments: (args) => {
    if (args.length !== 0) {
      throw new JobUsageError(
        `${SERIE_A_SQUADS_JOB_TYPE} does not accept job arguments`,
      );
    }

    return {
      idempotencyKey: SERIE_A_SQUADS_IDEMPOTENCY_KEY,
      payload: {
        provider: "api-football",
        leagueId: SERIE_A_PROVIDER_LEAGUE_ID,
        season: SERIE_A_CURRENT_SEASON,
        scope: "squads",
      },
    };
  },
  handle: async (context) =>
    runFootballSync(async (client, pool) => {
      return syncSerieASquads({
        client,
        pool,
        heartbeat: context.heartbeat,
      });
    }),
};
