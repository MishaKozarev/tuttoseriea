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
  SERIE_A_MATCH_EVENTS_JOB_TYPE,
  SERIE_A_MATCH_LINEUPS_JOB_TYPE,
  SERIE_A_MATCH_STATISTICS_JOB_TYPE,
  SERIE_A_PLAYER_STATISTICS_IDEMPOTENCY_KEY,
  SERIE_A_PLAYER_STATISTICS_JOB_TYPE,
  SERIE_A_PROVIDER_LEAGUE_ID,
  SERIE_A_SQUADS_IDEMPOTENCY_KEY,
  SERIE_A_SQUADS_JOB_TYPE,
  SERIE_A_STANDINGS_IDEMPOTENCY_KEY,
  SERIE_A_STANDINGS_JOB_TYPE,
  createSerieAMatchEventsIdempotencyKey,
  createSerieAMatchLineupsIdempotencyKey,
  createSerieAMatchStatisticsIdempotencyKey,
} from "../football/foundation";
import { syncMatchEvents } from "../football/match-events-sync";
import {
  syncMatchLineups,
  type MatchLineupsSyncAnomaly,
} from "../football/match-lineups-sync";
import {
  syncMatchStatistics,
  type MatchStatisticsSyncAnomaly,
} from "../football/match-statistics-sync";
import { syncSerieAFoundation } from "../football/serie-a-foundation-sync";
import { syncSerieAMatches } from "../football/serie-a-matches-sync";
import { syncSerieAPlayerStatistics } from "../football/serie-a-player-statistics-sync";
import { syncSerieASquads } from "../football/serie-a-squads-sync";
import { syncSerieAStandings } from "../football/serie-a-standings-sync";
import { logger } from "../logging/logger-core";
import {
  JobConfigError,
  JobUsageError,
  type JobDefinition,
  type JobHandlerResult,
} from "./types";

const lowercaseUuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

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

export const syncSerieAPlayerStatisticsJob: JobDefinition = {
  type: SERIE_A_PLAYER_STATISTICS_JOB_TYPE,
  parseArguments: (args) => {
    if (args.length !== 0) {
      throw new JobUsageError(
        `${SERIE_A_PLAYER_STATISTICS_JOB_TYPE} does not accept job arguments`,
      );
    }

    return {
      idempotencyKey: SERIE_A_PLAYER_STATISTICS_IDEMPOTENCY_KEY,
      payload: {
        provider: "api-football",
        leagueId: SERIE_A_PROVIDER_LEAGUE_ID,
        season: SERIE_A_CURRENT_SEASON,
        scope: "player-statistics",
      },
    };
  },
  handle: async (context) =>
    runFootballSync(async (client, pool) => {
      return syncSerieAPlayerStatistics({
        client,
        pool,
        heartbeat: context.heartbeat,
      });
    }),
};

export const syncSerieAMatchEventsJob: JobDefinition = {
  type: SERIE_A_MATCH_EVENTS_JOB_TYPE,
  parseArguments: (args) => {
    const matchId = args[1];

    if (
      args.length !== 2 ||
      args[0] !== "--match-id" ||
      !matchId ||
      !lowercaseUuidPattern.test(matchId)
    ) {
      throw new JobUsageError(
        `${SERIE_A_MATCH_EVENTS_JOB_TYPE} requires exactly --match-id <lowercase-uuid>`,
      );
    }

    return {
      idempotencyKey: createSerieAMatchEventsIdempotencyKey(matchId),
      payload: {
        provider: "api-football",
        leagueId: SERIE_A_PROVIDER_LEAGUE_ID,
        season: SERIE_A_CURRENT_SEASON,
        scope: "match-events",
        matchId,
      },
    };
  },
  handle: async (context) => {
    const matchId = context.execution.payload.matchId;

    if (typeof matchId !== "string" || !lowercaseUuidPattern.test(matchId)) {
      return {
        status: "failed",
        errorCode: "job_invalid_payload",
        message: "Match Events job payload contains an invalid Match ID.",
      };
    }

    return runFootballSync(async (client, pool) => {
      const result = await syncMatchEvents({
        client,
        pool,
        matchId,
        heartbeat: context.heartbeat,
      });

      if (result.status === "success" && result.emptySnapshotAnomaly) {
        logger.warn("API-Football returned an empty Match Events snapshot", {
          context: {
            event: "football.match_events.empty_snapshot",
            ...result.emptySnapshotAnomaly,
          },
        });
      }

      return result.status === "success" ? { status: "success" } : result;
    });
  },
};

