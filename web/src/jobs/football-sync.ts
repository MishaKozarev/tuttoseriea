import { Pool } from "pg";

import { createApiFootballClient } from "../football/api-football/node";
import {
  SERIE_A_CURRENT_SEASON,
  SERIE_A_FOUNDATION_IDEMPOTENCY_KEY,
  SERIE_A_FOUNDATION_JOB_TYPE,
  SERIE_A_PROVIDER_LEAGUE_ID,
} from "../football/foundation";
import { syncSerieAFoundation } from "../football/serie-a-foundation-sync";
import { JobConfigError, JobUsageError, type JobDefinition } from "./types";

function requireDatabaseUrl(): string {
  const databaseUrl = process.env.DATABASE_URL?.trim();

  if (!databaseUrl) {
    throw new JobConfigError("DATABASE_URL is required for Football sync jobs");
  }

  return databaseUrl;
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
  handle: async (context) => {
    const pool = new Pool({
      connectionString: requireDatabaseUrl(),
      max: 3,
    });

    try {
      const result = await syncSerieAFoundation({
        client: createApiFootballClient(),
        queryable: pool,
        heartbeat: context.heartbeat,
      });

      if (result.status === "success") {
        return { status: "success" };
      }

      return result;
    } finally {
      await pool.end();
    }
  },
};
