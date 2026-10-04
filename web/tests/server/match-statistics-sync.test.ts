import type { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";

import type {
  ApiFootballClient,
  ApiFootballRequestParameters,
  ApiFootballResult,
} from "@/src/football/api-football/node";
import { syncMatchStatistics } from "@/src/football/match-statistics-sync";
import {
  MATCH_STATISTICS_AWAY_PROVIDER_CLUB_ID,
  MATCH_STATISTICS_HOME_PROVIDER_CLUB_ID,
  MATCH_STATISTICS_MATCH_ID,
  MATCH_STATISTICS_PROVIDER_FIXTURE_ID,
  createMatchStatistic,
  createMatchStatisticsResponse,
  createMatchStatisticsTeam,
} from "@/tests/fixtures/match-statistics";

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
    operation: "fixtures/statistics",
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
      expect(pathname).toBe("/fixtures/statistics");
      expect(parameters).toEqual({ fixture: MATCH_STATISTICS_PROVIDER_FIXTURE_ID });
      return response as ApiFootballResult<TResponse>;
    },
  };
}

function database(options: {
  failItemInsertAt?: number;
  persistedStatisticsClubIds?: string[];
  status?: FixtureState;
  targetExists?: boolean;
  trace?: string[];
} = {}) {
  const trace = options.trace ?? [];
  const deletedClubs: string[] = [];
  const snapshotInserts: unknown[][] = [];
  const itemInserts: unknown[][] = [];
  let itemInsertCount = 0;
  const transactionQuery = vi.fn(async (sql: string, values?: readonly unknown[]) => {
    const normalized = sql.trim().toLowerCase();

    if (["begin", "commit", "rollback"].includes(normalized)) {
      trace.push(normalized);
      return { rows: [] };
    }

    if (sql.includes("delete from football.match_statistics")) {
      deletedClubs.push(String(values?.[1]));
      trace.push(`delete:${values?.[1]}`);
      return { rows: [] };
    }

    if (sql.includes("insert into football.match_statistics")) {
      snapshotInserts.push([...(values ?? [])]);
      trace.push(`snapshot:${values?.[2]}`);
      return { rows: [] };
    }

    if (sql.includes("insert into football.match_statistic_items")) {
      itemInsertCount += 1;
      trace.push(`item:${itemInsertCount}`);

      if (options.failItemInsertAt === itemInsertCount) {
        throw new Error("forced Match Statistic item insert failure");
      }

      itemInserts.push([...(values ?? [])]);
      return { rows: [] };
    }

    throw new Error(`Unexpected transaction query: ${sql}`);
  });
  const release = vi.fn();
  const query = vi.fn(async (sql: string, values?: readonly unknown[]) => {
    if (sql.includes("from football.competitions comp")) {
      trace.push("target");
      expect(values?.[0]).toBe(MATCH_STATISTICS_MATCH_ID);
      return {
        rows: options.targetExists === false
          ? []
          : [{
              id: MATCH_STATISTICS_MATCH_ID,
              provider_fixture_id: MATCH_STATISTICS_PROVIDER_FIXTURE_ID,
              status: options.status ?? "finished",
              home_club_id: "club-home",
              home_provider_club_id: MATCH_STATISTICS_HOME_PROVIDER_CLUB_ID,
              away_club_id: "club-away",
              away_provider_club_id: MATCH_STATISTICS_AWAY_PROVIDER_CLUB_ID,
              persisted_statistics_club_ids:
                options.persistedStatisticsClubIds ?? [],
            }],
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
    deletedClubs,
    snapshotInserts,
    itemInserts,
    trace,
  };
}

describe("Match Statistics synchronization", () => {
  it("validates and atomically replaces two lossless team snapshots", async () => {
    const trace: string[] = [];
    const db = database({ trace });
    const heartbeat = vi.fn(async () => {
      trace.push("heartbeat");
    });
    const result = await syncMatchStatistics({
      client: providerClient(success(createMatchStatisticsResponse()), trace),
      pool: db.pool,
      matchId: MATCH_STATISTICS_MATCH_ID,
      heartbeat,
    });

    expect(result).toMatchObject({
      status: "success",
      receivedTeamCount: 2,
      replacedTeamCount: 2,
      itemCount: 9,
      anomalies: [],
    });
    expect(db.deletedClubs).toEqual(["club-home", "club-away"]);
    expect(db.snapshotInserts).toHaveLength(2);
    expect(db.itemInserts).toHaveLength(9);
    expect(db.itemInserts.slice(0, 5).map((values) => values[4])).toEqual([
      0, 1, 2, 3, 4,
    ]);
    expect(db.itemInserts.slice(0, 5).map((values) => values[3])).toEqual([
      "4", '"49%"', '"1.59"', "0", "null",
    ]);
    expect(trace.slice(0, 6)).toEqual([
      "target", "fetch", "heartbeat", "connect", "begin", "delete:club-home",
    ]);
    expect(trace.at(-1)).toBe("commit");
    expect(heartbeat).toHaveBeenCalledOnce();
  });

  it("replaces only a populated received side and reports the absent side", async () => {
    const db = database();
    const result = await syncMatchStatistics({
      client: providerClient(success([
        createMatchStatisticsTeam(MATCH_STATISTICS_HOME_PROVIDER_CLUB_ID),
      ])),
      pool: db.pool,
      matchId: MATCH_STATISTICS_MATCH_ID,
    });

    expect(result).toMatchObject({
      status: "success",
      receivedTeamCount: 1,
      replacedTeamCount: 1,
      anomalies: [{
        code: "api_football_partial_match_statistics",
        missingSide: "away",
        missingProviderTeamId: MATCH_STATISTICS_AWAY_PROVIDER_CLUB_ID,
      }],
    });
    expect(db.deletedClubs).toEqual(["club-home"]);
  });

  it("keeps an empty response as a no-op and warns only when suspicious", async () => {
    const scheduled = database({ status: "scheduled" });
    const scheduledResult = await syncMatchStatistics({
      client: providerClient(success([])),
      pool: scheduled.pool,
      matchId: MATCH_STATISTICS_MATCH_ID,
    });

    expect(scheduledResult).toMatchObject({
      status: "success",
      replacedTeamCount: 0,
      anomalies: [],
    });
    expect(scheduled.pool.connect).not.toHaveBeenCalled();

    const finished = database({
      status: "finished",
      persistedStatisticsClubIds: ["club-home"],
    });
    const finishedResult = await syncMatchStatistics({
      client: providerClient(success([])),
      pool: finished.pool,
      matchId: MATCH_STATISTICS_MATCH_ID,
    });

    expect(finishedResult).toMatchObject({
      status: "success",
      anomalies: [{
        code: "api_football_empty_match_statistics",
        matchStatus: "finished",
        persistedSides: ["home"],
      }],
    });
    expect(finished.pool.connect).not.toHaveBeenCalled();
  });

  it("retains an empty Team while replacing a populated Team", async () => {
    const db = database({ persistedStatisticsClubIds: ["club-home", "club-away"] });
    const result = await syncMatchStatistics({
      client: providerClient(success(createMatchStatisticsResponse([]))),
      pool: db.pool,
      matchId: MATCH_STATISTICS_MATCH_ID,
    });

    expect(result).toMatchObject({
      status: "success",
      receivedTeamCount: 2,
      replacedTeamCount: 1,
      anomalies: [{
        code: "api_football_empty_match_statistics_team",
        teams: [{
          providerTeamId: MATCH_STATISTICS_HOME_PROVIDER_CLUB_ID,
          clubId: "club-home",
          side: "home",
          persistedSnapshot: true,
        }],
      }],
    });
    expect(db.deletedClubs).toEqual(["club-away"]);
    expect(db.snapshotInserts.map((values) => values[2])).toEqual(["club-away"]);
  });

  it("keeps persistence unchanged when both received Teams are empty", async () => {
    const db = database({ persistedStatisticsClubIds: ["club-home"] });
    const result = await syncMatchStatistics({
      client: providerClient(success(createMatchStatisticsResponse([], []))),
      pool: db.pool,
      matchId: MATCH_STATISTICS_MATCH_ID,
    });

    expect(result).toMatchObject({
      status: "success",
      receivedTeamCount: 2,
      replacedTeamCount: 0,
      itemCount: 0,
      anomalies: [{
        code: "api_football_empty_match_statistics_team",
        teams: [
          { side: "home", persistedSnapshot: true },
          { side: "away", persistedSnapshot: false },
        ],
      }],
    });
    expect(db.pool.connect).not.toHaveBeenCalled();
  });

  it("preserves duplicate and unknown types in order with one anomaly", async () => {
    const duplicateItems = [
      createMatchStatistic("New Provider Metric", 1),
      createMatchStatistic("Fouls", 3),
      createMatchStatistic("Fouls", 4),
    ];
    const db = database();
    const result = await syncMatchStatistics({
      client: providerClient(success(createMatchStatisticsResponse(duplicateItems))),
      pool: db.pool,
      matchId: MATCH_STATISTICS_MATCH_ID,
    });

    expect(result).toMatchObject({
      status: "success",
      anomalies: [{
        code: "api_football_duplicate_match_statistic_type",
        duplicates: [{
          providerTeamId: MATCH_STATISTICS_HOME_PROVIDER_CLUB_ID,
          providerType: "Fouls",
          providerOrders: [1, 2],
        }],
      }],
    });
    expect(db.itemInserts.slice(0, 3).map((values) => values[2])).toEqual([
      "New Provider Metric", "Fouls", "Fouls",
    ]);
  });

  it("accepts different type sets and fractional JSON numbers", async () => {
    const db = database();
    const result = await syncMatchStatistics({
      client: providerClient(success(createMatchStatisticsResponse(
        [createMatchStatistic("Home Only", 1.25)],
        [createMatchStatistic("Away Only", 2)],
      ))),
      pool: db.pool,
      matchId: MATCH_STATISTICS_MATCH_ID,
    });

    expect(result).toMatchObject({ status: "success", anomalies: [] });
    expect(db.itemInserts.map((values) => values[3])).toEqual(["1.25", "2"]);
  });

  it("rejects malformed envelopes, items and unsupported provider values", async () => {
    const cases: ApiFootballResult<unknown>[] = [
      success(null),
      success([], { results: 1 }),
      success([], { paging: { current: -1, total: 1 } }),
      success([{ team: { id: MATCH_STATISTICS_HOME_PROVIDER_CLUB_ID } }]),
      success([createMatchStatisticsTeam(
        MATCH_STATISTICS_HOME_PROVIDER_CLUB_ID,
        [{ type: "", value: 1 }],
      )]),
      success([createMatchStatisticsTeam(
        MATCH_STATISTICS_HOME_PROVIDER_CLUB_ID,
        [{ type: "Fouls" }],
      )]),
      ...[true, {}, []].map((value) => success([
        createMatchStatisticsTeam(
          MATCH_STATISTICS_HOME_PROVIDER_CLUB_ID,
          [{ type: "Fouls", value }],
        ),
      ])),
    ];

    for (const response of cases) {
      const db = database();
      const result = await syncMatchStatistics({
        client: providerClient(response),
        pool: db.pool,
        matchId: MATCH_STATISTICS_MATCH_ID,
      });

      expect(result).toMatchObject({
        status: "failed",
        errorCode: "api_football_invalid_match_statistics",
      });
      expect(db.pool.connect).not.toHaveBeenCalled();
    }
  });

  it("rejects foreign and duplicate Teams before mutation", async () => {
    const responses = [
      [createMatchStatisticsTeam(999_999)],
      [
        createMatchStatisticsTeam(MATCH_STATISTICS_HOME_PROVIDER_CLUB_ID),
        createMatchStatisticsTeam(MATCH_STATISTICS_HOME_PROVIDER_CLUB_ID),
      ],
    ];
    const expectedCodes = [
      "api_football_match_statistics_team_mismatch",
      "api_football_duplicate_match_statistics_team",
    ];

    for (const [index, response] of responses.entries()) {
      const db = database();
      const result = await syncMatchStatistics({
        client: providerClient(success(response)),
        pool: db.pool,
        matchId: MATCH_STATISTICS_MATCH_ID,
      });

      expect(result).toMatchObject({
        status: "failed",
        errorCode: expectedCodes[index],
      });
      expect(db.pool.connect).not.toHaveBeenCalled();
    }
  });

  it("fails before provider access for an unknown or out-of-scope Match", async () => {
    const db = database({ targetExists: false });
    const client = providerClient(success(createMatchStatisticsResponse()));
    const result = await syncMatchStatistics({
      client,
      pool: db.pool,
      matchId: MATCH_STATISTICS_MATCH_ID,
    });

    expect(result).toEqual({
      status: "failed",
      errorCode: "football_match_not_found",
      message: "The requested current Serie A Match was not found.",
    });
    expect(client.getRequestAttemptCount()).toBe(0);
    expect(db.pool.connect).not.toHaveBeenCalled();
  });

  it("rolls back a later item failure without heartbeat inside the transaction", async () => {
    const trace: string[] = [];
    const db = database({ failItemInsertAt: 2, trace });
    const heartbeat = vi.fn(async () => {
      trace.push("heartbeat");
    });

    await expect(syncMatchStatistics({
      client: providerClient(success(createMatchStatisticsResponse()), trace),
      pool: db.pool,
      matchId: MATCH_STATISTICS_MATCH_ID,
      heartbeat,
    })).rejects.toThrow("forced Match Statistic item insert failure");
    expect(trace.slice(0, 10)).toEqual([
      "target",
      "fetch",
      "heartbeat",
      "connect",
      "begin",
      "delete:club-home",
      "snapshot:club-home",
      "item:1",
      "item:2",
      "rollback",
    ]);
    expect(heartbeat).toHaveBeenCalledOnce();
  });

  it("stops before the transaction when the existing heartbeat loses ownership", async () => {
    const db = database();
    const heartbeat = vi.fn(async () => {
      throw new Error("job_lease_lost");
    });

    await expect(syncMatchStatistics({
      client: providerClient(success(createMatchStatisticsResponse())),
      pool: db.pool,
      matchId: MATCH_STATISTICS_MATCH_ID,
      heartbeat,
    })).rejects.toThrow("job_lease_lost");
    expect(db.pool.connect).not.toHaveBeenCalled();
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
    const result = await syncMatchStatistics({
      client: providerClient(response),
      pool: db.pool,
      matchId: MATCH_STATISTICS_MATCH_ID,
    });

    expect(result).toEqual({
      status: "retry",
      errorCode: "api_football_http_server_error",
      message: "API-Football fixtures/statistics request failed: Provider unavailable",
      retryDelaySeconds: 30,
    });
    expect(db.pool.connect).not.toHaveBeenCalled();
  });
});
