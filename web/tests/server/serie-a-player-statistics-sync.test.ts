import type { Pool, PoolClient } from "pg";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  createApiFootballClient,
  type ApiFootballClient,
  type ApiFootballResult,
} from "@/src/football/api-football";
import { syncSerieAPlayerStatistics } from "@/src/football/serie-a-player-statistics-sync";

function contextRows() {
  return Array.from({ length: 20 }, (_, index) => ({
    season_id: "season-2026",
    club_id: `club-${index}`,
    provider_club_id: 900_000 + index,
  }));
}

function player(providerPlayerId: number, overrides: Record<string, unknown> = {}) {
  return {
    id: providerPlayerId,
    name: `Player ${providerPlayerId}`,
    firstname: "First",
    lastname: "Last",
    age: 24,
    birth: {
      date: "2002-02-20",
      place: "Rome",
      country: "Italy",
    },
    nationality: "Italy",
    height: "182 cm",
    weight: "75 kg",
    injured: false,
    photo: `https://media.example.invalid/players/${providerPlayerId}.png`,
    providerFutureField: { preserved: true },
    ...overrides,
  };
}

function statistics(providerClubId: number, overrides: Record<string, unknown> = {}) {
  return {
    team: { id: providerClubId, name: `Club ${providerClubId}` },
    league: { id: 135, season: 2026, name: "Serie A" },
    games: {
      appearences: 12,
      lineups: 10,
      minutes: 901,
      number: 8,
      position: "Midfielder",
      rating: "7.125000",
      captain: false,
    },
    substitutes: { in: 2, out: 4, bench: 3 },
    shots: { total: 18, on: 7 },
    goals: { total: 3, conceded: 0, assists: 4, saves: 9 },
    passes: { total: 540, key: 21, accuracy: 87 },
    tackles: { total: 26, blocks: 3, interceptions: 12 },
    duels: { total: 84, won: 49 },
    dribbles: { attempts: 19, success: 11, past: 5 },
    fouls: { drawn: 14, committed: 10 },
    cards: { yellow: 2, yellowred: 0, red: 0 },
    penalty: { won: 1, commited: 0, scored: 1, missed: 0, saved: 0 },
    providerFutureStatistic: { preserved: true },
    ...overrides,
  };
}

function entry(
  providerPlayerId: number,
  providerClubId: number,
  options: {
    playerOverrides?: Record<string, unknown>;
    statisticsOverrides?: Record<string, unknown>;
    statisticsRows?: unknown[];
  } = {},
) {
  return {
    player: player(providerPlayerId, options.playerOverrides),
    statistics:
      options.statisticsRows ??
      [statistics(providerClubId, options.statisticsOverrides)],
  };
}

function ok<TResponse>(
  data: TResponse,
  current: number,
  total: number,
): ApiFootballResult<TResponse> {
  return {
    ok: true,
    data,
    results: Array.isArray(data) ? data.length : 1,
    paging: { current, total },
    operation: "players",
    attempts: 1,
  };
}

function fakeClient(
  pageResponse: (page: number) => ApiFootballResult<unknown>,
): ApiFootballClient {
  let attempts = 0;

  return {
    getRequestAttemptCount: () => attempts,
    async get<TResponse>(
      pathname: string,
      parameters: Record<string, boolean | number | string | undefined> = {},
    ) {
      attempts += 1;
      expect(pathname).toBe("/players");
      expect(parameters).toMatchObject({ league: 135, season: 2026 });
      const page = parameters?.page;
      expect(typeof page).toBe("number");
      return pageResponse(page as number) as ApiFootballResult<TResponse>;
    },
  };
}

function database() {
  let playerSequence = 0;
  const query = vi.fn(async (queryText: string, _values?: readonly unknown[]) => {
    void _values;

    if (queryText.includes("from football.competitions comp")) {
      return { rows: contextRows() };
    }

    if (queryText.includes("insert into football.players")) {
      playerSequence += 1;
      return { rows: [{ id: `player-${playerSequence}` }] };
    }

    if (queryText.includes("insert into football.player_statistics")) {
      return { rows: [{ id: "statistics-id" }] };
    }

    if (queryText.includes("delete from football.player_statistics")) {
      return { rows: [] };
    }

    throw new Error(`Unexpected player statistics database query: ${queryText}`);
  });

  return { client: { query } as unknown as PoolClient, query };
}

