import type { Pool, PoolClient } from "pg";

import type { ApiFootballClient, ApiFootballResult } from "./api-football/node";
import {
  isMatchActivityExpectedState,
  type NormalizedFixtureState,
} from "./api-football/fixture-status";
import {
  getCurrentSerieAMatchStatisticsContext,
  replaceMatchStatistics,
  type InsertMatchStatisticItemInput,
  type MatchStatisticsContext,
  type ReplaceMatchStatisticsInput,
} from "./match-statistics-repository";

type MatchSide = "home" | "away";

type ParsedMatchStatistics = Omit<ReplaceMatchStatisticsInput, "clubId"> & {
  providerClubId: number;
  clubId: string;
  side: MatchSide;
};

export type MatchStatisticsEmptySnapshotAnomaly = {
  code: "api_football_empty_match_statistics";
  matchId: string;
  providerFixtureId: number;
  matchStatus: NormalizedFixtureState;
  providerResultCount: 0;
  persistedSides: MatchSide[];
};

export type MatchStatisticsPartialSnapshotAnomaly = {
  code: "api_football_partial_match_statistics";
  matchId: string;
  providerFixtureId: number;
  receivedProviderTeamIds: number[];
  missingSide: MatchSide;
  missingProviderTeamId: number;
};

export type MatchStatisticsEmptyTeamAnomaly = {
  code: "api_football_empty_match_statistics_team";
  matchId: string;
  providerFixtureId: number;
  matchStatus: NormalizedFixtureState;
  teams: Array<{
    providerTeamId: number;
    clubId: string;
    side: MatchSide;
    persistedSnapshot: boolean;
  }>;
};

export type MatchStatisticsDuplicateTypeAnomaly = {
  code: "api_football_duplicate_match_statistic_type";
  matchId: string;
  providerFixtureId: number;
  duplicates: Array<{
    providerTeamId: number;
    providerType: string;
    providerOrders: number[];
  }>;
};

export type MatchStatisticsSyncAnomaly =
  | MatchStatisticsEmptySnapshotAnomaly
  | MatchStatisticsPartialSnapshotAnomaly
  | MatchStatisticsEmptyTeamAnomaly
  | MatchStatisticsDuplicateTypeAnomaly;

export type MatchStatisticsSyncSuccess = {
  status: "success";
  matchId: string;
  providerFixtureId: number;
  receivedTeamCount: number;
  replacedTeamCount: number;
  itemCount: number;
  anomalies: MatchStatisticsSyncAnomaly[];
};

export type MatchStatisticsSyncFailure = {
  status: "retry" | "failed";
  errorCode: string;
  message: string;
  retryDelaySeconds?: number;
};

export type MatchStatisticsSyncResult =
  | MatchStatisticsSyncSuccess
  | MatchStatisticsSyncFailure;

type MatchStatisticsDatabaseInput =
  | { pool: Pool; transactionClient?: never }
  | { pool?: never; transactionClient: PoolClient };

