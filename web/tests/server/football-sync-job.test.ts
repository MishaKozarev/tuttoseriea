import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { MatchLineupsSyncResult } from "@/src/football/match-lineups-sync";
import type { MatchStatisticsSyncResult } from "@/src/football/match-statistics-sync";

const mocks = vi.hoisted(() => ({
  createApiFootballClient: vi.fn(),
  end: vi.fn(async () => undefined),
  getRequestAttemptCount: vi.fn(() => 3),
  syncMatchEvents: vi.fn(async () => ({
    status: "success" as const,
    matchId: "11111111-1111-4111-8111-111111111111",
    providerFixtureId: 1_550_114,
    eventCount: 1,
    emptySnapshotAnomaly: null as unknown,
  })),
  syncMatchLineups: vi.fn<() => Promise<MatchLineupsSyncResult>>(async () => ({
    status: "success" as const,
    matchId: "11111111-1111-4111-8111-111111111111",
    providerFixtureId: 1_550_114,
    receivedTeamCount: 2,
    starterCount: 22,
    substituteCount: 4,
    entryCount: 26,
    resolvedPlayerCount: 20,
    unresolvedPlayerCount: 6,
    anomalies: [],
  })),
  syncMatchStatistics: vi.fn<() => Promise<MatchStatisticsSyncResult>>(async () => ({
    status: "success" as const,
    matchId: "11111111-1111-4111-8111-111111111111",
    providerFixtureId: 1_550_114,
    receivedTeamCount: 2,
    replacedTeamCount: 2,
    itemCount: 36,
    anomalies: [],
  })),
  syncSerieAStandings: vi.fn(async () => {
    throw new Error("forced standings failure");
  }),
  syncSerieASquads: vi.fn(async () => ({ status: "success" as const })),
  syncSerieAPlayerStatistics: vi.fn(async () => ({ status: "success" as const })),
}));

vi.mock("pg", () => ({
  Pool: class {
    end = mocks.end;
  },
}));

vi.mock("@/src/football/api-football/node", () => ({
  createApiFootballClient: mocks.createApiFootballClient,
}));

vi.mock("@/src/football/serie-a-foundation-sync", () => ({
  syncSerieAFoundation: vi.fn(),
}));

vi.mock("@/src/football/match-events-sync", () => ({
  syncMatchEvents: mocks.syncMatchEvents,
}));

vi.mock("@/src/football/match-lineups-sync", () => ({
  syncMatchLineups: mocks.syncMatchLineups,
}));

vi.mock("@/src/football/match-statistics-sync", () => ({
  syncMatchStatistics: mocks.syncMatchStatistics,
}));

vi.mock("@/src/football/serie-a-matches-sync", () => ({
  syncSerieAMatches: vi.fn(),
}));

vi.mock("@/src/football/serie-a-player-statistics-sync", () => ({
  syncSerieAPlayerStatistics: mocks.syncSerieAPlayerStatistics,
}));

vi.mock("@/src/football/serie-a-standings-sync", () => ({
  syncSerieAStandings: mocks.syncSerieAStandings,
}));

vi.mock("@/src/football/serie-a-squads-sync", () => ({
  syncSerieASquads: mocks.syncSerieASquads,
}));

import {
  syncSerieAMatchEventsJob,
  syncSerieAMatchLineupsJob,
  syncSerieAMatchStatisticsJob,
  syncSerieAPlayerStatisticsJob,
  syncSerieASquadsJob,
  syncSerieAStandingsJob,
} from "@/src/jobs/football-sync";
import type { JobExecutionContext } from "@/src/jobs/types";
import { logger } from "@/src/logging/logger-core";

