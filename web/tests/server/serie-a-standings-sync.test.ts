import type { Pool, PoolClient } from "pg";
import { describe, expect, it, vi } from "vitest";

import type {
  ApiFootballClient,
  ApiFootballResult,
} from "@/src/football/api-football/node";
import { syncSerieAStandings } from "@/src/football/serie-a-standings-sync";

function createStandingRows() {
  return Array.from({ length: 20 }, (_, index) => ({
    rank: index + 1,
    team: {
      id: 900_000 + index,
      name: `Club ${index + 1}`,
      logo: `https://example.test/club-${index + 1}.png`,
    },
    points: 60 - index,
    goalsDiff: 20 - index,
    group: "Serie A",
    form: "WWDLW",
    status: "same",
    description: index === 0 ? "  Champions League  " : null,
    all: {
      played: 20,
      win: 12,
      draw: 4,
      lose: 4,
      goals: { for: 40, against: 20 },
    },
    home: {
      played: 10,
      win: 7,
      draw: 2,
      lose: 1,
      goals: { for: 24, against: 8 },
    },
    away: {
      played: 10,
      win: 5,
      draw: 2,
      lose: 3,
      goals: { for: 16, against: 12 },
    },
    providerSnapshotMarker: `standing-${index}`,
  }));
}

function createResponse(rows: unknown = createStandingRows()): unknown {
  return [
    {
      league: {
        id: 135,
        season: 2026,
        standings: [rows],
      },
    },
  ];
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
        operation: "standings",
        attempts: 1,
      };
    },
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

function transactionClient(clubCount = 20) {
  const seasonClubRows = Array.from({ length: clubCount }, (_, index) => ({
    season_id: "season-2026",
    provider_club_id: 900_000 + index,
    club_id: `club-${index}`,
  }));
  const query = vi.fn(async (queryText: string, values?: readonly unknown[]) => {
    void values;

    if (queryText.includes("from football.competitions comp")) {
      return { rows: seasonClubRows };
    }

    if (queryText.includes("update football.standings")) {
      return { rows: [] };
    }

    if (queryText.includes("insert into football.standings")) {
      return { rows: [{ id: "standing-id" }] };
    }

    throw new Error("unexpected standings database query");
  });

  return {
    query,
    client: { query } as unknown as PoolClient,
  };
}

describe("Serie A standings synchronization", () => {
  it("accepts and preserves a complete 20-row provider table", async () => {
    const database = transactionClient();

    await expect(
      syncSerieAStandings({
        client: successfulClient(createResponse()),
        transactionClient: database.client,
      }),
    ).resolves.toEqual({ status: "success", standingCount: 20 });

    expect(database.query).toHaveBeenCalledTimes(22);
    expect(database.query).toHaveBeenCalledWith(
      expect.stringContaining("update football.standings"),
      ["season-2026"],
    );

    const firstInsert = database.query.mock.calls.find(([queryText]) =>
      queryText.includes("insert into football.standings"),
    );
    const values = firstInsert?.[1] as readonly unknown[];

    expect(values[9]).toBe("  Champions League  ");
    expect(JSON.parse(String(values[28]))).toMatchObject({
      providerSnapshotMarker: "standing-0",
    });
  });

  it.each([null, {}])("fails cleanly for malformed response: %j", async (response) => {
    const database = databaseProbe();

    await expect(
      syncSerieAStandings({ client: successfulClient(response), pool: database.pool }),
    ).resolves.toMatchObject({
      status: "failed",
      errorCode: "api_football_malformed_standings_response",
    });
    expect(database.connect).not.toHaveBeenCalled();
  });

  it("rejects an incomplete 19-row table before persistence", async () => {
    const database = databaseProbe();

    await expect(
      syncSerieAStandings({
        client: successfulClient(createResponse(createStandingRows().slice(0, 19))),
        pool: database.pool,
      }),
    ).resolves.toMatchObject({
      status: "failed",
      errorCode: "api_football_unexpected_standings_count",
    });
    expect(database.connect).not.toHaveBeenCalled();
  });

  it("rejects duplicate clubs and duplicate ranks", async () => {
    const duplicateClub = createStandingRows();
    duplicateClub[1]!.team.id = duplicateClub[0]!.team.id;
    const duplicateRank = createStandingRows();
    duplicateRank[1]!.rank = duplicateRank[0]!.rank;

    await expect(
      syncSerieAStandings({
        client: successfulClient(createResponse(duplicateClub)),
        pool: databaseProbe().pool,
      }),
    ).resolves.toMatchObject({ errorCode: "api_football_duplicate_standings_club" });
    await expect(
      syncSerieAStandings({
        client: successfulClient(createResponse(duplicateRank)),
        pool: databaseProbe().pool,
      }),
    ).resolves.toMatchObject({ errorCode: "api_football_duplicate_standings_rank" });
  });

  it("rejects malformed numeric statistics without coercion", async () => {
    const rows = createStandingRows();
    rows[0]!.all.played = "20" as unknown as number;
    const database = databaseProbe();

    await expect(
      syncSerieAStandings({
        client: successfulClient(createResponse(rows)),
        pool: database.pool,
      }),
    ).resolves.toMatchObject({
      status: "failed",
      errorCode: "api_football_malformed_standings_data",
    });
    expect(database.connect).not.toHaveBeenCalled();
  });

  it("rejects clubs outside the exact current season membership", async () => {
    const rows = createStandingRows();
    rows[19]!.team.id = 999_999;
    const database = transactionClient();

    await expect(
      syncSerieAStandings({
        client: successfulClient(createResponse(rows)),
        transactionClient: database.client,
      }),
    ).resolves.toMatchObject({
      status: "failed",
      errorCode: "api_football_standings_club_not_found",
    });
    expect(
      database.query.mock.calls.some(([queryText]) =>
        queryText.includes("insert into football.standings"),
      ),
    ).toBe(false);
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
            attempts: 3,
          },
        };
      },
    };

    await expect(syncSerieAStandings({ client, pool: database.pool })).resolves.toEqual({
      status: "retry",
      errorCode: "api_football_http_server_error",
      message: "API-Football standings request failed: Provider unavailable",
    });
    expect(database.connect).not.toHaveBeenCalled();
  });
});
