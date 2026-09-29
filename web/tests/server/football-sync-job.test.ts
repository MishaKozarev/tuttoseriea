import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createApiFootballClient: vi.fn(),
  end: vi.fn(async () => undefined),
  getRequestAttemptCount: vi.fn(() => 3),
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
  syncSerieAPlayerStatisticsJob,
  syncSerieASquadsJob,
  syncSerieAStandingsJob,
} from "@/src/jobs/football-sync";
import type { JobExecutionContext } from "@/src/jobs/types";

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
    mocks.syncSerieAStandings.mockClear();
    mocks.syncSerieASquads.mockClear();
    mocks.syncSerieAPlayerStatistics.mockClear();
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