function logMatchLineupsAnomaly(anomaly: MatchLineupsSyncAnomaly): void {
  if (anomaly.code === "api_football_empty_match_lineups") {
    logger.warn("API-Football returned an empty Match Lineups snapshot", {
      context: {
        event: "football.match_lineups.empty_snapshot",
        ...anomaly,
      },
    });
    return;
  }

  if (anomaly.code === "api_football_partial_match_lineups") {
    logger.warn("API-Football returned a partial Match Lineups snapshot", {
      context: {
        event: "football.match_lineups.partial_snapshot",
        ...anomaly,
      },
    });
    return;
  }

  logger.warn("API-Football returned an unexpected Match Lineup starter count", {
    context: {
      event: "football.match_lineups.unexpected_starter_count",
      ...anomaly,
    },
  });
}

export const syncSerieAMatchLineupsJob: JobDefinition = {
  type: SERIE_A_MATCH_LINEUPS_JOB_TYPE,
  parseArguments: (args) => {
    const matchId = args[1];

    if (
      args.length !== 2 ||
      args[0] !== "--match-id" ||
      !matchId ||
      !lowercaseUuidPattern.test(matchId)
    ) {
      throw new JobUsageError(
        `${SERIE_A_MATCH_LINEUPS_JOB_TYPE} requires exactly --match-id <lowercase-uuid>`,
      );
    }

    return {
      idempotencyKey: createSerieAMatchLineupsIdempotencyKey(matchId),
      payload: {
        provider: "api-football",
        leagueId: SERIE_A_PROVIDER_LEAGUE_ID,
        season: SERIE_A_CURRENT_SEASON,
        scope: "match-lineups",
        matchId,
      },
    };
  },
  handle: async (context) => {
    const matchId = context.execution.payload.matchId;

    if (typeof matchId !== "string" || !lowercaseUuidPattern.test(matchId)) {
      return {
        status: "failed",
        errorCode: "job_invalid_payload",
        message: "Match Lineups job payload contains an invalid Match ID.",
      };
    }

    return runFootballSync(async (client, pool) => {
      const result = await syncMatchLineups({
        client,
        pool,
        matchId,
        heartbeat: context.heartbeat,
      });

      if (result.status === "success") {
        for (const anomaly of result.anomalies) {
          logMatchLineupsAnomaly(anomaly);
        }

        return { status: "success" };
      }

      return result;
    });
  },
};

function logMatchStatisticsAnomaly(anomaly: MatchStatisticsSyncAnomaly): void {
  if (anomaly.code === "api_football_empty_match_statistics") {
    logger.warn("API-Football returned an empty Match Statistics response", {
      context: {
        event: "football.match_statistics.empty_snapshot",
        ...anomaly,
      },
    });
    return;
  }

  if (anomaly.code === "api_football_partial_match_statistics") {
    logger.warn("API-Football returned partial Match Statistics", {
      context: {
        event: "football.match_statistics.partial_snapshot",
        ...anomaly,
      },
    });
    return;
  }

  if (anomaly.code === "api_football_empty_match_statistics_team") {
    logger.warn("API-Football returned an empty Match Statistics team", {
      context: {
        event: "football.match_statistics.empty_team",
        ...anomaly,
      },
    });
    return;
  }

  logger.warn("API-Football returned duplicate Match Statistic types", {
    context: {
      event: "football.match_statistics.duplicate_type",
      ...anomaly,
    },
  });
}

export const syncSerieAMatchStatisticsJob: JobDefinition = {
  type: SERIE_A_MATCH_STATISTICS_JOB_TYPE,
  parseArguments: (args) => {
    const matchId = args[1];

    if (
      args.length !== 2 ||
      args[0] !== "--match-id" ||
      !matchId ||
      !lowercaseUuidPattern.test(matchId)
    ) {
      throw new JobUsageError(
        `${SERIE_A_MATCH_STATISTICS_JOB_TYPE} requires exactly --match-id <lowercase-uuid>`,
      );
    }

    return {
      idempotencyKey: createSerieAMatchStatisticsIdempotencyKey(matchId),
      payload: {
        provider: "api-football",
        leagueId: SERIE_A_PROVIDER_LEAGUE_ID,
        season: SERIE_A_CURRENT_SEASON,
        scope: "match-statistics",
        matchId,
      },
    };
  },
  handle: async (context) => {
    const matchId = context.execution.payload.matchId;

    if (typeof matchId !== "string" || !lowercaseUuidPattern.test(matchId)) {
      return {
        status: "failed",
        errorCode: "job_invalid_payload",
        message: "Match Statistics job payload contains an invalid Match ID.",
      };
    }

    return runFootballSync(async (client, pool) => {
      const result = await syncMatchStatistics({
        client,
        pool,
        matchId,
        heartbeat: context.heartbeat,
      });

      if (result.status === "success") {
        for (const anomaly of result.anomalies) {
          logMatchStatisticsAnomaly(anomaly);
        }

        return { status: "success" };
      }

      return result;
    });
  },
};
