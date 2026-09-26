import type { Pool, PoolClient } from "pg";

import type { ApiFootballClient, ApiFootballResult } from "./api-football/node";
import {
  normalizeApiFootballFixtureStatus,
  UnsupportedApiFootballFixtureStatusError,
} from "./api-football/fixture-status";
import {
  SERIE_A_CURRENT_SEASON,
  SERIE_A_EXPECTED_CURRENT_MATCHES,
  SERIE_A_PROVIDER_LEAGUE_ID,
} from "./foundation";
import {
  getSerieASeasonClubContext,
  upsertMatch,
  type SerieASeasonClubContext,
  type UpsertMatchInput,
} from "./matches-repository";

type ApiFootballFixtureResponse = {
  fixture?: {
    id?: unknown;
    referee?: unknown;
    timezone?: unknown;
    date?: unknown;
    timestamp?: unknown;
    periods?: {
      first?: unknown;
      second?: unknown;
    };
    venue?: {
      id?: unknown;
      name?: unknown;
      city?: unknown;
    };
    status?: {
      long?: unknown;
      short?: unknown;
      elapsed?: unknown;
      extra?: unknown;
    };
  };
  league?: {
    id?: unknown;
    season?: unknown;
    round?: unknown;
  };
  teams?: {
    home?: {
      id?: unknown;
      winner?: unknown;
    };
    away?: {
      id?: unknown;
      winner?: unknown;
    };
  };
  goals?: {
    home?: unknown;
    away?: unknown;
  };
  score?: {
    halftime?: {
      home?: unknown;
      away?: unknown;
    };
    fulltime?: {
      home?: unknown;
      away?: unknown;
    };
    extratime?: {
      home?: unknown;
      away?: unknown;
    };
    penalty?: {
      home?: unknown;
      away?: unknown;
    };
  };
};

type ParsedProviderMatch = Omit<UpsertMatchInput, "homeClubId" | "awayClubId" | "seasonId"> & {
  homeProviderClubId: number;
  awayProviderClubId: number;
};

export type SerieAMatchesSyncSuccess = {
  status: "success";
  matchCount: number;
};

export type SerieAMatchesSyncFailure = {
  status: "retry" | "failed";
  errorCode: string;
  message: string;
  retryDelaySeconds?: number;
};

export type SerieAMatchesSyncResult =
  | SerieAMatchesSyncSuccess
  | SerieAMatchesSyncFailure;

type SerieAMatchesDatabaseInput =
  | {
      pool: Pool;
      transactionClient?: never;
    }
  | {
      pool?: never;
      transactionClient: PoolClient;
    };

