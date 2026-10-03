import type { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";

import type {
  ApiFootballClient,
  ApiFootballRequestParameters,
  ApiFootballResult,
} from "@/src/football/api-football/node";
import { syncMatchEvents } from "@/src/football/match-events-sync";
import {
  MATCH_EVENTS_AWAY_PROVIDER_CLUB_ID,
  MATCH_EVENTS_HOME_PROVIDER_CLUB_ID,
  MATCH_EVENTS_MATCH_ID,
  MATCH_EVENTS_PROVIDER_FIXTURE_ID,
  createMatchEventsResponse,
} from "@/tests/fixtures/match-events";

type FixtureState =
  | "scheduled"
  | "live"
  | "paused"
  | "suspended"
  | "interrupted"
  | "postponed"
  | "abandoned"
  | "finished"
  | "cancelled"
  | "awarded"
  | "walkover";

function success<TResponse>(
  data: TResponse,
  overrides: Partial<Extract<ApiFootballResult<TResponse>, { ok: true }>> = {},
): ApiFootballResult<TResponse> {
  return {
    ok: true,
    data,
    results: Array.isArray(data) ? data.length : 1,
    paging: { current: 1, total: 1 },
    operation: "fixtures/events",
    attempts: 1,
    ...overrides,
  };
}

function providerClient(
  response: ApiFootballResult<unknown>,
  trace: string[] = [],
): ApiFootballClient {
  let requestAttempts = 0;

  return {
    getRequestAttemptCount: () => requestAttempts,
    async get<TResponse>(
      pathname: string,
      parameters: ApiFootballRequestParameters = {},
    ) {
      trace.push("fetch");
      requestAttempts += response.ok ? response.attempts : response.error.attempts;
      expect(pathname).toBe("/fixtures/events");
      expect(parameters).toEqual({ fixture: MATCH_EVENTS_PROVIDER_FIXTURE_ID });
      return response as ApiFootballResult<TResponse>;
    },
  };
}

function database(options: {
  status?: FixtureState;
  playerIds?: ReadonlyMap<number, string>;
  failInsertAt?: number;
  trace?: string[];
} = {}) {
  const trace = options.trace ?? [];
  const inserts: unknown[][] = [];
  let insertCount = 0;
  const transactionQuery = vi.fn(async (sql: string, values?: readonly unknown[]) => {
    const normalized = sql.trim().toLowerCase();

    if (["begin", "commit", "rollback"].includes(normalized)) {
      trace.push(normalized);
      return { rows: [] };
    }

    if (sql.includes("delete from football.match_events")) {
      trace.push("delete");
      return { rows: [] };
    }

    if (sql.includes("insert into football.match_events")) {
      insertCount += 1;
      trace.push(`insert:${insertCount}`);

      if (options.failInsertAt === insertCount) {
        throw new Error("forced match events insert failure");
      }

      inserts.push([...(values ?? [])]);
      return { rows: [] };
    }

    throw new Error(`Unexpected transaction query: ${sql}`);
  });
  const release = vi.fn();
  const query = vi.fn(async (sql: string, values?: readonly unknown[]) => {
    if (sql.includes("from football.competitions comp")) {
      trace.push("target");
      expect(values?.[0]).toBe(MATCH_EVENTS_MATCH_ID);
      return {
        rows: [
          {
            id: MATCH_EVENTS_MATCH_ID,
            provider_fixture_id: MATCH_EVENTS_PROVIDER_FIXTURE_ID,
            status: options.status ?? "finished",
            home_club_id: "club-home",
            home_provider_club_id: MATCH_EVENTS_HOME_PROVIDER_CLUB_ID,
            away_club_id: "club-away",
            away_provider_club_id: MATCH_EVENTS_AWAY_PROVIDER_CLUB_ID,
          },
        ],
      };
    }

    if (sql.includes("from football.players")) {
      trace.push("resolve_players");
      const requested = values?.[1] as number[];
      return {
        rows: requested.flatMap((providerPlayerId) => {
          const id = options.playerIds?.get(providerPlayerId);
          return id ? [{ id, provider_player_id: providerPlayerId }] : [];
        }),
      };
    }

    throw new Error(`Unexpected pre-transaction query: ${sql}`);
  });
  const connect = vi.fn(async () => {
    trace.push("connect");
    return { query: transactionQuery, release };
  });

  return {
    pool: { query, connect } as unknown as Pool,
    query,
    transactionQuery,
    release,
    inserts,
    trace,
  };
}

describe("Match Events synchronization", () => {
  it("validates, resolves and atomically replaces the complete real-shape snapshot", async () => {
    const trace: string[] = [];
    const db = database({
      trace,
      playerIds: new Map([
        [10_001, "player-out"],
        [10_002, "player-in"],
        [17, "player-scorer"],
      ]),
    });
    const heartbeat = vi.fn(async () => {
      trace.push("heartbeat");
    });
    const rawEvents = createMatchEventsResponse();

    await expect(
      syncMatchEvents({
        client: providerClient(success(rawEvents), trace),
        pool: db.pool,
        matchId: MATCH_EVENTS_MATCH_ID,
        heartbeat,
      }),
    ).resolves.toMatchObject({ status: "success", eventCount: 3 });

    expect(trace).toEqual([
      "target",
      "fetch",
      "resolve_players",
      "heartbeat",
      "connect",
      "begin",
      "delete",
      "insert:1",
      "insert:2",
      "insert:3",
      "commit",
    ]);
    expect(heartbeat).toHaveBeenCalledOnce();
    expect(db.release).toHaveBeenCalledOnce();

    const substitution = db.inserts[0]!;
    expect(substitution.slice(2, 15)).toEqual([
      0,
      46,
      2,
      "club-home",
      10_001,
      "Player Out",
      "player-out",
      10_002,
      "Player In",
      "player-in",
      "subst",
      "Substitution 1",
      null,
    ]);
    expect(JSON.parse(String(substitution[15]))).toEqual(rawEvents[0]);

    const unresolvedCard = db.inserts[2]!;
    expect(unresolvedCard[4]).toBe(6);
    expect(unresolvedCard[6]).toBe(10_004);
    expect(unresolvedCard[8]).toBeNull();
    expect(unresolvedCard[9]).toBeNull();
    expect(unresolvedCard[11]).toBeNull();
    expect(db.query.mock.calls.some(([sql]) => sql.includes("insert into football.players"))).toBe(false);
  });

  it.each([null, {}])("rejects a successful non-array response before resolution: %j", async (data) => {
    const db = database();
    const heartbeat = vi.fn(async () => undefined);

    await expect(
      syncMatchEvents({
        client: providerClient(success(data)),
        pool: db.pool,
        matchId: MATCH_EVENTS_MATCH_ID,
        heartbeat,
      }),
    ).resolves.toMatchObject({
      status: "failed",
      errorCode: "api_football_invalid_match_events",
    });
    expect(heartbeat).not.toHaveBeenCalled();
    expect(db.pool.connect).not.toHaveBeenCalled();
  });

  it("rejects an inconsistent envelope before mutation", async () => {
    const db = database();

    await expect(
      syncMatchEvents({
        client: providerClient(success(createMatchEventsResponse(), { results: 99 })),
        pool: db.pool,
        matchId: MATCH_EVENTS_MATCH_ID,
      }),
    ).resolves.toMatchObject({ errorCode: "api_football_invalid_match_events" });
    expect(db.pool.connect).not.toHaveBeenCalled();
  });

  it("rejects malformed known fields while preserving unknown types and fields", async () => {
    const malformed = createMatchEventsResponse();
    malformed[0]!.time.elapsed = -1;
    const invalidDb = database();

    await expect(
      syncMatchEvents({
        client: providerClient(success(malformed)),
        pool: invalidDb.pool,
        matchId: MATCH_EVENTS_MATCH_ID,
      }),
    ).resolves.toMatchObject({ errorCode: "api_football_invalid_match_events" });
    expect(invalidDb.pool.connect).not.toHaveBeenCalled();

    const unknown = createMatchEventsResponse().slice(0, 1);
    unknown[0]!.type = "Provider Future Type";
    unknown[0]!.detail = "Provider Future Detail";
    const validDb = database();

    await expect(
      syncMatchEvents({
        client: providerClient(success(unknown)),
        pool: validDb.pool,
        matchId: MATCH_EVENTS_MATCH_ID,
      }),
    ).resolves.toMatchObject({ status: "success" });
    expect(validDb.inserts[0]?.[12]).toBe("Provider Future Type");
    expect(validDb.inserts[0]?.[13]).toBe("Provider Future Detail");
    expect(JSON.parse(String(validDb.inserts[0]?.[15]))).toEqual(unknown[0]);
  });

  it("rejects a team outside the exact Match participants before player resolution or mutation", async () => {
    const events = createMatchEventsResponse();
    events[0]!.team.id = 500;
    const db = database();
    const heartbeat = vi.fn(async () => undefined);

    await expect(
      syncMatchEvents({
        client: providerClient(success(events)),
        pool: db.pool,
        matchId: MATCH_EVENTS_MATCH_ID,
        heartbeat,
      }),
    ).resolves.toMatchObject({
      status: "failed",
      errorCode: "api_football_match_event_team_mismatch",
    });
    expect(db.query.mock.calls.some(([sql]) => sql.includes("from football.players"))).toBe(false);
    expect(heartbeat).not.toHaveBeenCalled();
    expect(db.pool.connect).not.toHaveBeenCalled();
  });

  it("links a Player that appears before the next full resync without auto-creating it", async () => {
    const events = createMatchEventsResponse().slice(2);
    const first = database();

    await syncMatchEvents({
      client: providerClient(success(events)),
      pool: first.pool,
      matchId: MATCH_EVENTS_MATCH_ID,
    });
    expect(first.inserts[0]?.[8]).toBeNull();

    const second = database({ playerIds: new Map([[10_004, "late-player"]]) });
    await syncMatchEvents({
      client: providerClient(success(events)),
      pool: second.pool,
      matchId: MATCH_EVENTS_MATCH_ID,
    });
    expect(second.inserts[0]?.[8]).toBe("late-player");
    expect(second.query.mock.calls.some(([sql]) => sql.includes("insert into football.players"))).toBe(false);
  });

  it("recreates UUID rows, preserves exact array order and keeps same-time events separate", async () => {
    const sameTime = createMatchEventsResponse().slice(0, 2);
    sameTime[1]!.time = { elapsed: 46, extra: 2 };
    sameTime[1]!.type = "subst";
    const first = database();

    await syncMatchEvents({
      client: providerClient(success(sameTime)),
      pool: first.pool,
      matchId: MATCH_EVENTS_MATCH_ID,
    });

    const second = database();
    await syncMatchEvents({
      client: providerClient(success([...sameTime].reverse())),
      pool: second.pool,
      matchId: MATCH_EVENTS_MATCH_ID,
    });

    expect(first.inserts).toHaveLength(2);
    expect(second.inserts).toHaveLength(2);
    expect(first.inserts.map((values) => values[0])).not.toEqual(
      second.inserts.map((values) => values[0]),
    );
    expect(second.inserts.map((values) => values[2])).toEqual([0, 1]);
    expect(JSON.parse(String(second.inserts[0]?.[15]))).toEqual(sameTime[1]);
  });

  it("rolls back when a later insert fails and never heartbeats inside the transaction", async () => {
    const trace: string[] = [];
    const db = database({ failInsertAt: 2, trace });
    const heartbeat = vi.fn(async () => {
      trace.push("heartbeat");
    });

    await expect(
      syncMatchEvents({
        client: providerClient(success(createMatchEventsResponse()), trace),
        pool: db.pool,
        matchId: MATCH_EVENTS_MATCH_ID,
        heartbeat,
      }),
    ).rejects.toThrow("forced match events insert failure");
    expect(trace).toEqual([
      "target",
      "fetch",
      "resolve_players",
      "heartbeat",
      "connect",
      "begin",
      "delete",
      "insert:1",
      "insert:2",
      "rollback",
    ]);
    expect(heartbeat).toHaveBeenCalledOnce();
  });

  it("stops before the transaction when the existing heartbeat loses ownership", async () => {
    const db = database();
    const heartbeat = vi.fn(async () => {
      throw new Error("job_lease_lost");
    });

    await expect(
      syncMatchEvents({
        client: providerClient(success(createMatchEventsResponse())),
        pool: db.pool,
        matchId: MATCH_EVENTS_MATCH_ID,
        heartbeat,
      }),
    ).rejects.toThrow("job_lease_lost");
    expect(heartbeat).toHaveBeenCalledOnce();
    expect(db.pool.connect).not.toHaveBeenCalled();
    expect(db.transactionQuery).not.toHaveBeenCalled();
  });

  it.each(["scheduled", "postponed", "cancelled", "walkover"] as const)(
    "accepts an authoritative empty %s snapshot without an anomaly",
    async (status) => {
      const db = database({ status });

      await expect(
        syncMatchEvents({
          client: providerClient(success([])),
          pool: db.pool,
          matchId: MATCH_EVENTS_MATCH_ID,
        }),
      ).resolves.toMatchObject({
        status: "success",
        eventCount: 0,
        emptySnapshotAnomaly: null,
      });
      expect(db.trace).toContain("delete");
      expect(db.trace).not.toContain("insert:1");
    },
  );

  it.each([
    "live",
    "paused",
    "suspended",
    "interrupted",
    "abandoned",
    "finished",
    "awarded",
  ] as const)("accepts an authoritative empty %s snapshot with an anomaly", async (status) => {
    const db = database({ status });

    await expect(
      syncMatchEvents({
        client: providerClient(success([])),
        pool: db.pool,
        matchId: MATCH_EVENTS_MATCH_ID,
      }),
    ).resolves.toMatchObject({
      status: "success",
      eventCount: 0,
      emptySnapshotAnomaly: {
        code: "api_football_empty_match_events",
        matchId: MATCH_EVENTS_MATCH_ID,
        providerFixtureId: MATCH_EVENTS_PROVIDER_FIXTURE_ID,
        matchStatus: status,
        providerResultCount: 0,
      },
    });
    expect(db.trace).toContain("commit");
  });

  it("keeps transient provider failures retryable without mutation", async () => {
    const db = database();
    const response: ApiFootballResult<unknown> = {
      ok: false,
      error: {
        code: "http_server_error",
        message: "Provider unavailable",
        retryable: true,
        retryAfterSeconds: 30,
        attempts: 3,
      },
    };

    await expect(
      syncMatchEvents({
        client: providerClient(response),
        pool: db.pool,
        matchId: MATCH_EVENTS_MATCH_ID,
      }),
    ).resolves.toEqual({
      status: "retry",
      errorCode: "api_football_http_server_error",
      message: "API-Football fixtures/events request failed: Provider unavailable",
      retryDelaySeconds: 30,
    });
    expect(db.pool.connect).not.toHaveBeenCalled();
  });

  it("fails before the provider call for an unknown or non-current Match", async () => {
    const query = vi.fn(async () => ({ rows: [] }));
    const connect = vi.fn();
    const client = providerClient(success(createMatchEventsResponse()));

    await expect(
      syncMatchEvents({
        client,
        pool: { query, connect } as unknown as Pool,
        matchId: MATCH_EVENTS_MATCH_ID,
      }),
    ).resolves.toMatchObject({
      status: "failed",
      errorCode: "football_match_not_found",
    });
    expect(client.getRequestAttemptCount()).toBe(0);
    expect(connect).not.toHaveBeenCalled();
  });
});
