import type { Pool, PoolClient } from "pg";

import type { ApiFootballClient, ApiFootballResult } from "./api-football/node";
import {
  isMatchActivityExpectedState,
  type NormalizedFixtureState,
} from "./api-football/fixture-status";
import {
  getCurrentSerieAMatchEventContext,
  replaceMatchEvents,
  resolveApiFootballPlayerIds,
  type InsertMatchEventInput,
  type MatchEventContext,
} from "./match-events-repository";

type ApiFootballPlayerReference = {
  id?: unknown;
  name?: unknown;
};

type ApiFootballEventResponse = {
  time?: {
    elapsed?: unknown;
    extra?: unknown;
  };
  team?: {
    id?: unknown;
  };
  player?: ApiFootballPlayerReference | null;
  assist?: ApiFootballPlayerReference | null;
  type?: unknown;
  detail?: unknown;
  comments?: unknown;
};

type ParsedPlayerReference = {
  providerPlayerId: number | null;
  providerPlayerName: string | null;
};

type ParsedMatchEvent = {
  providerOrder: number;
  elapsed: number;
  extra: number | null;
  providerClubId: number;
  player: ParsedPlayerReference;
  relatedPlayer: ParsedPlayerReference;
  providerType: string;
  providerDetail: string;
  comments: string | null;
  providerRaw: Record<string, unknown>;
};

export type MatchEventsEmptySnapshotAnomaly = {
  code: "api_football_empty_match_events";
  matchId: string;
  providerFixtureId: number;
  matchStatus: NormalizedFixtureState;
  providerResultCount: 0;
};

export type MatchEventsSyncSuccess = {
  status: "success";
  matchId: string;
  providerFixtureId: number;
  eventCount: number;
  emptySnapshotAnomaly: MatchEventsEmptySnapshotAnomaly | null;
};

export type MatchEventsSyncFailure = {
  status: "retry" | "failed";
  errorCode: string;
  message: string;
  retryDelaySeconds?: number;
};

export type MatchEventsSyncResult =
  | MatchEventsSyncSuccess
  | MatchEventsSyncFailure;

type MatchEventsDatabaseInput =
  | {
      pool: Pool;
      transactionClient?: never;
    }
  | {
      pool?: never;
      transactionClient: PoolClient;
    };

