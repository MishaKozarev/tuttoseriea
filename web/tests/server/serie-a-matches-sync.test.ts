import type { Pool, PoolClient } from "pg";
import { describe, expect, it, vi } from "vitest";

import type {
  ApiFootballClient,
  ApiFootballResult,
} from "@/src/football/api-football/node";
import { syncSerieAMatches } from "@/src/football/serie-a-matches-sync";

function createFixtures() {
  return Array.from({ length: 380 }, (_, index) => ({
    fixture: {
      id: 100_000 + index,
      referee: null,
      timezone: "Europe/Rome",
      date: "2026-08-22T18:45:00+00:00",
      timestamp: 1_777_053_900,
      periods: { first: null, second: null },
      venue: { id: null, name: null, city: null },
      status: {
        long: "Not Started",
        short: "NS",
        elapsed: null,
        extra: null,
      },
    },
    league: {
      id: 135,
      season: 2026,
      round: `Regular Season - ${Math.floor(index / 10) + 1}`,
    },
    teams: {
      home: { id: 900_000 + (index % 20), winner: null },
      away: { id: 900_000 + ((index + 1) % 20), winner: null },
    },
    goals: { home: null, away: null },
    score: {
      halftime: { home: null, away: null },
      fulltime: { home: null, away: null },
      extratime: { home: null, away: null },
      penalty: { home: null, away: null },
    },
    fixtureSnapshotMarker: `fixture-${index}`,
  }));
}

function successfulClient(response: unknown): ApiFootballClient {
  return {
    getRequestAttemptCount: () => 1,
    async get<TResponse>(): Promise<ApiFootballResult<TResponse>> {
      return {
        ok: true,
        data: response as TResponse,
        results: Array.isArray(response) ? response.length : 0,
        paging: { current: 1, total: 1 },
        operation: "fixtures",
        attempts: 1,
      };
    },
  };
}

function successfulTransactionClient() {
  const seasonClubRows = Array.from({ length: 20 }, (_, index) => ({
    season_id: "season-2026",
    provider_club_id: 900_000 + index,
    club_id: `club-${index}`,
  }));
  const query = vi.fn(async (queryText: string) => {
    if (queryText.includes("from football.competitions comp")) {
      return { rows: seasonClubRows };
    }

    if (queryText.includes("insert into football.matches")) {
      return { rows: [{ id: "match-id" }] };
    }

    throw new Error("unexpected database query in valid-array test");
  });

  return {
    query,
    transactionClient: { query } as unknown as PoolClient,
  };
}

function databaseProbe() {
  const connect = vi.fn(() => {
    throw new Error("database probe reached");
  });

  return {
    connect,
    pool: { connect } as unknown as Pool,
  };
}

describe("Serie A matches synchronization validation", () => {
  it("accepts a valid fixtures array and completes synchronization", async () => {
    const database = successfulTransactionClient();

    await expect(
      syncSerieAMatches({
        client: successfulClient(createFixtures()),
        transactionClient: database.transactionClient,
      }),
    ).resolves.toEqual({ status: "success", matchCount: 380 });
    expect(database.query).toHaveBeenCalledTimes(381);
  });

  it.each([null, {}])(
    "fails cleanly when a successful provider response is not an array: %j",
    async (response) => {
      const database = databaseProbe();

      await expect(
        syncSerieAMatches({ client: successfulClient(response), pool: database.pool }),
      ).resolves.toEqual({
        status: "failed",
        errorCode: "api_football_malformed_fixture_data",
        message: "API-Football returned a fixtures response that is not an array.",
      });
      expect(database.connect).not.toHaveBeenCalled();
    },
  );

  it("fails before persistence when the provider fixture count is incomplete", async () => {
    const fixtures = createFixtures().slice(0, 379);
    const database = databaseProbe();

    await expect(
      syncSerieAMatches({ client: successfulClient(fixtures), pool: database.pool }),
    ).resolves.toMatchObject({
      status: "failed",
      errorCode: "api_football_unexpected_fixture_count",
    });
    expect(database.connect).not.toHaveBeenCalled();
  });

  it("rejects a missing provider fixture identity", async () => {
    const fixtures = createFixtures();
    fixtures[0]!.fixture.id = undefined as unknown as number;
    const database = databaseProbe();

    await expect(
      syncSerieAMatches({ client: successfulClient(fixtures), pool: database.pool }),
    ).resolves.toMatchObject({
      status: "failed",
      errorCode: "api_football_malformed_fixture_data",
    });
    expect(database.connect).not.toHaveBeenCalled();
  });

  it("rejects a fixture whose home and away clubs are equal", async () => {
    const fixtures = createFixtures();
    fixtures[0]!.teams.away.id = fixtures[0]!.teams.home.id;
    const database = databaseProbe();

    await expect(
      syncSerieAMatches({ client: successfulClient(fixtures), pool: database.pool }),
    ).resolves.toMatchObject({
      status: "failed",
      errorCode: "api_football_invalid_fixture_clubs",
    });
    expect(database.connect).not.toHaveBeenCalled();
  });

  it("rejects duplicate provider fixture identities in one response", async () => {
    const fixtures = createFixtures();
    fixtures[1]!.fixture.id = fixtures[0]!.fixture.id;
    const database = databaseProbe();

    await expect(
      syncSerieAMatches({ client: successfulClient(fixtures), pool: database.pool }),
    ).resolves.toMatchObject({
      status: "failed",
      errorCode: "api_football_duplicate_fixture_id",
    });
    expect(database.connect).not.toHaveBeenCalled();
  });

  it("fails closed for an unknown provider status", async () => {
    const fixtures = createFixtures();
    fixtures[0]!.fixture.status.short = "MYSTERY";
    const database = databaseProbe();

    await expect(
      syncSerieAMatches({ client: successfulClient(fixtures), pool: database.pool }),
    ).resolves.toMatchObject({
      status: "failed",
      errorCode: "api_football_unknown_fixture_status",
    });
    expect(database.connect).not.toHaveBeenCalled();
  });

  it("preserves retry semantics for transient provider failures", async () => {
    const database = databaseProbe();
    const client: ApiFootballClient = {
      getRequestAttemptCount: () => 3,
      async get<TResponse>(): Promise<ApiFootballResult<TResponse>> {
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

    await expect(syncSerieAMatches({ client, pool: database.pool })).resolves.toEqual({
      status: "retry",
      errorCode: "api_football_http_server_error",
      message: "API-Football fixtures request failed: Provider unavailable",
      retryDelaySeconds: 30,
    });
    expect(database.connect).not.toHaveBeenCalled();
  });
});
