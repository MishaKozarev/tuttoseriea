import type { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";

import type {
  ApiFootballClient,
  ApiFootballRequestParameters,
  ApiFootballResult,
} from "@/src/football/api-football/node";
import { syncMatchLineups } from "@/src/football/match-lineups-sync";
import {
  MATCH_LINEUPS_AWAY_PROVIDER_CLUB_ID,
  MATCH_LINEUPS_HOME_PROVIDER_CLUB_ID,
  MATCH_LINEUPS_MATCH_ID,
  MATCH_LINEUPS_PROVIDER_FIXTURE_ID,
  createMatchLineup,
  createMatchLineupPlayer,
  createMatchLineupsResponse,
} from "@/tests/fixtures/match-lineups";

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
    operation: "fixtures/lineups",
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
      expect(pathname).toBe("/fixtures/lineups");
      expect(parameters).toEqual({ fixture: MATCH_LINEUPS_PROVIDER_FIXTURE_ID });
      return response as ApiFootballResult<TResponse>;
    },
  };
}

function database(options: {
  failEntryInsertAt?: number;
  persistedLineupClubIds?: string[];
  playerIds?: ReadonlyMap<number, string>;
  status?: FixtureState;
  targetExists?: boolean;
  trace?: string[];
} = {}) {
  const trace = options.trace ?? [];
  const lineupInserts: unknown[][] = [];
  const entryInserts: unknown[][] = [];
  const deletedClubs: string[] = [];
  let entryInsertCount = 0;
  const transactionQuery = vi.fn(async (sql: string, values?: readonly unknown[]) => {
    const normalized = sql.trim().toLowerCase();

    if (["begin", "commit", "rollback"].includes(normalized)) {
      trace.push(normalized);
      return { rows: [] };
    }

    if (sql.includes("delete from football.match_lineups")) {
      deletedClubs.push(String(values?.[1]));
      trace.push(`delete:${values?.[1]}`);
      return { rows: [] };
    }

    if (sql.includes("insert into football.match_lineups")) {
      lineupInserts.push([...(values ?? [])]);
      trace.push(`lineup:${values?.[2]}`);
      return { rows: [] };
    }

    if (sql.includes("insert into football.match_lineup_entries")) {
      entryInsertCount += 1;
      trace.push(`entry:${entryInsertCount}`);

      if (options.failEntryInsertAt === entryInsertCount) {
        throw new Error("forced Match Lineup entry insert failure");
      }

      entryInserts.push([...(values ?? [])]);
      return { rows: [] };
    }

    throw new Error(`Unexpected transaction query: ${sql}`);
  });
  const release = vi.fn();
  const query = vi.fn(async (sql: string, values?: readonly unknown[]) => {
    if (sql.includes("from football.competitions comp")) {
      trace.push("target");
      expect(values?.[0]).toBe(MATCH_LINEUPS_MATCH_ID);
      return {
        rows:
          options.targetExists === false
            ? []
            : [
                {
                  id: MATCH_LINEUPS_MATCH_ID,
                  provider_fixture_id: MATCH_LINEUPS_PROVIDER_FIXTURE_ID,
                  status: options.status ?? "finished",
                  home_club_id: "club-home",
                  home_provider_club_id: MATCH_LINEUPS_HOME_PROVIDER_CLUB_ID,
                  away_club_id: "club-away",
                  away_provider_club_id: MATCH_LINEUPS_AWAY_PROVIDER_CLUB_ID,
                  persisted_lineup_club_ids:
                    options.persistedLineupClubIds ?? [],
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
    lineupInserts,
    entryInserts,
    deletedClubs,
    trace,
  };
}

describe("Match Lineups synchronization", () => {
  it("validates, resolves and atomically replaces both team snapshots", async () => {
    const trace: string[] = [];
    const homePlayerId = MATCH_LINEUPS_HOME_PROVIDER_CLUB_ID * 1_000 + 1;
    const db = database({
      trace,
      playerIds: new Map([[homePlayerId, "player-home-1"]]),
    });
    const heartbeat = vi.fn(async () => {
      trace.push("heartbeat");
    });
    const rawLineups = createMatchLineupsResponse();

    await expect(
      syncMatchLineups({
        client: providerClient(success(rawLineups), trace),
        pool: db.pool,
        matchId: MATCH_LINEUPS_MATCH_ID,
        heartbeat,
      }),
    ).resolves.toMatchObject({
      status: "success",
      receivedTeamCount: 2,
      starterCount: 22,
      substituteCount: 4,
      entryCount: 26,
      resolvedPlayerCount: 1,
      unresolvedPlayerCount: 25,
      anomalies: [],
    });

    expect(trace.slice(0, 8)).toEqual([
      "target",
      "fetch",
      "resolve_players",
      "heartbeat",
      "connect",
      "begin",
      "delete:club-home",
      "lineup:club-home",
    ]);
    expect(trace.at(-1)).toBe("commit");
    expect(heartbeat).toHaveBeenCalledOnce();
    expect(db.deletedClubs).toEqual(["club-home", "club-away"]);
    expect(db.lineupInserts).toHaveLength(2);
    expect(db.entryInserts).toHaveLength(26);
    expect(db.entryInserts[0]?.slice(2, 10)).toEqual([
      "starter",
      homePlayerId,
      `Player ${homePlayerId}`,
      "player-home-1",
      1,
      "M",
      "1:1",
      0,
    ]);
    expect(JSON.parse(String(db.lineupInserts[0]?.[8]))).toEqual(rawLineups[0]);
    expect(JSON.parse(String(db.entryInserts[0]?.[10]))).toEqual(
      rawLineups[0]?.startXI[0],
    );

    const firstSubstitute = db.entryInserts[11];
    expect(firstSubstitute?.[2]).toBe("substitute");
    expect(firstSubstitute?.[9]).toBe(0);
  });

  it("replaces only a received side and reports the retained absent side", async () => {
    const db = database();

    await expect(
      syncMatchLineups({
        client: providerClient(
          success([createMatchLineup(MATCH_LINEUPS_HOME_PROVIDER_CLUB_ID)]),
        ),
        pool: db.pool,
        matchId: MATCH_LINEUPS_MATCH_ID,
      }),
    ).resolves.toMatchObject({
      status: "success",
      receivedTeamCount: 1,
      anomalies: [
        {
          code: "api_football_partial_match_lineups",
          missingSide: "away",
          missingProviderTeamId: MATCH_LINEUPS_AWAY_PROVIDER_CLUB_ID,
        },
      ],
    });
    expect(db.deletedClubs).toEqual(["club-home"]);
  });

  it("accepts an empty scheduled response without prior Lineups as a no-op", async () => {
    const db = database({ status: "scheduled" });
    const heartbeat = vi.fn(async () => undefined);

    await expect(
      syncMatchLineups({
        client: providerClient(success([])),
        pool: db.pool,
        matchId: MATCH_LINEUPS_MATCH_ID,
        heartbeat,
      }),
    ).resolves.toMatchObject({
      status: "success",
      receivedTeamCount: 0,
      entryCount: 0,
      anomalies: [],
    });
    expect(heartbeat).toHaveBeenCalledOnce();
    expect(db.pool.connect).not.toHaveBeenCalled();
    expect(db.query.mock.calls.some(([sql]) => sql.includes("from football.players"))).toBe(false);
  });

  it("reports an empty response when a prior team snapshot exists", async () => {
    const db = database({
      status: "scheduled",
      persistedLineupClubIds: ["club-home"],
    });

    await expect(
      syncMatchLineups({
        client: providerClient(success([])),
        pool: db.pool,
        matchId: MATCH_LINEUPS_MATCH_ID,
      }),
    ).resolves.toMatchObject({
      status: "success",
      anomalies: [
        {
          code: "api_football_empty_match_lineups",
          persistedSides: ["home"],
        },
      ],
    });
    expect(db.pool.connect).not.toHaveBeenCalled();
  });

  it.each(["live", "paused", "suspended", "interrupted", "abandoned", "finished", "awarded"] as const)(
    "reports a suspicious empty %s response through the normalized status model",
    async (status) => {
      const db = database({ status });

      await expect(
        syncMatchLineups({
          client: providerClient(success([])),
          pool: db.pool,
          matchId: MATCH_LINEUPS_MATCH_ID,
        }),
      ).resolves.toMatchObject({
        status: "success",
        anomalies: [{ code: "api_football_empty_match_lineups", matchStatus: status }],
      });
    },
  );

  it.each(["postponed", "cancelled", "walkover"] as const)(
    "keeps an empty %s response without prior Lineups silent",
    async (status) => {
      const db = database({ status });

      await expect(
        syncMatchLineups({
          client: providerClient(success([])),
          pool: db.pool,
          matchId: MATCH_LINEUPS_MATCH_ID,
        }),
      ).resolves.toMatchObject({ status: "success", anomalies: [] });
    },
  );

  it("fails before provider access for an unknown or out-of-scope Match", async () => {
    const db = database({ targetExists: false });
    const client = providerClient(success(createMatchLineupsResponse()));

    await expect(
      syncMatchLineups({ client, pool: db.pool, matchId: MATCH_LINEUPS_MATCH_ID }),
    ).resolves.toMatchObject({
      status: "failed",
      errorCode: "football_match_not_found",
    });
    expect(client.getRequestAttemptCount()).toBe(0);
    expect(db.pool.connect).not.toHaveBeenCalled();
  });

  it.each([null, {}])("rejects a successful non-array response: %j", async (data) => {
    const db = database();

    await expect(
      syncMatchLineups({
        client: providerClient(success(data)),
        pool: db.pool,
        matchId: MATCH_LINEUPS_MATCH_ID,
      }),
    ).resolves.toMatchObject({ errorCode: "api_football_invalid_match_lineups" });
    expect(db.pool.connect).not.toHaveBeenCalled();
  });

  it("rejects inconsistent counts and malformed paging but does not require 1/1 paging", async () => {
    const lineups = createMatchLineupsResponse();
    const inconsistent = database();

    await expect(
      syncMatchLineups({
        client: providerClient(success(lineups, { results: 1 })),
        pool: inconsistent.pool,
        matchId: MATCH_LINEUPS_MATCH_ID,
      }),
    ).resolves.toMatchObject({ errorCode: "api_football_invalid_match_lineups" });

    const malformedPaging = database();
    await expect(
      syncMatchLineups({
        client: providerClient(success(lineups, { paging: { current: -1, total: 1 } })),
        pool: malformedPaging.pool,
        matchId: MATCH_LINEUPS_MATCH_ID,
      }),
    ).resolves.toMatchObject({ errorCode: "api_football_invalid_match_lineups" });

    const changedPaging = database();
    await expect(
      syncMatchLineups({
        client: providerClient(success(lineups, { paging: { current: 2, total: 3 } })),
        pool: changedPaging.pool,
        matchId: MATCH_LINEUPS_MATCH_ID,
      }),
    ).resolves.toMatchObject({ status: "success" });
  });

  it("rejects foreign and duplicate teams before resolution or mutation", async () => {
    const foreign = createMatchLineup(999);
    const foreignDb = database();

    await expect(
      syncMatchLineups({
        client: providerClient(success([foreign])),
        pool: foreignDb.pool,
        matchId: MATCH_LINEUPS_MATCH_ID,
      }),
    ).resolves.toMatchObject({
      errorCode: "api_football_match_lineup_team_mismatch",
    });

    const duplicate = createMatchLineup(MATCH_LINEUPS_HOME_PROVIDER_CLUB_ID);
    const duplicateDb = database();
    await expect(
      syncMatchLineups({
        client: providerClient(success([duplicate, structuredClone(duplicate)])),
        pool: duplicateDb.pool,
        matchId: MATCH_LINEUPS_MATCH_ID,
      }),
    ).resolves.toMatchObject({
      errorCode: "api_football_duplicate_match_lineup_team",
    });
    expect(duplicateDb.query.mock.calls.some(([sql]) => sql.includes("from football.players"))).toBe(false);
  });

  it("rejects one positive Player identity repeated within a team or across both teams", async () => {
    const within = createMatchLineup(MATCH_LINEUPS_HOME_PROVIDER_CLUB_ID);
    within.substitutes[0] = structuredClone(within.startXI[0]!);
    const withinDb = database();

    await expect(
      syncMatchLineups({
        client: providerClient(success([within])),
        pool: withinDb.pool,
        matchId: MATCH_LINEUPS_MATCH_ID,
      }),
    ).resolves.toMatchObject({
      errorCode: "api_football_duplicate_match_lineup_player",
    });

    const both = createMatchLineupsResponse();
    both[1]!.startXI[0] = structuredClone(both[0]!.startXI[0]!);
    const bothDb = database();
    await expect(
      syncMatchLineups({
        client: providerClient(success(both)),
        pool: bothDb.pool,
        matchId: MATCH_LINEUPS_MATCH_ID,
      }),
    ).resolves.toMatchObject({
      errorCode: "api_football_match_lineup_player_team_conflict",
    });
    expect(bothDb.pool.connect).not.toHaveBeenCalled();
  });

  it("keeps unknown Players nullable and resolves them on a later snapshot without creation", async () => {
    const lineup = createMatchLineup(MATCH_LINEUPS_HOME_PROVIDER_CLUB_ID, {
      starterCount: 1,
      substituteCount: 0,
    });
    const providerPlayerId = lineup.startXI[0]!.player.id!;
    const first = database();

    await syncMatchLineups({
      client: providerClient(success([lineup])),
      pool: first.pool,
      matchId: MATCH_LINEUPS_MATCH_ID,
    });
    expect(first.entryInserts[0]?.[5]).toBeNull();

    const second = database({
      playerIds: new Map([[providerPlayerId, "late-player"]]),
    });
    await syncMatchLineups({
      client: providerClient(success([lineup])),
      pool: second.pool,
      matchId: MATCH_LINEUPS_MATCH_ID,
    });
    expect(second.entryInserts[0]?.[5]).toBe("late-player");
    expect(second.query.mock.calls.some(([sql]) => sql.includes("insert into football.players"))).toBe(false);
  });

  it("accepts nullable optional fields and requires a usable Player identity", async () => {
    const lineup = createMatchLineup(MATCH_LINEUPS_HOME_PROVIDER_CLUB_ID, {
      coachId: null,
      formation: null,
      starterCount: 1,
      substituteCount: 0,
    });
    lineup.team.colors = null as unknown as typeof lineup.team.colors;
    lineup.coach.name = null as unknown as string;
    lineup.coach.photo = null as unknown as string;
    lineup.startXI[0] = createMatchLineupPlayer(null, {
      grid: null,
      name: "Provider Named Player",
      number: null,
      pos: null,
    });
    const db = database();

    await expect(
      syncMatchLineups({
        client: providerClient(success([lineup])),
        pool: db.pool,
        matchId: MATCH_LINEUPS_MATCH_ID,
      }),
    ).resolves.toMatchObject({ status: "success" });
    expect(db.entryInserts[0]?.slice(3, 10)).toEqual([
      null,
      "Provider Named Player",
      null,
      null,
      null,
      null,
      0,
    ]);

    const invalid = structuredClone(lineup);
    invalid.startXI[0] = createMatchLineupPlayer(null, { name: null });
    const invalidDb = database();
    await expect(
      syncMatchLineups({
        client: providerClient(success([invalid])),
        pool: invalidDb.pool,
        matchId: MATCH_LINEUPS_MATCH_ID,
      }),
    ).resolves.toMatchObject({ errorCode: "api_football_invalid_match_lineups" });
  });

  it("rejects missing arrays and invalid optional scalar runtime types", async () => {
    const missingArrays = createMatchLineup(MATCH_LINEUPS_HOME_PROVIDER_CLUB_ID) as Record<string, unknown>;
    delete missingArrays.startXI;
    const missingDb = database();

    await expect(
      syncMatchLineups({
        client: providerClient(success([missingArrays])),
        pool: missingDb.pool,
        matchId: MATCH_LINEUPS_MATCH_ID,
      }),
    ).resolves.toMatchObject({ errorCode: "api_football_invalid_match_lineups" });

    const invalidScalar = createMatchLineup(MATCH_LINEUPS_HOME_PROVIDER_CLUB_ID) as unknown as {
      formation: unknown;
    };
    invalidScalar.formation = 433;
    const invalidDb = database();
    await expect(
      syncMatchLineups({
        client: providerClient(success([invalidScalar])),
        pool: invalidDb.pool,
        matchId: MATCH_LINEUPS_MATCH_ID,
      }),
    ).resolves.toMatchObject({ errorCode: "api_football_invalid_match_lineups" });
  });

  it("accepts a non-11 starter snapshot with one structured anomaly", async () => {
    const db = database();

    await expect(
      syncMatchLineups({
        client: providerClient(
          success([
            createMatchLineup(MATCH_LINEUPS_HOME_PROVIDER_CLUB_ID, {
              starterCount: 10,
            }),
            createMatchLineup(MATCH_LINEUPS_AWAY_PROVIDER_CLUB_ID),
          ]),
        ),
        pool: db.pool,
        matchId: MATCH_LINEUPS_MATCH_ID,
      }),
    ).resolves.toMatchObject({
      status: "success",
      anomalies: [
        {
          code: "api_football_unexpected_match_lineup_starter_count",
          teams: [
            {
              providerTeamId: MATCH_LINEUPS_HOME_PROVIDER_CLUB_ID,
              starterCount: 10,
            },
          ],
        },
      ],
    });
  });

  it("rolls back a later entry failure without a heartbeat inside the transaction", async () => {
    const trace: string[] = [];
    const db = database({ failEntryInsertAt: 2, trace });
    const heartbeat = vi.fn(async () => {
      trace.push("heartbeat");
    });

    await expect(
      syncMatchLineups({
        client: providerClient(success(createMatchLineupsResponse()), trace),
        pool: db.pool,
        matchId: MATCH_LINEUPS_MATCH_ID,
        heartbeat,
      }),
    ).rejects.toThrow("forced Match Lineup entry insert failure");
    expect(trace.slice(0, 10)).toEqual([
      "target",
      "fetch",
      "resolve_players",
      "heartbeat",
      "connect",
      "begin",
      "delete:club-home",
      "lineup:club-home",
      "entry:1",
      "entry:2",
    ]);
    expect(trace.at(-1)).toBe("rollback");
    expect(heartbeat).toHaveBeenCalledOnce();
  });

  it("stops before the transaction when the existing heartbeat loses ownership", async () => {
    const db = database();
    const heartbeat = vi.fn(async () => {
      throw new Error("job_lease_lost");
    });

    await expect(
      syncMatchLineups({
        client: providerClient(success(createMatchLineupsResponse())),
        pool: db.pool,
        matchId: MATCH_LINEUPS_MATCH_ID,
        heartbeat,
      }),
    ).rejects.toThrow("job_lease_lost");
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

    await expect(
      syncMatchLineups({
        client: providerClient(response),
        pool: db.pool,
        matchId: MATCH_LINEUPS_MATCH_ID,
      }),
    ).resolves.toEqual({
      status: "retry",
      errorCode: "api_football_http_server_error",
      message: "API-Football fixtures/lineups request failed: Provider unavailable",
      retryDelaySeconds: 30,
    });
    expect(db.pool.connect).not.toHaveBeenCalled();
  });
});