export type MatchStatisticsSyncInput = MatchStatisticsDatabaseInput & {
  client: ApiFootballClient;
  matchId: string;
  heartbeat?: () => Promise<void>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function failed(errorCode: string, message: string): MatchStatisticsSyncFailure {
  return { status: "failed", errorCode, message };
}

function invalidData(message: string): MatchStatisticsSyncFailure {
  return failed("api_football_invalid_match_statistics", message);
}

function providerFailure(
  result: ApiFootballResult<unknown>,
): MatchStatisticsSyncFailure {
  if (result.ok) {
    throw new Error("providerFailure received a successful result");
  }

  return {
    status: result.error.retryable ? "retry" : "failed",
    errorCode: `api_football_${result.error.code}`,
    message: `API-Football fixtures/statistics request failed: ${result.error.message}`,
    ...(result.error.retryAfterSeconds !== undefined
      ? { retryDelaySeconds: result.error.retryAfterSeconds }
      : {}),
  };
}

function parseProviderValue(
  value: unknown,
): number | string | null | undefined {
  if (value === null || typeof value === "string") {
    return value;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  return undefined;
}

function parseStatisticItems(
  rawItems: unknown[],
): InsertMatchStatisticItemInput[] | MatchStatisticsSyncFailure {
  const items: InsertMatchStatisticItemInput[] = [];

  for (const [providerOrder, rawItem] of rawItems.entries()) {
    if (
      !isRecord(rawItem) ||
      !Object.hasOwn(rawItem, "type") ||
      !Object.hasOwn(rawItem, "value") ||
      typeof rawItem.type !== "string" ||
      !rawItem.type.trim()
    ) {
      return invalidData("API-Football returned a malformed Match Statistic item.");
    }

    const providerValue = parseProviderValue(rawItem.value);

    if (providerValue === undefined) {
      return invalidData("API-Football returned an unsupported Match Statistic value.");
    }

    items.push({
      providerType: rawItem.type,
      providerValue,
      providerOrder,
      providerRaw: rawItem,
    });
  }

  return items;
}

function resolveTeam(
  context: MatchStatisticsContext,
  providerClubId: number,
): { clubId: string; side: MatchSide } | null {
  if (providerClubId === context.homeClub.providerClubId) {
    return { clubId: context.homeClub.id, side: "home" };
  }

  if (providerClubId === context.awayClub.providerClubId) {
    return { clubId: context.awayClub.id, side: "away" };
  }

  return null;
}

function parseStatistics(
  data: unknown,
  results: number,
  paging: { current: number; total: number },
  context: MatchStatisticsContext,
): ParsedMatchStatistics[] | MatchStatisticsSyncFailure {
  if (!Array.isArray(data)) {
    return invalidData("API-Football returned a Match Statistics response that is not an array.");
  }

  if (
    !Number.isInteger(results) ||
    results < 0 ||
    results !== data.length ||
    !Number.isInteger(paging.current) ||
    paging.current < 0 ||
    !Number.isInteger(paging.total) ||
    paging.total < 0
  ) {
    return invalidData("API-Football returned an inconsistent Match Statistics envelope.");
  }

  const snapshots: ParsedMatchStatistics[] = [];
  const seenTeams = new Set<number>();

  for (const rawGroup of data) {
    if (
      !isRecord(rawGroup) ||
      !isRecord(rawGroup.team) ||
      !isPositiveInteger(rawGroup.team.id) ||
      !Array.isArray(rawGroup.statistics)
    ) {
      return invalidData("API-Football returned malformed Match Statistics team data.");
    }

    const providerClubId = rawGroup.team.id;
    const resolved = resolveTeam(context, providerClubId);

    if (!resolved) {
      return failed(
        "api_football_match_statistics_team_mismatch",
        `API-Football returned Match Statistics team ${providerClubId} outside the Match participants.`,
      );
    }

    if (seenTeams.has(providerClubId)) {
      return failed(
        "api_football_duplicate_match_statistics_team",
        `API-Football returned duplicate Match Statistics team ${providerClubId}.`,
      );
    }

    const items = parseStatisticItems(rawGroup.statistics);

    if ("errorCode" in items) {
      return items;
    }

    seenTeams.add(providerClubId);
    snapshots.push({
      providerClubId,
      clubId: resolved.clubId,
      side: resolved.side,
      scope: "full_match",
      providerRaw: rawGroup,
      items,
    });
  }

  return snapshots;
}

function persistedSides(context: MatchStatisticsContext): MatchSide[] {
  const persisted = new Set(context.persistedStatisticsClubIds);
  const sides: MatchSide[] = [];

  if (persisted.has(context.homeClub.id)) {
    sides.push("home");
  }

  if (persisted.has(context.awayClub.id)) {
    sides.push("away");
  }

  return sides;
}

function buildAnomalies(
  context: MatchStatisticsContext,
  snapshots: readonly ParsedMatchStatistics[],
): MatchStatisticsSyncAnomaly[] {
  const anomalies: MatchStatisticsSyncAnomaly[] = [];

  if (snapshots.length === 0) {
    const existingSides = persistedSides(context);

    if (
      existingSides.length > 0 ||
      isMatchActivityExpectedState(context.status)
    ) {
      anomalies.push({
        code: "api_football_empty_match_statistics",
        matchId: context.matchId,
        providerFixtureId: context.providerFixtureId,
        matchStatus: context.status,
        providerResultCount: 0,
        persistedSides: existingSides,
      });
    }

    return anomalies;
  }

  if (snapshots.length === 1) {
    const received = snapshots[0]!;
    const missingHome = received.side === "away";

    anomalies.push({
      code: "api_football_partial_match_statistics",
      matchId: context.matchId,
      providerFixtureId: context.providerFixtureId,
      receivedProviderTeamIds: [received.providerClubId],
      missingSide: missingHome ? "home" : "away",
      missingProviderTeamId: missingHome
        ? context.homeClub.providerClubId
        : context.awayClub.providerClubId,
    });
  }

  const emptyTeams = snapshots
    .filter((snapshot) => snapshot.items.length === 0)
    .map((snapshot) => ({
      providerTeamId: snapshot.providerClubId,
      clubId: snapshot.clubId,
      side: snapshot.side,
      persistedSnapshot: context.persistedStatisticsClubIds.includes(
        snapshot.clubId,
      ),
    }));

  if (emptyTeams.length > 0) {
    anomalies.push({
      code: "api_football_empty_match_statistics_team",
      matchId: context.matchId,
      providerFixtureId: context.providerFixtureId,
      matchStatus: context.status,
      teams: emptyTeams,
    });
  }

  const duplicates: MatchStatisticsDuplicateTypeAnomaly["duplicates"] = [];

  for (const snapshot of snapshots) {
    const ordersByType = new Map<string, number[]>();

    for (const item of snapshot.items) {
      const orders = ordersByType.get(item.providerType) ?? [];
      orders.push(item.providerOrder);
      ordersByType.set(item.providerType, orders);
    }

    for (const [providerType, providerOrders] of ordersByType) {
      if (providerOrders.length > 1) {
        duplicates.push({
          providerTeamId: snapshot.providerClubId,
          providerType,
          providerOrders,
        });
      }
    }
  }

  if (duplicates.length > 0) {
    anomalies.push({
      code: "api_football_duplicate_match_statistic_type",
      matchId: context.matchId,
      providerFixtureId: context.providerFixtureId,
      duplicates,
    });
  }

  return anomalies;
}

function success(
  context: MatchStatisticsContext,
  received: readonly ParsedMatchStatistics[],
  replacements: readonly ParsedMatchStatistics[],
  anomalies: MatchStatisticsSyncAnomaly[],
): MatchStatisticsSyncSuccess {
  return {
    status: "success",
    matchId: context.matchId,
    providerFixtureId: context.providerFixtureId,
    receivedTeamCount: received.length,
    replacedTeamCount: replacements.length,
    itemCount: replacements.reduce(
      (count, snapshot) => count + snapshot.items.length,
      0,
    ),
    anomalies,
  };
}

export async function syncMatchStatistics(
  input: MatchStatisticsSyncInput,
): Promise<MatchStatisticsSyncResult> {
  const queryable = input.transactionClient ?? input.pool;
  const context = await getCurrentSerieAMatchStatisticsContext(
    queryable,
    input.matchId,
  );

  if (!context) {
    return failed(
      "football_match_not_found",
      "The requested current Serie A Match was not found.",
    );
  }

  const providerResult = await input.client.get<unknown>(
    "/fixtures/statistics",
    { fixture: context.providerFixtureId },
  );

  if (!providerResult.ok) {
    return providerFailure(providerResult);
  }

  const parsed = parseStatistics(
    providerResult.data,
    providerResult.results,
    providerResult.paging,
    context,
  );

  if ("errorCode" in parsed) {
    return parsed;
  }

  const anomalies = buildAnomalies(context, parsed);
  const replacements = parsed.filter((snapshot) => snapshot.items.length > 0);

  await input.heartbeat?.();

  if (replacements.length === 0) {
    return success(context, parsed, replacements, anomalies);
  }

  if (input.transactionClient) {
    await replaceMatchStatistics(
      input.transactionClient,
      context.matchId,
      replacements,
    );
    return success(context, parsed, replacements, anomalies);
  }

  const client = await input.pool.connect();
  let transactionStarted = false;

  try {
    await client.query("begin");
    transactionStarted = true;

    await replaceMatchStatistics(client, context.matchId, replacements);

    await client.query("commit");
    transactionStarted = false;

    return success(context, parsed, replacements, anomalies);
  } catch (error) {
    if (transactionStarted) {
      await client.query("rollback");
    }

    throw error;
  } finally {
    client.release();
  }
}
