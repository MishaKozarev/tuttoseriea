import { describe, expect, it, vi } from "vitest";

import {
  SERIE_A_MATCH_EVENTS_JOB_TYPE,
  SERIE_A_MATCH_LINEUPS_JOB_TYPE,
  SERIE_A_MATCH_STATISTICS_JOB_TYPE,
} from "@/src/football/foundation";
import {
  createMatchDataBackfillPlan,
  MATCH_DATA_BACKFILL_MAX_CONCURRENCY,
  runMatchDataBackfill,
} from "@/src/jobs/match-data-backfill";
import { parseMatchDataBackfillArguments } from "@/src/jobs/match-data-backfill-cli";
import type {
  MatchDataBackfillRepositoryContract,
  MatchDataBackfillSnapshot,
} from "@/src/jobs/match-data-backfill-repository";
import type { RunJobResult } from "@/src/jobs/runner";

const matchId = "11111111-1111-4111-8111-111111111111";

function snapshot(
  overrides: Partial<MatchDataBackfillSnapshot> = {},
): MatchDataBackfillSnapshot {
  return {
    matchId,
    providerFixtureId: 1_550_114,
    statusChangedAt: null,
    eventsComplete: false,
    lineupsComplete: false,
    statisticsComplete: false,
    ...overrides,
  };
}

function repository(
  reads: readonly MatchDataBackfillSnapshot[][],
): MatchDataBackfillRepositoryContract {
  let index = 0;

  return {
    listFinishedMatches: vi.fn(async () => {
      const value = reads[Math.min(index, reads.length - 1)] ?? [];
      index += 1;
      return value;
    }),
    tryAcquireRunLock: vi.fn(async () => ({
      release: vi.fn(async () => undefined),
    })),
  };
}

