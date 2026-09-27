import type { Pool, PoolClient } from "pg";

import type { ApiFootballClient, ApiFootballResult } from "./api-football/node";
import {
  SERIE_A_CURRENT_SEASON,
  SERIE_A_EXPECTED_CURRENT_STANDINGS_ROWS,
  SERIE_A_PROVIDER_LEAGUE_ID,
} from "./foundation";
import {
  getSerieAStandingsContext,
  reserveStandingRanksForSnapshot,
  upsertStanding,
  type SerieAStandingsContext,
  type StandingStatistics,
  type UpsertStandingInput,
} from "./standings-repository";

type ParsedProviderStanding = Omit<UpsertStandingInput, "clubId" | "seasonId"> & {
  providerClubId: number;
};

export type SerieAStandingsSyncSuccess = {
  status: "success";
  standingCount: number;
};

export type SerieAStandingsSyncFailure = {
  status: "retry" | "failed";
  errorCode: string;
  message: string;
  retryDelaySeconds?: number;
};

export type SerieAStandingsSyncResult =
  | SerieAStandingsSyncSuccess
  | SerieAStandingsSyncFailure;

type SerieAStandingsDatabaseInput =
  | {
      pool: Pool;
      transactionClient?: never;
    }
  | {
      pool?: never;
      transactionClient: PoolClient;
    };

export type SerieAStandingsSyncInput = SerieAStandingsDatabaseInput & {
  client: ApiFootballClient;
  heartbeat?: () => Promise<void>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requiredPositiveInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value > 0
    ? value
    : null;
}

function requiredInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}

function requiredNonnegativeInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0
    ? value
    : null;
}

function nullableString(value: unknown): string | null | undefined {
  if (value === null) {
    return null;
  }

  return typeof value === "string" ? value : undefined;
}

function failed(errorCode: string, message: string): SerieAStandingsSyncFailure {
  return {
    status: "failed",
    errorCode,
    message,
  };
}

function providerFailure(
  endpoint: string,
  result: ApiFootballResult<unknown>,
): SerieAStandingsSyncFailure {
  if (result.ok) {
    throw new Error("providerFailure received a successful result");
  }

  const retryDelaySeconds = result.error.retryAfterSeconds;

  return {
    status: result.error.retryable ? "retry" : "failed",
    errorCode: `api_football_${result.error.code}`,
    message: `API-Football ${endpoint} request failed: ${result.error.message}`,
    ...(retryDelaySeconds !== undefined ? { retryDelaySeconds } : {}),
  };
}

function parseStatistics(value: unknown): StandingStatistics | null {
  if (!isRecord(value) || !isRecord(value.goals)) {
    return null;
  }

  const played = requiredNonnegativeInteger(value.played);
  const wins = requiredNonnegativeInteger(value.win);
  const draws = requiredNonnegativeInteger(value.draw);
  const losses = requiredNonnegativeInteger(value.lose);
  const goalsFor = requiredNonnegativeInteger(value.goals.for);
  const goalsAgainst = requiredNonnegativeInteger(value.goals.against);

  if (
    played === null ||
    wins === null ||
    draws === null ||
    losses === null ||
    goalsFor === null ||
    goalsAgainst === null
  ) {
    return null;
  }

  return { played, wins, draws, losses, goalsFor, goalsAgainst };
}

function parseStandingRow(
  rawStanding: unknown,
): ParsedProviderStanding | SerieAStandingsSyncFailure {
  if (!isRecord(rawStanding) || !isRecord(rawStanding.team)) {
    return failed(
      "api_football_malformed_standings_data",
      "API-Football returned a standings row that is not a complete object.",
    );
  }

  const providerClubId = requiredPositiveInteger(rawStanding.team.id);
  const rank = requiredPositiveInteger(rawStanding.rank);
  const points = requiredInteger(rawStanding.points);
  const goalsDiff = requiredInteger(rawStanding.goalsDiff);
  const groupName = nullableString(rawStanding.group);
  const form = nullableString(rawStanding.form);
  const providerStatus = nullableString(rawStanding.status);
  const description = nullableString(rawStanding.description);
  const overall = parseStatistics(rawStanding.all);
  const home = parseStatistics(rawStanding.home);
  const away = parseStatistics(rawStanding.away);

  if (
    providerClubId === null ||
    rank === null ||
    points === null ||
    goalsDiff === null ||
    groupName === undefined ||
    form === undefined ||
    providerStatus === undefined ||
    description === undefined ||
    !overall ||
    !home ||
    !away
  ) {
    return failed(
      "api_football_malformed_standings_data",
      "API-Football returned malformed Serie A standings data.",
    );
  }

  return {
    providerClubId,
    groupName,
    rank,
    points,
    goalsDiff,
    form,
    providerStatus,
    description,
    overall,
    home,
    away,
    providerRaw: rawStanding,
  };
}

