import type { Pool, PoolClient } from "pg";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  createApiFootballClient,
  type ApiFootballClient,
  type ApiFootballResult,
} from "@/src/football/api-football";
import { syncSerieASquads } from "@/src/football/serie-a-squads-sync";

function createScopeRows(clubCount = 20) {
  return Array.from({ length: clubCount }, (_, index) => ({
    season_id: "season-2026",
    club_id: `club-${index}`,
    provider_club_id: 900_000 + index,
  }));
}

function createPlayer(providerClubId: number, overrides: Record<string, unknown> = {}) {
  return {
    id: 1_000_000 + (providerClubId - 900_000),
    name: `Player ${providerClubId}`,
    age: 24,
    number: 10,
    position: "Provider position",
    photo: `https://media.example.invalid/players/${providerClubId}.png`,
    providerMarker: `raw-${providerClubId}`,
    ...overrides,
  };
}

function createSquadResponse(
  providerClubId: number,
  players: unknown[] = [createPlayer(providerClubId)],
) {
  return [
    {
      team: { id: providerClubId, name: `Club ${providerClubId}` },
      players,
    },
  ];
}

function ok<TResponse>(data: TResponse): ApiFootballResult<TResponse> {
  return {
    ok: true,
    data,
    results: Array.isArray(data) ? data.length : 1,
    paging: { current: 1, total: 1 },
    operation: "players/squads",
    attempts: 1,
  };
}

function createFakeClient(
  responseForClub: (providerClubId: number) => unknown = createSquadResponse,
) {
  let requestCount = 0;
  const get = vi.fn(
    async <TResponse>(
      pathname: string,
      query: Record<string, string | number | boolean | undefined> = {},
    ): Promise<ApiFootballResult<TResponse>> => {
      requestCount += 1;
      expect(pathname).toBe("/players/squads");
      const providerClubId = query.team;
      expect(typeof providerClubId).toBe("number");

      return ok(responseForClub(providerClubId as number)) as ApiFootballResult<TResponse>;
    },
  );

  return {
    client: {
      get,
      getRequestAttemptCount: () => requestCount,
    } as ApiFootballClient,
    get,
  };
}

function transactionClient(clubCount = 20) {
  const query = vi.fn(async (queryText: string, values?: readonly unknown[]) => {
    if (queryText.includes("from football.competitions comp")) {
      return { rows: createScopeRows(clubCount) };
    }

    if (queryText.includes("insert into football.players")) {
      return { rows: [{ id: `player-${String(values?.[2])}` }] };
    }

    if (queryText.includes("insert into football.squad_memberships")) {
      return { rows: [{ id: "membership-id" }] };
    }

    if (queryText.includes("delete from football.squad_memberships")) {
      return { rows: [] };
    }

    throw new Error(`Unexpected squad database query: ${queryText}`);
  });

  return {
    client: { query } as unknown as PoolClient,
    query,
  };
}