export type MatchEventsSyncInput = MatchEventsDatabaseInput & {
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

function isNonnegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function failed(errorCode: string, message: string): MatchEventsSyncFailure {
  return { status: "failed", errorCode, message };
}

function invalidData(message: string): MatchEventsSyncFailure {
  return failed("api_football_invalid_match_events", message);
}

function providerFailure(
  result: ApiFootballResult<unknown>,
): MatchEventsSyncFailure {
  if (result.ok) {
    throw new Error("providerFailure received a successful result");
  }

  return {
    status: result.error.retryable ? "retry" : "failed",
    errorCode: `api_football_${result.error.code}`,
    message: `API-Football fixtures/events request failed: ${result.error.message}`,
    ...(result.error.retryAfterSeconds !== undefined
      ? { retryDelaySeconds: result.error.retryAfterSeconds }
      : {}),
  };
}

function parsePlayerReference(value: unknown): ParsedPlayerReference | null {
  if (value === null) {
    return { providerPlayerId: null, providerPlayerName: null };
  }

  if (!isRecord(value) || !("id" in value) || !("name" in value)) {
    return null;
  }

  const reference = value as ApiFootballPlayerReference;
  const providerPlayerId = reference.id;
  const providerPlayerName = reference.name;

  if (
    providerPlayerId !== null &&
    !isPositiveInteger(providerPlayerId)
  ) {
    return null;
  }

  if (
    providerPlayerName !== null &&
    (typeof providerPlayerName !== "string" || !providerPlayerName.trim())
  ) {
    return null;
  }

  return {
    providerPlayerId,
    providerPlayerName,
  } as ParsedPlayerReference;
}

function parseEvent(
  rawEvent: unknown,
  providerOrder: number,
): ParsedMatchEvent | MatchEventsSyncFailure {
  if (!isRecord(rawEvent)) {
    return invalidData("API-Football returned a Match Event that is not an object.");
  }

  const event = rawEvent as ApiFootballEventResponse;
  const elapsed = event.time?.elapsed;
  const extra = event.time?.extra;
  const providerClubId = event.team?.id;
  const player = parsePlayerReference(event.player);
  const relatedPlayer = parsePlayerReference(event.assist);

  if (
    !isNonnegativeInteger(elapsed) ||
    (extra !== null && !isNonnegativeInteger(extra)) ||
    !isPositiveInteger(providerClubId) ||
    !player ||
    !relatedPlayer ||
    typeof event.type !== "string" ||
    !event.type.trim() ||
    typeof event.detail !== "string" ||
    !event.detail.trim() ||
    (event.comments !== null && typeof event.comments !== "string")
  ) {
    return invalidData("API-Football returned malformed Match Event data.");
  }

  return {
    providerOrder,
    elapsed,
    extra,
    providerClubId,
    player,
    relatedPlayer,
    providerType: event.type,
    providerDetail: event.detail,
    comments: event.comments,
    providerRaw: rawEvent,
  };
}

function parseEvents(
  data: unknown,
  results: number,
  paging: { current: number; total: number },
): ParsedMatchEvent[] | MatchEventsSyncFailure {
  if (!Array.isArray(data)) {
    return invalidData("API-Football returned a Match Events response that is not an array.");
  }

  if (results !== data.length || paging.current !== 1 || paging.total !== 1) {
    return invalidData("API-Football returned an inconsistent Match Events envelope.");
  }

  const events: ParsedMatchEvent[] = [];

  for (const [providerOrder, rawEvent] of data.entries()) {
    const parsed = parseEvent(rawEvent, providerOrder);

    if ("errorCode" in parsed) {
      return parsed;
    }

    events.push(parsed);
  }

  return events;
}

function resolveClubId(
  context: MatchEventContext,
  providerClubId: number,
): string | null {
  if (providerClubId === context.homeClub.providerClubId) {
    return context.homeClub.id;
  }

  if (providerClubId === context.awayClub.providerClubId) {
    return context.awayClub.id;
  }

  return null;
}

async function resolveEvents(
  queryable: Pick<Pool | PoolClient, "query">,
  context: MatchEventContext,
  events: ParsedMatchEvent[],
): Promise<InsertMatchEventInput[] | MatchEventsSyncFailure> {
  const clubIds = new Map<number, string>();

  for (const event of events) {
    const clubId = resolveClubId(context, event.providerClubId);

    if (!clubId) {
      return failed(
        "api_football_match_event_team_mismatch",
        `API-Football returned Match Event team ${event.providerClubId} outside the Match participants.`,
      );
    }

    clubIds.set(event.providerClubId, clubId);
  }

  const providerPlayerIds = [
    ...new Set(
      events.flatMap((event) =>
        [event.player.providerPlayerId, event.relatedPlayer.providerPlayerId].filter(
          (value): value is number => value !== null,
        ),
      ),
    ),
  ].sort((left, right) => left - right);
  const playerIds = await resolveApiFootballPlayerIds(queryable, providerPlayerIds);

  return events.map((event) => ({
    providerOrder: event.providerOrder,
    elapsed: event.elapsed,
    extra: event.extra,
    clubId: clubIds.get(event.providerClubId)!,
    providerPlayerId: event.player.providerPlayerId,
    providerPlayerName: event.player.providerPlayerName,
    playerId:
      event.player.providerPlayerId === null
        ? null
        : playerIds.get(event.player.providerPlayerId) ?? null,
    providerRelatedPlayerId: event.relatedPlayer.providerPlayerId,
    providerRelatedPlayerName: event.relatedPlayer.providerPlayerName,
    relatedPlayerId:
      event.relatedPlayer.providerPlayerId === null
        ? null
        : playerIds.get(event.relatedPlayer.providerPlayerId) ?? null,
    providerType: event.providerType,
    providerDetail: event.providerDetail,
    comments: event.comments,
    providerRaw: event.providerRaw,
  }));
}

function success(
  context: MatchEventContext,
  eventCount: number,
): MatchEventsSyncSuccess {
  const emptySnapshotAnomaly =
    eventCount === 0 && isMatchActivityExpectedState(context.status)
      ? {
          code: "api_football_empty_match_events" as const,
          matchId: context.matchId,
          providerFixtureId: context.providerFixtureId,
          matchStatus: context.status,
          providerResultCount: 0 as const,
        }
      : null;

  return {
    status: "success",
    matchId: context.matchId,
    providerFixtureId: context.providerFixtureId,
    eventCount,
    emptySnapshotAnomaly,
  };
}

export async function syncMatchEvents(
  input: MatchEventsSyncInput,
): Promise<MatchEventsSyncResult> {
  const queryable = input.transactionClient ?? input.pool;
  const context = await getCurrentSerieAMatchEventContext(queryable, input.matchId);

  if (!context) {
    return failed(
      "football_match_not_found",
      "The requested current Serie A Match was not found.",
    );
  }

  const providerResult = await input.client.get<unknown>("/fixtures/events", {
    fixture: context.providerFixtureId,
  });

  if (!providerResult.ok) {
    return providerFailure(providerResult);
  }

  const parsed = parseEvents(
    providerResult.data,
    providerResult.results,
    providerResult.paging,
  );

  if ("errorCode" in parsed) {
    return parsed;
  }

  const resolved = await resolveEvents(queryable, context, parsed);

  if ("errorCode" in resolved) {
    return resolved;
  }

  await input.heartbeat?.();

  if (input.transactionClient) {
    await replaceMatchEvents(input.transactionClient, context.matchId, resolved);
    return success(context, resolved.length);
  }

  const client = await input.pool.connect();
  let transactionStarted = false;

  try {
    await client.query("begin");
    transactionStarted = true;

    await replaceMatchEvents(client, context.matchId, resolved);

    await client.query("commit");
    transactionStarted = false;

    return success(context, resolved.length);
  } catch (error) {
    if (transactionStarted) {
      await client.query("rollback");
    }

    throw error;
  } finally {
    client.release();
  }
}