function jobResult(
  type: string,
  status: "success" | "terminal_failure" = "success",
): RunJobResult {
  const execution = {
    id: crypto.randomUUID(),
    type,
    idempotencyKey: "scope",
    status: status === "success" ? ("succeeded" as const) : ("failed" as const),
    payload: {},
    availableAt: new Date(),
    attemptCount: 1,
    maxAttempts: 3,
    claimedBy: null,
    claimVersion: 1,
    leaseExpiresAt: null,
    startedAt: new Date(),
    finishedAt: new Date(),
    lastErrorCode: status === "success" ? null : "provider_contract_failure",
    lastErrorMessage: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  return status === "success"
    ? { outcome: { status, execution }, exitCode: 0 }
    : { outcome: { status, execution }, exitCode: 2 };
}

describe("finished Match data backfill", () => {
  it("builds exact missing operations and admits a historical null marker", () => {
    const plan = createMatchDataBackfillPlan([
      snapshot({ eventsComplete: true }),
      snapshot({
        matchId: "22222222-2222-4222-8222-222222222222",
        providerFixtureId: 1_550_115,
        eventsComplete: true,
        lineupsComplete: true,
        statisticsComplete: true,
      }),
    ]);

    expect(plan).toMatchObject({
      totalFinishedMatches: 2,
      candidateMatches: 1,
      missingEvents: 0,
      missingLineups: 1,
      missingStatistics: 1,
      alreadyComplete: 1,
      datasetOperations: 2,
      cleanPathEstimatedProviderRequests: 2,
    });
    expect(plan.candidates).toEqual([
      {
        matchId,
        providerFixtureId: 1_550_114,
        statusChangedAt: null,
        missingDatasets: ["lineups", "statistics"],
      },
    ]);
    expect(plan.operations.map(({ jobType }) => jobType)).toEqual([
      SERIE_A_MATCH_LINEUPS_JOB_TYPE,
      SERIE_A_MATCH_STATISTICS_JOB_TYPE,
    ]);
  });

  it("dry-run performs one read and never acquires a run lock or invokes jobs", async () => {
    const repo = repository([[snapshot()]]);
    const runJob = vi.fn();

    const result = await runMatchDataBackfill({
      repository: repo,
      mode: "dry-run",
      runJob,
    });

    expect(result).toMatchObject({
      status: "dry_run",
      plan: { candidateMatches: 1, datasetOperations: 3 },
    });
    expect(repo.listFinishedMatches).toHaveBeenCalledOnce();
    expect(repo.tryAcquireRunLock).not.toHaveBeenCalled();
    expect(runJob).not.toHaveBeenCalled();
  });

  it("caps run concurrency at two and verifies all datasets after execution", async () => {
    const initial = Array.from({ length: 3 }, (_, index) =>
      snapshot({
        matchId: `11111111-1111-4111-8111-11111111111${index}`,
        providerFixtureId: 1_550_120 + index,
      }),
    );
    const verified = initial.map((match) => ({
      ...match,
      eventsComplete: true,
      lineupsComplete: true,
      statisticsComplete: true,
    }));
    let active = 0;
    let maximum = 0;
    const runJob = vi.fn(async (type: string) => {
      active += 1;
      maximum = Math.max(maximum, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return jobResult(type);
    });

    const result = await runMatchDataBackfill({
      repository: repository([initial, verified]),
      mode: "run",
      runJob,
    });

    expect(MATCH_DATA_BACKFILL_MAX_CONCURRENCY).toBe(2);
    expect(maximum).toBe(2);
    expect(runJob).toHaveBeenCalledTimes(9);
    expect(result).toMatchObject({
      status: "completed",
      verifiedPlan: { datasetOperations: 0 },
    });
  });

  it("does not treat successful partial Lineups or Statistics as complete", async () => {
    const runJob = vi.fn(async (type: string) => jobResult(type));
    const initial = snapshot({ eventsComplete: true });
    const stillPartial = snapshot({ eventsComplete: true });

    const result = await runMatchDataBackfill({
      repository: repository([[initial], [stillPartial]]),
      mode: "run",
      runJob,
    });

    expect(runJob.mock.calls.map(([type]) => type)).toEqual([
      SERIE_A_MATCH_LINEUPS_JOB_TYPE,
      SERIE_A_MATCH_STATISTICS_JOB_TYPE,
    ]);
    expect(result.status).toBe("completed_with_failures");
    if (result.status === "completed_with_failures") {
      expect(result.results).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            dataset: "lineups",
            jobOutcome: "success",
            verifiedComplete: false,
          }),
          expect.objectContaining({
            dataset: "statistics",
            jobOutcome: "success",
            verifiedComplete: false,
          }),
        ]),
      );
      expect(result.verifiedPlan.datasetOperations).toBe(2);
    }
  });

  it("continues remaining operations after a terminal dataset failure", async () => {
    const runJob = vi.fn(async (type: string) =>
      jobResult(
        type,
        type === SERIE_A_MATCH_EVENTS_JOB_TYPE ? "terminal_failure" : "success",
      ),
    );

    const result = await runMatchDataBackfill({
      repository: repository([
        [snapshot()],
        [snapshot({ lineupsComplete: true, statisticsComplete: true })],
      ]),
      mode: "run",
      runJob,
    });

    expect(runJob).toHaveBeenCalledTimes(3);
    expect(result.status).toBe("completed_with_failures");
    if (result.status === "completed_with_failures") {
      expect(result.results).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            dataset: "events",
            jobOutcome: "terminal_failure",
            verifiedComplete: false,
          }),
          expect.objectContaining({
            dataset: "lineups",
            jobOutcome: "success",
            verifiedComplete: true,
          }),
          expect.objectContaining({
            dataset: "statistics",
            jobOutcome: "success",
            verifiedComplete: true,
          }),
        ]),
      );
    }
  });

  it("accepts only one fixed CLI mode", () => {
    expect(parseMatchDataBackfillArguments(["--check-runtime"])).toBe(
      "check-runtime",
    );
    expect(parseMatchDataBackfillArguments(["--dry-run"])).toBe("dry-run");
    expect(parseMatchDataBackfillArguments(["--run"])).toBe("run");
    expect(() => parseMatchDataBackfillArguments([])).toThrow();
    expect(() => parseMatchDataBackfillArguments(["--run", "extra"])).toThrow();
    expect(() => parseMatchDataBackfillArguments(["--match-id", matchId])).toThrow();
  });
});