function mutationCalls(query: ReturnType<typeof vi.fn>) {
  return query.mock.calls.filter(([queryText]) =>
    /insert into football\.(players|player_statistics)|delete from football\.player_statistics/u.test(
      queryText,
    ),
  );
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function envelope(response: unknown, current: number, total: number) {
  return {
    get: "players",
    parameters: {},
    errors: [],
    results: Array.isArray(response) ? response.length : 1,
    paging: { current, total },
    response,
  };
}

describe("Serie A player statistics synchronization", () => {
  it("loads every declared page sequentially and persists the complete snapshot", async () => {
    const db = database();
    const client = fakeClient((page) =>
      ok([entry(1_000_000 + page, 900_000 + page - 1)], page, 3),
    );
    const heartbeat = vi.fn(async () => undefined);

    await expect(
      syncSerieAPlayerStatistics({
        client,
        transactionClient: db.client,
        heartbeat,
      }),
    ).resolves.toEqual({
      status: "success",
      pageCount: 3,
      playerCount: 3,
      statisticsCount: 3,
    });

    expect(client.getRequestAttemptCount()).toBe(3);
    expect(heartbeat).toHaveBeenCalled();
    expect(
      db.query.mock.calls.filter(([sql]) =>
        sql.includes("insert into football.player_statistics"),
      ),
    ).toHaveLength(3);
    expect(
      db.query.mock.calls.some(([sql]) =>
        sql.includes("delete from football.player_statistics"),
      ),
    ).toBe(true);
  });

  it.each([
    { label: "wrong current page", pageTwo: ok([entry(2, 900_001)], 1, 2) },
    { label: "changed total", pageTwo: ok([entry(2, 900_001)], 2, 3) },
  ])("fails closed for $label before mutation", async ({ pageTwo }) => {
    const db = database();
    const client = fakeClient((page) =>
      page === 1 ? ok([entry(1, 900_000)], 1, 2) : pageTwo,
    );

    await expect(
      syncSerieAPlayerStatistics({ client, transactionClient: db.client }),
    ).resolves.toMatchObject({
      status: "failed",
      errorCode: "api_football_player_statistics_paging",
    });
    expect(mutationCalls(db.query)).toHaveLength(0);
  });

  it("requires a positive total page count on the first page", async () => {
    const db = database();
    const client = fakeClient(() => ok([entry(1, 900_000)], 1, 0));

    await expect(
      syncSerieAPlayerStatistics({ client, transactionClient: db.client }),
    ).resolves.toMatchObject({
      status: "failed",
      errorCode: "api_football_player_statistics_paging",
    });
    expect(mutationCalls(db.query)).toHaveLength(0);
  });

  it.each([null, {}])(
    "rejects a successful non-array provider response before mutation: %j",
    async (response) => {
      const db = database();
      const client = fakeClient(() => ok(response, 1, 1));

      await expect(
        syncSerieAPlayerStatistics({ client, transactionClient: db.client }),
      ).resolves.toMatchObject({
        status: "failed",
        errorCode: "api_football_invalid_player_statistics",
      });
      expect(mutationCalls(db.query)).toHaveLength(0);
    },
  );

  it("rejects a complete empty snapshot before repository or transaction access", async () => {
    const query = vi.fn(async () => ({ rows: [] }));
    const connect = vi.fn(async () => {
      throw new Error("player statistics transaction must not start");
    });
    const pool = { query, connect } as unknown as Pool;
    const client = fakeClient(() => ok([], 1, 1));

    await expect(
      syncSerieAPlayerStatistics({ client, pool }),
    ).resolves.toMatchObject({
      status: "failed",
      errorCode: "api_football_invalid_player_statistics",
    });
    expect(query).not.toHaveBeenCalled();
    expect(connect).not.toHaveBeenCalled();
  });

  it("rejects an invalid calendar birth date before mutation", async () => {
    const db = database();
    const client = fakeClient(() =>
      ok(
        [
          entry(1, 900_000, {
            playerOverrides: {
              birth: { date: "2026-02-30", place: null, country: null },
            },
          }),
        ],
        1,
        1,
      ),
    );

    await expect(
      syncSerieAPlayerStatistics({ client, transactionClient: db.client }),
    ).resolves.toMatchObject({
      status: "failed",
      errorCode: "api_football_invalid_player_statistics",
    });
    expect(mutationCalls(db.query)).toHaveLength(0);
  });

  it("preserves nulls, maps provider typos and retains complete raw objects", async () => {
    const db = database();
    const playerRaw = player(1, {
      firstname: null,
      lastname: null,
      age: null,
      birth: { date: null, place: null, country: null },
      nationality: null,
      height: null,
      weight: null,
      injured: null,
      photo: null,
    });
    const statisticsRaw = statistics(900_000, {
      games: {
        appearences: 0,
        lineups: null,
        minutes: null,
        number: null,
        position: null,
        rating: null,
        captain: null,
      },
      penalty: { won: 2, commited: 3, scored: 1, missed: 1, saved: 4 },
    });
    const client = fakeClient(() =>
      ok([{ player: playerRaw, statistics: [statisticsRaw] }], 1, 1),
    );

    await expect(
      syncSerieAPlayerStatistics({ client, transactionClient: db.client }),
    ).resolves.toMatchObject({ status: "success" });

    const playerCall = db.query.mock.calls.find(([sql]) =>
      sql.includes("insert into football.players"),
    );
    const playerValues = playerCall?.[1] as readonly unknown[];
    expect(playerValues.slice(4, 15)).toEqual([
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
    ]);

    const statisticsCall = db.query.mock.calls.find(([sql]) =>
      sql.includes("insert into football.player_statistics"),
    );
    const values = statisticsCall?.[1] as readonly unknown[];
    expect(values[4]).toBe(0);
    expect(values[6]).toBeNull();
    expect(values[34]).toBe(3);
    expect(JSON.parse(String(values[37]))).toEqual(playerRaw);
    expect(JSON.parse(String(values[38]))).toEqual(statisticsRaw);
  });

  it("keeps one player identity with two team-specific transfer rows", async () => {
    const db = database();
    const stablePlayer = player(55);
    const client = fakeClient(() =>
      ok(
        [
          {
            player: stablePlayer,
            statistics: [statistics(900_000), statistics(900_001)],
          },
        ],
        1,
        1,
      ),
    );

    await expect(
      syncSerieAPlayerStatistics({ client, transactionClient: db.client }),
    ).resolves.toMatchObject({ playerCount: 1, statisticsCount: 2 });
    expect(
      db.query.mock.calls.filter(([sql]) => sql.includes("insert into football.players")),
    ).toHaveLength(1);
    expect(
      db.query.mock.calls.filter(([sql]) =>
        sql.includes("insert into football.player_statistics"),
      ),
    ).toHaveLength(2);
  });

  it("deduplicates identical complete player/statistics pairs across pages", async () => {
    const db = database();
    const duplicate = entry(1, 900_000);
    const client = fakeClient((page) => ok([duplicate], page, 2));

    await expect(
      syncSerieAPlayerStatistics({ client, transactionClient: db.client }),
    ).resolves.toMatchObject({ playerCount: 1, statisticsCount: 1 });
    expect(
      db.query.mock.calls.filter(([sql]) =>
        sql.includes("insert into football.player_statistics"),
      ),
    ).toHaveLength(1);
  });

  it.each([
    {
      label: "inside one page",
      response: (page: number) =>
        ok([entry(1, 900_000), entry(1, 900_000)], page, 1),
    },
    {
      label: "across three pages",
      response: (page: number) => ok([entry(1, 900_000)], page, 3),
    },
  ])("deduplicates identical complete pairs $label", async ({ response }) => {
    const db = database();
    const client = fakeClient(response);

    await expect(
      syncSerieAPlayerStatistics({ client, transactionClient: db.client }),
    ).resolves.toMatchObject({ playerCount: 1, statisticsCount: 1 });
    expect(
      db.query.mock.calls.filter(([sql]) =>
        sql.includes("insert into football.player_statistics"),
      ),
    ).toHaveLength(1);
  });

  it.each([
    {
      label: "wrong league",
      rawStatistics: statistics(900_000, {
        league: { id: 2, season: 2026 },
      }),
    },
    {
      label: "wrong season",
      rawStatistics: statistics(900_000, {
        league: { id: 135, season: 2025 },
      }),
    },
  ])("rejects $label context before mutation", async ({ rawStatistics }) => {
    const db = database();
    const client = fakeClient(() =>
      ok(
        [{ player: player(1), statistics: [rawStatistics] }],
        1,
        1,
      ),
    );

    await expect(
      syncSerieAPlayerStatistics({ client, transactionClient: db.client }),
    ).resolves.toMatchObject({
      status: "failed",
      errorCode: "api_football_invalid_player_statistics",
    });
    expect(mutationCalls(db.query)).toHaveLength(0);
  });

  it("rejects conflicting duplicate statistics globally and logs safe occurrences/raw pairs", async () => {
    const db = database();
    const client = fakeClient((page) =>
      ok(
        [
          entry(1, 900_000, {
            statisticsOverrides: page === 1 ? {} : { games: {
              ...statistics(900_000).games as Record<string, unknown>,
              minutes: 902,
            } },
          }),
        ],
        page,
        2,
      ),
    );
    Object.assign(client, { apiKey: "must-not-be-logged" });
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);

    try {
      await expect(
        syncSerieAPlayerStatistics({ client, transactionClient: db.client }),
      ).resolves.toMatchObject({
        status: "failed",
        errorCode: "api_football_duplicate_player_statistics",
      });
      expect(errorLog).toHaveBeenCalledOnce();
      const serialized = JSON.stringify(errorLog.mock.calls);
      expect(serialized).toContain("first_occurrence");
      expect(serialized).toContain("conflicting_occurrence");
      expect(serialized).toContain("first_player");
      expect(serialized).toContain("first_statistics");
      expect(serialized).toContain("conflicting_statistics");
      expect(serialized).not.toContain("must-not-be-logged");
    } finally {
      errorLog.mockRestore();
    }

    expect(mutationCalls(db.query)).toHaveLength(0);
  });

  it("rejects conflicting complete player profiles before mutation", async () => {
    const db = database();
    const client = fakeClient(() =>
      ok(
        [
          entry(1, 900_000),
          entry(1, 900_001, { playerOverrides: { height: "183 cm" } }),
        ],
        1,
        1,
      ),
    );
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);

    try {
      await expect(
        syncSerieAPlayerStatistics({ client, transactionClient: db.client }),
      ).resolves.toMatchObject({
        status: "failed",
        errorCode: "api_football_conflicting_player",
      });
    } finally {
      errorLog.mockRestore();
    }
    expect(mutationCalls(db.query)).toHaveLength(0);
  });

  it("rejects statistics for a team outside the persisted season before mutation", async () => {
    const db = database();
    const client = fakeClient(() => ok([entry(1, 999_999)], 1, 1));

    await expect(
      syncSerieAPlayerStatistics({ client, transactionClient: db.client }),
    ).resolves.toMatchObject({
      status: "failed",
      errorCode: "api_football_unknown_statistics_team",
    });
    expect(mutationCalls(db.query)).toHaveLength(0);
  });

  it("keeps provider retry semantics and avoids persistence", async () => {
    const db = database();
    const client = fakeClient(() => ({
      ok: false,
      error: {
        code: "http_server_error",
        message: "Provider unavailable",
        retryable: true,
        attempts: 3,
        retryAfterSeconds: 30,
      },
    }));

    await expect(
      syncSerieAPlayerStatistics({ client, transactionClient: db.client }),
    ).resolves.toEqual({
      status: "retry",
      errorCode: "api_football_http_server_error",
      message: "API-Football players request failed for page 1: Provider unavailable",
      retryDelaySeconds: 30,
    });
    expect(db.query).not.toHaveBeenCalled();
  });

  it("counts outbound fetch attempts across pages and HTTP retries", async () => {
    const attemptsByPage = new Map<number, number>();
    const client = createApiFootballClient({
      config: {
        apiKey: "local-test-key",
        baseUrl: new URL("https://v3.football.api-sports.io/"),
        timeoutMs: 100,
      },
      fetch: async (input) => {
        const page = Number(new URL(String(input)).searchParams.get("page"));
        const attempt = (attemptsByPage.get(page) ?? 0) + 1;
        attemptsByPage.set(page, attempt);

        if (page === 2 && attempt < 3) {
          return jsonResponse(503, { error: "temporary" });
        }

        return jsonResponse(200, envelope([entry(page, 900_000 + page - 1)], page, 3));
      },
      jitter: () => 0,
      sleep: async () => undefined,
    });
    const db = database();

    await expect(
      syncSerieAPlayerStatistics({ client, transactionClient: db.client }),
    ).resolves.toMatchObject({ status: "success", pageCount: 3 });
    expect(client.getRequestAttemptCount()).toBe(5);
  });

  it("uses BEGIN and COMMIT on the production Pool path", async () => {
    const db = database();
    const query = vi.fn(async (sql: string, values?: readonly unknown[]) => {
      if (sql === "begin" || sql === "commit" || sql === "rollback") {
        return { rows: [] };
      }

      return db.query(sql, values);
    });
    const release = vi.fn();
    const pool = {
      query: db.query,
      connect: vi.fn(async () => ({ query, release })),
    } as unknown as Pool;
    const client = fakeClient(() => ok([entry(1, 900_000)], 1, 1));

    await expect(syncSerieAPlayerStatistics({ client, pool })).resolves.toMatchObject({
      status: "success",
    });
    expect(query.mock.calls.map(([sql]) => sql)).toEqual(
      expect.arrayContaining(["begin", "commit"]),
    );
    expect(query).not.toHaveBeenCalledWith("rollback");
    expect(release).toHaveBeenCalledOnce();
  });
});