export type SerieAMatchesSyncInput = SerieAMatchesDatabaseInput & {
  client: ApiFootballClient;
  heartbeat?: () => Promise<void>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function asOptionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function asRequiredInteger(value: unknown): number | null {
  return Number.isInteger(value) && typeof value === "number" && value > 0
    ? value
    : null;
}

function asOptionalInteger(value: unknown): number | null {
  return Number.isInteger(value) ? (value as number) : null;
}

function asOptionalBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function asOptionalKickoffAt(value: unknown): Date | null | undefined {
  if (value == null || value === "") {
    return null;
  }

  if (typeof value !== "string") {
    return undefined;
  }

  const parsed = new Date(value);

  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function providerFailure(
  endpoint: string,
  result: ApiFootballResult<unknown>,
): SerieAMatchesSyncFailure {
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

function failed(errorCode: string, message: string): SerieAMatchesSyncFailure {
  return {
    status: "failed",
    errorCode,
    message,
  };
}

function parseFixture(
  rawFixture: unknown,
): ParsedProviderMatch | SerieAMatchesSyncFailure {
  if (!isRecord(rawFixture)) {
    return failed(
      "api_football_malformed_fixture_data",
      "API-Football returned a fixture entry that is not an object.",
    );
  }

  const fixture = rawFixture as ApiFootballFixtureResponse;
  const providerFixtureId = asRequiredInteger(fixture.fixture?.id);
  const leagueId = asRequiredInteger(fixture.league?.id);
  const seasonYear = asRequiredInteger(fixture.league?.season);
  const round = asString(fixture.league?.round);
  const homeProviderClubId = asRequiredInteger(fixture.teams?.home?.id);
  const awayProviderClubId = asRequiredInteger(fixture.teams?.away?.id);
  const providerStatusShort = asString(fixture.fixture?.status?.short);
  const kickoffAt = asOptionalKickoffAt(fixture.fixture?.date);

  if (
    !providerFixtureId ||
    leagueId !== SERIE_A_PROVIDER_LEAGUE_ID ||
    seasonYear !== SERIE_A_CURRENT_SEASON ||
    !round ||
    !homeProviderClubId ||
    !awayProviderClubId ||
    !providerStatusShort ||
    kickoffAt === undefined
  ) {
    return failed(
      "api_football_malformed_fixture_data",
      "API-Football returned incomplete or out-of-scope Serie A fixture data.",
    );
  }

  if (homeProviderClubId === awayProviderClubId) {
    return failed(
      "api_football_invalid_fixture_clubs",
      "API-Football returned a fixture with the same home and away team.",
    );
  }

  let normalizedStatus;

  try {
    normalizedStatus = normalizeApiFootballFixtureStatus(providerStatusShort);
  } catch (error) {
    if (error instanceof UnsupportedApiFootballFixtureStatusError) {
      return failed(
        "api_football_unknown_fixture_status",
        `API-Football returned an unsupported fixture status: ${error.message}.`,
      );
    }

    throw error;
  }

  return {
    providerFixtureId,
    homeProviderClubId,
    awayProviderClubId,
    round,
    kickoffAt,
    providerTimezone: asOptionalString(fixture.fixture?.timezone),
    providerTimestamp: asOptionalInteger(fixture.fixture?.timestamp),
    firstPeriodStart: asOptionalInteger(fixture.fixture?.periods?.first),
    secondPeriodStart: asOptionalInteger(fixture.fixture?.periods?.second),
    referee: asOptionalString(fixture.fixture?.referee),
    providerVenueId: asOptionalInteger(fixture.fixture?.venue?.id),
    venueName: asOptionalString(fixture.fixture?.venue?.name),
    venueCity: asOptionalString(fixture.fixture?.venue?.city),
    status: normalizedStatus.state,
    pollingCategory: normalizedStatus.pollingCategory,
    providerStatusLong: asOptionalString(fixture.fixture?.status?.long),
    providerStatusShort,
    statusElapsed: asOptionalInteger(fixture.fixture?.status?.elapsed),
    statusExtra: asOptionalInteger(fixture.fixture?.status?.extra),
    homeWinner: asOptionalBoolean(fixture.teams?.home?.winner),
    awayWinner: asOptionalBoolean(fixture.teams?.away?.winner),
    homeGoals: asOptionalInteger(fixture.goals?.home),
    awayGoals: asOptionalInteger(fixture.goals?.away),
    halftimeHome: asOptionalInteger(fixture.score?.halftime?.home),
    halftimeAway: asOptionalInteger(fixture.score?.halftime?.away),
    fulltimeHome: asOptionalInteger(fixture.score?.fulltime?.home),
    fulltimeAway: asOptionalInteger(fixture.score?.fulltime?.away),
    extratimeHome: asOptionalInteger(fixture.score?.extratime?.home),
    extratimeAway: asOptionalInteger(fixture.score?.extratime?.away),
    penaltyHome: asOptionalInteger(fixture.score?.penalty?.home),
    penaltyAway: asOptionalInteger(fixture.score?.penalty?.away),
    providerRaw: rawFixture,
  };
}

function parseFixtures(
  data: unknown[],
): ParsedProviderMatch[] | SerieAMatchesSyncFailure {
  if (data.length !== SERIE_A_EXPECTED_CURRENT_MATCHES) {
    return failed(
      "api_football_unexpected_fixture_count",
      `Expected ${SERIE_A_EXPECTED_CURRENT_MATCHES} Serie A fixtures, got ${data.length}.`,
    );
  }

  const seenFixtureIds = new Set<number>();
  const matches: ParsedProviderMatch[] = [];

  for (const rawFixture of data) {
    const parsed = parseFixture(rawFixture);

    if ("errorCode" in parsed) {
      return parsed;
    }

    if (seenFixtureIds.has(parsed.providerFixtureId)) {
      return failed(
        "api_football_duplicate_fixture_id",
        "API-Football returned duplicate fixture identities.",
      );
    }

    seenFixtureIds.add(parsed.providerFixtureId);
    matches.push(parsed);
  }

  return matches;
}

function resolveMatches(
  context: SerieASeasonClubContext,
  matches: ParsedProviderMatch[],
): UpsertMatchInput[] | SerieAMatchesSyncFailure {
  const resolvedMatches: UpsertMatchInput[] = [];

  for (const match of matches) {
    const homeClubId = context.clubIdsByProviderId.get(match.homeProviderClubId);
    const awayClubId = context.clubIdsByProviderId.get(match.awayProviderClubId);

    if (!homeClubId || !awayClubId) {
      return failed(
        "api_football_fixture_club_not_found",
        "API-Football returned a fixture for a club outside the persisted Serie A season.",
      );
    }

    resolvedMatches.push({
      providerFixtureId: match.providerFixtureId,
      round: match.round,
      kickoffAt: match.kickoffAt,
      providerTimezone: match.providerTimezone,
      providerTimestamp: match.providerTimestamp,
      firstPeriodStart: match.firstPeriodStart,
      secondPeriodStart: match.secondPeriodStart,
      referee: match.referee,
      providerVenueId: match.providerVenueId,
      venueName: match.venueName,
      venueCity: match.venueCity,
      status: match.status,
      pollingCategory: match.pollingCategory,
      providerStatusLong: match.providerStatusLong,
      providerStatusShort: match.providerStatusShort,
      statusElapsed: match.statusElapsed,
      statusExtra: match.statusExtra,
      homeWinner: match.homeWinner,
      awayWinner: match.awayWinner,
      homeGoals: match.homeGoals,
      awayGoals: match.awayGoals,
      halftimeHome: match.halftimeHome,
      halftimeAway: match.halftimeAway,
      fulltimeHome: match.fulltimeHome,
      fulltimeAway: match.fulltimeAway,
      extratimeHome: match.extratimeHome,
      extratimeAway: match.extratimeAway,
      penaltyHome: match.penaltyHome,
      penaltyAway: match.penaltyAway,
      providerRaw: match.providerRaw,
      homeClubId,
      awayClubId,
      seasonId: context.seasonId,
    });
  }

  return resolvedMatches;
}

async function persistMatches(
  client: PoolClient,
  parsedFixtures: ParsedProviderMatch[],
  heartbeat?: () => Promise<void>,
): Promise<SerieAMatchesSyncResult> {
  const context = await getSerieASeasonClubContext(client);

  if (!context) {
    return failed(
      "football_season_not_found",
      "Persisted Serie A competition, season and clubs are required before syncing matches.",
    );
  }

  const matches = resolveMatches(context, parsedFixtures);

  if ("status" in matches) {
    return matches;
  }

  for (const match of matches) {
    await upsertMatch(client, match);
  }

  await heartbeat?.();

  return {
    status: "success",
    matchCount: matches.length,
  };
}

export async function syncSerieAMatches(
  input: SerieAMatchesSyncInput,
): Promise<SerieAMatchesSyncResult> {
  await input.heartbeat?.();

  const fixturesResult = await input.client.get<unknown>("/fixtures", {
    league: SERIE_A_PROVIDER_LEAGUE_ID,
    season: SERIE_A_CURRENT_SEASON,
  });

  if (!fixturesResult.ok) {
    return providerFailure("fixtures", fixturesResult);
  }

  if (!Array.isArray(fixturesResult.data)) {
    return failed(
      "api_football_malformed_fixture_data",
      "API-Football returned a fixtures response that is not an array.",
    );
  }

  const parsedFixtures = parseFixtures(fixturesResult.data);

  if ("status" in parsedFixtures) {
    return parsedFixtures;
  }

  await input.heartbeat?.();

  if (input.transactionClient) {
    return persistMatches(
      input.transactionClient,
      parsedFixtures,
      input.heartbeat,
    );
  }

  const client = await input.pool.connect();
  let transactionStarted = false;

  try {
    await client.query("begin");
    transactionStarted = true;

    const result = await persistMatches(client, parsedFixtures, input.heartbeat);

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