describe("Football sync job request accounting", () => {
  const originalDatabaseUrl = process.env.DATABASE_URL;

  beforeEach(() => {
    process.env.DATABASE_URL = "postgresql://test.invalid/test";
    mocks.createApiFootballClient.mockReturnValue({
      getRequestAttemptCount: mocks.getRequestAttemptCount,
    });
    mocks.createApiFootballClient.mockClear();
    mocks.end.mockClear();
    mocks.getRequestAttemptCount.mockClear();
    mocks.getRequestAttemptCount.mockReturnValue(3);
    mocks.syncMatchEvents.mockClear();
    mocks.syncMatchEvents.mockResolvedValue({
      status: "success",
      matchId: "11111111-1111-4111-8111-111111111111",
      providerFixtureId: 1_550_114,
      eventCount: 1,
      emptySnapshotAnomaly: null,
    });
    mocks.syncMatchLineups.mockClear();
    mocks.syncMatchLineups.mockResolvedValue({
      status: "success",
      matchId: "11111111-1111-4111-8111-111111111111",
      providerFixtureId: 1_550_114,
      receivedTeamCount: 2,
      starterCount: 22,
      substituteCount: 4,
      entryCount: 26,
      resolvedPlayerCount: 20,
      unresolvedPlayerCount: 6,
      anomalies: [],
    });
    mocks.syncMatchStatistics.mockClear();
    mocks.syncMatchStatistics.mockResolvedValue({
      status: "success",
      matchId: "11111111-1111-4111-8111-111111111111",
      providerFixtureId: 1_550_114,
      receivedTeamCount: 2,
      replacedTeamCount: 2,
      itemCount: 36,
      anomalies: [],
    });
    mocks.syncSerieAStandings.mockClear();
    mocks.syncSerieASquads.mockClear();
    mocks.syncSerieAPlayerStatistics.mockClear();
  });

  it("emits one structured anomaly warning for a suspicious empty Match Events snapshot", async () => {
    const matchId = "11111111-1111-4111-8111-111111111111";
    mocks.syncMatchEvents.mockResolvedValue({
      status: "success",
      matchId,
      providerFixtureId: 1_550_114,
      eventCount: 0,
      emptySnapshotAnomaly: {
        code: "api_football_empty_match_events",
        matchId,
        providerFixtureId: 1_550_114,
        matchStatus: "finished",
        providerResultCount: 0,
      },
    });
    const warning = vi.spyOn(logger, "warn").mockImplementation(() => undefined);
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const context = {
      heartbeat: vi.fn(async () => undefined),
      execution: { payload: { matchId } },
    } as unknown as JobExecutionContext;

    await expect(syncSerieAMatchEventsJob.handle(context)).resolves.toEqual({
      status: "success",
    });

    expect(warning).toHaveBeenCalledOnce();
    expect(warning).toHaveBeenCalledWith(
      "API-Football returned an empty Match Events snapshot",
      {
        context: {
          event: "football.match_events.empty_snapshot",
          code: "api_football_empty_match_events",
          matchId,
          providerFixtureId: 1_550_114,
          matchStatus: "finished",
          providerResultCount: 0,
        },
      },
    );
    expect(JSON.stringify(warning.mock.calls)).not.toMatch(
      /api[_-]?key|authorization|secret|header/iu,
    );
    expect(mocks.getRequestAttemptCount).toHaveBeenCalledOnce();
    expect(log).toHaveBeenCalledWith("api_football_requests=3");
  });

  it("does not warn for an expected authoritative empty Match Events snapshot", async () => {
    const matchId = "11111111-1111-4111-8111-111111111111";
    mocks.syncMatchEvents.mockResolvedValue({
      status: "success",
      matchId,
      providerFixtureId: 1_550_114,
      eventCount: 0,
      emptySnapshotAnomaly: null,
    });
    const warning = vi.spyOn(logger, "warn").mockImplementation(() => undefined);
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const context = {
      heartbeat: vi.fn(async () => undefined),
      execution: { payload: { matchId } },
    } as unknown as JobExecutionContext;

    await expect(syncSerieAMatchEventsJob.handle(context)).resolves.toEqual({
      status: "success",
    });
    expect(warning).not.toHaveBeenCalled();
  });

  it("emits safe structured Match Lineups anomalies and one request total", async () => {
    const matchId = "11111111-1111-4111-8111-111111111111";
    mocks.syncMatchLineups.mockResolvedValue({
      status: "success",
      matchId,
      providerFixtureId: 1_550_114,
      receivedTeamCount: 1,
      starterCount: 10,
      substituteCount: 2,
      entryCount: 12,
      resolvedPlayerCount: 10,
      unresolvedPlayerCount: 2,
      anomalies: [
        {
          code: "api_football_partial_match_lineups",
          matchId,
          providerFixtureId: 1_550_114,
          receivedProviderTeamIds: [496],
          missingSide: "away",
          missingProviderTeamId: 489,
        },
        {
          code: "api_football_unexpected_match_lineup_starter_count",
          matchId,
          providerFixtureId: 1_550_114,
          teams: [{ providerTeamId: 496, starterCount: 10 }],
        },
      ],
    });
    const warning = vi.spyOn(logger, "warn").mockImplementation(() => undefined);
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const context = {
      heartbeat: vi.fn(async () => undefined),
      execution: { payload: { matchId } },
    } as unknown as JobExecutionContext;

    await expect(syncSerieAMatchLineupsJob.handle(context)).resolves.toEqual({
      status: "success",
    });
    expect(warning).toHaveBeenCalledTimes(2);
    expect(warning.mock.calls[0]).toEqual([
      "API-Football returned a partial Match Lineups snapshot",
      {
        context: {
          event: "football.match_lineups.partial_snapshot",
          code: "api_football_partial_match_lineups",
          matchId,
          providerFixtureId: 1_550_114,
          receivedProviderTeamIds: [496],
          missingSide: "away",
          missingProviderTeamId: 489,
        },
      },
    ]);
    expect(JSON.stringify(warning.mock.calls)).not.toMatch(
      /api[_-]?key|authorization|secret|header/iu,
    );
    expect(log).toHaveBeenCalledOnce();
    expect(log).toHaveBeenCalledWith("api_football_requests=3");
  });

  it("emits one safe structured warning for an anomalous empty Match Lineups response", async () => {
    const matchId = "11111111-1111-4111-8111-111111111111";
    mocks.syncMatchLineups.mockResolvedValue({
      status: "success",
      matchId,
      providerFixtureId: 1_550_114,
      receivedTeamCount: 0,
      starterCount: 0,
      substituteCount: 0,
      entryCount: 0,
      resolvedPlayerCount: 0,
      unresolvedPlayerCount: 0,
      anomalies: [
        {
          code: "api_football_empty_match_lineups",
          matchId,
          providerFixtureId: 1_550_114,
          matchStatus: "finished",
          providerResultCount: 0,
          persistedSides: ["home", "away"],
        },
      ],
    });
    const warning = vi.spyOn(logger, "warn").mockImplementation(() => undefined);
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const context = {
      heartbeat: vi.fn(async () => undefined),
      execution: { payload: { matchId } },
    } as unknown as JobExecutionContext;

    await expect(syncSerieAMatchLineupsJob.handle(context)).resolves.toEqual({
      status: "success",
    });
    expect(warning).toHaveBeenCalledOnce();
    expect(warning).toHaveBeenCalledWith(
      "API-Football returned an empty Match Lineups snapshot",
      {
        context: {
          event: "football.match_lineups.empty_snapshot",
          code: "api_football_empty_match_lineups",
          matchId,
          providerFixtureId: 1_550_114,
          matchStatus: "finished",
          providerResultCount: 0,
          persistedSides: ["home", "away"],
        },
      },
    );
    expect(JSON.stringify(warning.mock.calls)).not.toMatch(
      /api[_-]?key|authorization|secret|header/iu,
    );
  });

  it("emits safe Match Statistics anomalies and one request total", async () => {
    const matchId = "11111111-1111-4111-8111-111111111111";
    mocks.syncMatchStatistics.mockResolvedValue({
      status: "success",
      matchId,
      providerFixtureId: 1_550_114,
      receivedTeamCount: 2,
      replacedTeamCount: 1,
      itemCount: 18,
      anomalies: [
        {
          code: "api_football_empty_match_statistics_team",
          matchId,
          providerFixtureId: 1_550_114,
          matchStatus: "finished",
          teams: [{
            providerTeamId: 496,
            clubId: "club-home",
            side: "home",
            persistedSnapshot: true,
          }],
        },
        {
          code: "api_football_duplicate_match_statistic_type",
          matchId,
          providerFixtureId: 1_550_114,
          duplicates: [{
            providerTeamId: 489,
            providerType: "Fouls",
            providerOrders: [4, 8],
          }],
        },
      ],
    });
    const warning = vi.spyOn(logger, "warn").mockImplementation(() => undefined);
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const context = {
      heartbeat: vi.fn(async () => undefined),
      execution: { payload: { matchId } },
    } as unknown as JobExecutionContext;

    await expect(syncSerieAMatchStatisticsJob.handle(context)).resolves.toEqual({
      status: "success",
    });
    expect(warning).toHaveBeenCalledTimes(2);
    expect(warning.mock.calls[0]).toEqual([
      "API-Football returned an empty Match Statistics team",
      {
        context: {
          event: "football.match_statistics.empty_team",
          code: "api_football_empty_match_statistics_team",
          matchId,
          providerFixtureId: 1_550_114,
          matchStatus: "finished",
          teams: [{
            providerTeamId: 496,
            clubId: "club-home",
            side: "home",
            persistedSnapshot: true,
          }],
        },
      },
    ]);
    expect(JSON.stringify(warning.mock.calls)).not.toMatch(
      /api[_-]?key|authorization|secret|header/iu,
    );
    expect(log).toHaveBeenCalledOnce();
    expect(log).toHaveBeenCalledWith("api_football_requests=3");
  });

  it("logs the paginated player-statistics request total exactly once", async () => {
    mocks.getRequestAttemptCount.mockReturnValue(7);
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const context = {
      heartbeat: vi.fn(async () => undefined),
    } as unknown as JobExecutionContext;

    await expect(syncSerieAPlayerStatisticsJob.handle(context)).resolves.toEqual({
      status: "success",
    });

    expect(mocks.syncSerieAPlayerStatistics).toHaveBeenCalledOnce();
    expect(mocks.getRequestAttemptCount).toHaveBeenCalledOnce();
    expect(log).toHaveBeenCalledOnce();
    expect(log).toHaveBeenCalledWith("api_football_requests=7");
    expect(mocks.end).toHaveBeenCalledOnce();
  });

  it("logs the 20-request current-squads total exactly once on success", async () => {
    mocks.getRequestAttemptCount.mockReturnValue(20);
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const context = {
      heartbeat: vi.fn(async () => undefined),
    } as unknown as JobExecutionContext;

    await expect(syncSerieASquadsJob.handle(context)).resolves.toEqual({
      status: "success",
    });

    expect(mocks.syncSerieASquads).toHaveBeenCalledOnce();
    expect(mocks.getRequestAttemptCount).toHaveBeenCalledOnce();
    expect(log).toHaveBeenCalledOnce();
    expect(log).toHaveBeenCalledWith("api_football_requests=20");
    expect(mocks.end).toHaveBeenCalledOnce();
  });

  afterEach(() => {
    if (originalDatabaseUrl === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = originalDatabaseUrl;
    }

    vi.restoreAllMocks();
  });

  it("logs the client-scoped outbound attempt count exactly once when execution fails", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const context = {
      heartbeat: vi.fn(async () => undefined),
    } as unknown as JobExecutionContext;

    await expect(syncSerieAStandingsJob.handle(context)).rejects.toThrow(
      "forced standings failure",
    );

    expect(mocks.getRequestAttemptCount).toHaveBeenCalledOnce();
    expect(log).toHaveBeenCalledOnce();
    expect(log).toHaveBeenCalledWith("api_football_requests=3");
    expect(mocks.end).toHaveBeenCalledOnce();
  });

  it("logs zero once when configuration fails before a client or fetch attempt exists", async () => {
    delete process.env.DATABASE_URL;
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const context = {
      heartbeat: vi.fn(async () => undefined),
    } as unknown as JobExecutionContext;

    await expect(syncSerieAStandingsJob.handle(context)).rejects.toThrow(
      "DATABASE_URL is required for Football sync jobs",
    );

    expect(mocks.createApiFootballClient).not.toHaveBeenCalled();
    expect(mocks.getRequestAttemptCount).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledOnce();
    expect(log).toHaveBeenCalledWith("api_football_requests=0");
    expect(mocks.end).not.toHaveBeenCalled();
  });
});