function parseStandingsResponse(
  data: unknown,
): ParsedProviderStanding[] | SerieAStandingsSyncFailure {
  if (!Array.isArray(data) || data.length !== 1 || !isRecord(data[0])) {
    return failed(
      "api_football_malformed_standings_response",
      "API-Football returned an unexpected standings response structure.",
    );
  }

  const league = data[0].league;

  if (
    !isRecord(league) ||
    league.id !== SERIE_A_PROVIDER_LEAGUE_ID ||
    league.season !== SERIE_A_CURRENT_SEASON ||
    !Array.isArray(league.standings) ||
    league.standings.length !== 1 ||
    !Array.isArray(league.standings[0])
  ) {
    return failed(
      "api_football_malformed_standings_response",
      "API-Football returned standings outside the approved Serie A scope.",
    );
  }

  const table = league.standings[0];

  if (table.length !== SERIE_A_EXPECTED_CURRENT_STANDINGS_ROWS) {
    return failed(
      "api_football_unexpected_standings_count",
      `Expected ${SERIE_A_EXPECTED_CURRENT_STANDINGS_ROWS} Serie A standings rows, got ${table.length}.`,
    );
  }

  const seenClubIds = new Set<number>();
  const seenRanks = new Set<number>();
  const standings: ParsedProviderStanding[] = [];

  for (const rawStanding of table) {
    const standing = parseStandingRow(rawStanding);

    if ("errorCode" in standing) {
      return standing;
    }

    if (seenClubIds.has(standing.providerClubId)) {
      return failed(
        "api_football_duplicate_standings_club",
        "API-Football returned duplicate club identities in the standings table.",
      );
    }

    if (seenRanks.has(standing.rank)) {
      return failed(
        "api_football_duplicate_standings_rank",
        "API-Football returned duplicate ranks in the standings table.",
      );
    }

    seenClubIds.add(standing.providerClubId);
    seenRanks.add(standing.rank);
    standings.push(standing);
  }

  return standings;
}

function resolveStandings(
  context: SerieAStandingsContext,
  standings: ParsedProviderStanding[],
): UpsertStandingInput[] | SerieAStandingsSyncFailure {
  if (context.clubIdsByProviderId.size !== SERIE_A_EXPECTED_CURRENT_STANDINGS_ROWS) {
    return failed(
      "football_season_membership_incomplete",
      "Persisted Serie A season membership must contain exactly 20 clubs.",
    );
  }

  const resolved: UpsertStandingInput[] = [];

  for (const standing of standings) {
    const clubId = context.clubIdsByProviderId.get(standing.providerClubId);

    if (!clubId) {
      return failed(
        "api_football_standings_club_not_found",
        "API-Football returned a standings club outside the persisted Serie A season.",
      );
    }

    resolved.push({
      seasonId: context.seasonId,
      clubId,
      groupName: standing.groupName,
      rank: standing.rank,
      points: standing.points,
      goalsDiff: standing.goalsDiff,
      form: standing.form,
      providerStatus: standing.providerStatus,
      description: standing.description,
      overall: standing.overall,
      home: standing.home,
      away: standing.away,
      providerRaw: standing.providerRaw,
    });
  }

  return resolved;
}

async function persistStandings(
  client: PoolClient,
  parsedStandings: ParsedProviderStanding[],
  heartbeat?: () => Promise<void>,
): Promise<SerieAStandingsSyncResult> {
  const context = await getSerieAStandingsContext(client);

  if (!context) {
    return failed(
      "football_season_not_found",
      "Persisted Serie A competition, season and clubs are required before syncing standings.",
    );
  }

  const standings = resolveStandings(context, parsedStandings);

  if ("status" in standings) {
    return standings;
  }

  // Free the season's unique rank slots before applying a validated snapshot
  // so ordinary club position swaps cannot collide during sequential upserts.
  await reserveStandingRanksForSnapshot(client, context.seasonId);

  for (const standing of standings) {
    await upsertStanding(client, standing);
  }

  await heartbeat?.();

  return {
    status: "success",
    standingCount: standings.length,
  };
}

export async function syncSerieAStandings(
  input: SerieAStandingsSyncInput,
): Promise<SerieAStandingsSyncResult> {
  await input.heartbeat?.();

  const standingsResult = await input.client.get<unknown>("/standings", {
    league: SERIE_A_PROVIDER_LEAGUE_ID,
    season: SERIE_A_CURRENT_SEASON,
  });

  if (!standingsResult.ok) {
    return providerFailure("standings", standingsResult);
  }

  const parsedStandings = parseStandingsResponse(standingsResult.data);

  if ("status" in parsedStandings) {
    return parsedStandings;
  }

  await input.heartbeat?.();

  if (input.transactionClient) {
    return persistStandings(
      input.transactionClient,
      parsedStandings,
      input.heartbeat,
    );
  }

  const client = await input.pool.connect();
  let transactionStarted = false;

  try {
    await client.query("begin");
    transactionStarted = true;

    const result = await persistStandings(client, parsedStandings, input.heartbeat);

    if (result.status !== "success") {
      await client.query("rollback");
      transactionStarted = false;

      return result;
    }

    await client.query("commit");
    transactionStarted = false;

    return result;
  } catch (error) {
    if (transactionStarted) {
      await client.query("rollback");
    }

    throw error;
  } finally {
    client.release();
  }
}