function poolWithScope(clubCount: number) {
  const query = vi.fn(async () => ({ rows: createScopeRows(clubCount) }));
  const connect = vi.fn(() => {
    throw new Error("database mutation reached");
  });

  return {
    connect,
    pool: { connect, query } as unknown as Pool,
    query,
  };
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function envelope(response: unknown) {
  return {
    get: "players/squads",
    parameters: {},
    errors: [],
    results: Array.isArray(response) ? response.length : 1,
    paging: { current: 1, total: 1 },
    response,
  };
}

describe("Serie A current squads synchronization", () => {
  it("accepts all 20 squads and preserves nullable numbers, raw data and provider position", async () => {
    const database = transactionClient();
    const fake = createFakeClient((providerClubId) =>
      createSquadResponse(providerClubId, [
        createPlayer(providerClubId, {
          number: null,
          position: "  Provider Owned Position  ",
        }),
      ]),
    );

    await expect(
      syncSerieASquads({ client: fake.client, transactionClient: database.client }),
    ).resolves.toEqual({
      status: "success",
      clubCount: 20,
      playerCount: 20,
      membershipCount: 20,
    });

    expect(fake.get).toHaveBeenCalledTimes(20);
    const membershipCall = database.query.mock.calls.find(([queryText]) =>
      queryText.includes("insert into football.squad_memberships"),
    );
    const values = membershipCall?.[1] as readonly unknown[];

    expect(values[3]).toBeNull();
    expect(values[4]).toBe("  Provider Owned Position  ");
    expect(JSON.parse(String(values[5]))).toMatchObject({
      providerMarker: "raw-900000",
      position: "  Provider Owned Position  ",
    });
  });

  it.each([null, {}])("fails cleanly for malformed response: %j", async (response) => {
    const database = transactionClient();
    const fake = createFakeClient(() => response);

    await expect(
      syncSerieASquads({ client: fake.client, transactionClient: database.client }),
    ).resolves.toMatchObject({
      status: "failed",
      errorCode: "api_football_malformed_squad_response",
    });

    expect(
      database.query.mock.calls.some(([queryText]) =>
        queryText.includes("insert into football.players"),
      ),
    ).toBe(false);
  });

  it("rejects wrong team identity", async () => {
    const database = transactionClient();
    const fake = createFakeClient((providerClubId) =>
      createSquadResponse(providerClubId + 1),
    );

    await expect(
      syncSerieASquads({ client: fake.client, transactionClient: database.client }),
    ).resolves.toMatchObject({ errorCode: "api_football_squad_team_mismatch" });
  });

  it.each([
    { players: undefined, errorCode: "api_football_malformed_squad_response" },
    { players: [], errorCode: "api_football_empty_squad" },
  ])("rejects missing or empty players: $errorCode", async ({ players, errorCode }) => {
    const database = transactionClient();
    const fake = createFakeClient((providerClubId) => [
      { team: { id: providerClubId }, ...(players === undefined ? {} : { players }) },
    ]);

    await expect(
      syncSerieASquads({ client: fake.client, transactionClient: database.client }),
    ).resolves.toMatchObject({ status: "failed", errorCode });
  });

  it("deduplicates structurally identical complete player objects inside one club", async () => {
    const database = transactionClient();
    const fake = createFakeClient((providerClubId) => {
      const player = createPlayer(providerClubId);
      return createSquadResponse(
        providerClubId,
        providerClubId === 900_000 ? [player, { ...player }] : [player],
      );
    });

    await expect(
      syncSerieASquads({ client: fake.client, transactionClient: database.client }),
    ).resolves.toEqual({
      status: "success",
      clubCount: 20,
      playerCount: 20,
      membershipCount: 20,
    });

    const firstClubMemberships = database.query.mock.calls.filter(
      ([queryText, values]) =>
        queryText.includes("insert into football.squad_memberships") &&
        (values as readonly unknown[] | undefined)?.[1] === "club-0",
    );
    expect(firstClubMemberships).toHaveLength(1);
  });

  it("rejects conflicting complete player objects and logs only safe diagnostic context", async () => {
    const database = transactionClient();
    const firstPlayer = createPlayer(900_000, { futureProviderField: "first" });
    const conflictingPlayer = createPlayer(900_000, {
      futureProviderField: "conflicting",
    });
    const fake = createFakeClient((providerClubId) =>
      createSquadResponse(providerClubId, [firstPlayer, conflictingPlayer]),
    );
    Object.assign(fake.client, {
      apiKey: "test-api-key-must-not-be-logged",
      requestHeaders: { "x-apisports-key": "test-api-key-must-not-be-logged" },
    });
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);

    try {
      await expect(
        syncSerieASquads({ client: fake.client, transactionClient: database.client }),
      ).resolves.toEqual({
        status: "failed",
        errorCode: "api_football_duplicate_squad_player",
        message:
          "API-Football returned conflicting duplicate player data inside one current squad.",
      });

      expect(errorLog).toHaveBeenCalledOnce();
      expect(errorLog).toHaveBeenCalledWith("api_football_duplicate_squad_player", {
        team_id: 900_000,
        player_id: 1_000_000,
        first_player: firstPlayer,
        conflicting_player: conflictingPlayer,
      });
      expect(JSON.stringify(errorLog.mock.calls)).not.toContain(
        "test-api-key-must-not-be-logged",
      );
      expect(JSON.stringify(errorLog.mock.calls)).not.toContain("x-apisports-key");
    } finally {
      errorLog.mockRestore();
    }

    expect(
      database.query.mock.calls.some(([queryText]) =>
        queryText.includes("insert into football.players"),
      ),
    ).toBe(false);
    expect(
      database.query.mock.calls.some(([queryText]) =>
        queryText.includes("insert into football.squad_memberships"),
      ),
    ).toBe(false);
  });

  it("rejects malformed membership fields without normalizing them", async () => {
    const database = transactionClient();
    const fake = createFakeClient((providerClubId) =>
      createSquadResponse(providerClubId, [
        createPlayer(providerClubId, { position: { name: "Defender" } }),
      ]),
    );

    await expect(
      syncSerieASquads({ client: fake.client, transactionClient: database.client }),
    ).resolves.toMatchObject({ errorCode: "api_football_malformed_squad_player" });
  });

  it.each([19, 21])(
    "fails for %i season clubs before provider requests or mutations",
    async (clubCount) => {
      const database = poolWithScope(clubCount);
      const fake = createFakeClient();

      await expect(
        syncSerieASquads({ client: fake.client, pool: database.pool }),
      ).resolves.toMatchObject({
        status: "failed",
        errorCode: "football_season_membership_incomplete",
      });

      expect(fake.get).not.toHaveBeenCalled();
      expect(database.connect).not.toHaveBeenCalled();
    },
  );

  it("allows one stable player entity to have memberships in two clubs", async () => {
    const database = transactionClient();
    const sharedPlayer = createPlayer(900_000, { id: 1_234_567 });
    const fake = createFakeClient((providerClubId) =>
      createSquadResponse(providerClubId, [sharedPlayer]),
    );

    await expect(
      syncSerieASquads({ client: fake.client, transactionClient: database.client }),
    ).resolves.toMatchObject({
      status: "success",
      playerCount: 1,
      membershipCount: 20,
    });
  });

  it("preserves retry semantics for transient provider failures", async () => {
    const database = poolWithScope(20);
    let requests = 0;
    const client: ApiFootballClient = {
      getRequestAttemptCount: () => requests,
      async get<TResponse>(): Promise<ApiFootballResult<TResponse>> {
        requests += 1;
        return {
          ok: false,
          error: {
            code: "http_server_error",
            message: "Provider unavailable",
            retryable: true,
            retryAfterSeconds: 30,
            attempts: 3,
          },
        };
      },
    };

    await expect(syncSerieASquads({ client, pool: database.pool })).resolves.toEqual({
      status: "retry",
      errorCode: "api_football_http_server_error",
      message: "API-Football players/squads request failed for team 900000: Provider unavailable",
      retryDelaySeconds: 30,
    });
    expect(database.connect).not.toHaveBeenCalled();
  });

  it.each([
    { retriedTeam: null, expectedAttempts: 20 },
    { retriedTeam: 900_019, expectedAttempts: 22 },
  ])(
    "counts $expectedAttempts actual outbound attempts for a complete fake transport run",
    async ({ retriedTeam, expectedAttempts }) => {
      const attemptsByTeam = new Map<number, number>();
      const client = createApiFootballClient({
        config: {
          apiKey: "local-test-key",
          baseUrl: new URL("https://v3.football.api-sports.io/"),
          timeoutMs: 100,
        },
        fetch: async (input) => {
          const teamId = Number(new URL(String(input)).searchParams.get("team"));
          const attempt = (attemptsByTeam.get(teamId) ?? 0) + 1;
          attemptsByTeam.set(teamId, attempt);

          if (teamId === retriedTeam && attempt < 3) {
            return jsonResponse(503, { error: "temporary" });
          }

          return jsonResponse(200, envelope(createSquadResponse(teamId)));
        },
        jitter: () => 0,
        sleep: async () => undefined,
      });
      const database = transactionClient();

      await expect(
        syncSerieASquads({ client, transactionClient: database.client }),
      ).resolves.toMatchObject({ status: "success", clubCount: 20 });
      expect(client.getRequestAttemptCount()).toBe(expectedAttempts);
    },
  );
});
