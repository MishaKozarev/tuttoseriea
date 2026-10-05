import { describe, expect, it, vi } from "vitest";

import {
  SERIE_A_MATCHES_JOB_TYPE,
  SERIE_A_MATCH_EVENTS_JOB_TYPE,
  SERIE_A_MATCH_STATISTICS_JOB_TYPE,
} from "@/src/football/foundation";
import type { MatchLifecycleDispatcherConfig } from "@/src/jobs/match-lifecycle-config";
import {
  createDispatcherJobRunner,
  runMatchLifecycleDispatcher,
} from "@/src/jobs/match-lifecycle-dispatcher";
import type {
  DispatcherExecution,
  MatchLifecycleSnapshot,
} from "@/src/jobs/match-lifecycle-policy";
import type { MatchLifecycleRepositoryContract } from "@/src/jobs/match-lifecycle-repository";
import type { RunJobResult } from "@/src/jobs/runner";
import type { JobRepository } from "@/src/jobs/repository";

const now = new Date("2026-10-05T20:00:00.000Z");

function config(): MatchLifecycleDispatcherConfig {
  return {
    managedFrom: new Date("2026-10-05T19:00:00.000Z"),
    recoveryHorizonSeconds: 86_400,
    finalConfirmationDelaySeconds: 1_800,
    maxConcurrency: 2,
    lineupConfirmationLeadSeconds: 600,
    lineupLiveRecoverySeconds: 3_600,
    failureCooldownSeconds: 300,
  };
}

function activeMatch(id = "11111111-1111-4111-8111-111111111111"):
  MatchLifecycleSnapshot {
  return {
    id,
    status: "live",
    kickoffAt: null,
    statusChangedAt: null,
    lineupHomeObservedAt: null,
    lineupAwayObservedAt: null,
    statisticsHomeObservedAt: null,
    statisticsAwayObservedAt: null,
  };
}

function lifecycleSuccess(): DispatcherExecution {
  return {
    id: "lifecycle-success",
    type: SERIE_A_MATCHES_JOB_TYPE,
    matchId: null,
    status: "succeeded",
    payload: {},
    availableAt: now,
    startedAt: new Date("2026-10-05T19:59:00.000Z"),
    finishedAt: new Date("2026-10-05T19:59:30.000Z"),
    createdAt: new Date("2026-10-05T19:59:00.000Z"),
    updatedAt: new Date("2026-10-05T19:59:30.000Z"),
  };
}

function jobResult(type: string, status: "success" | "terminal_failure" = "success"):
  RunJobResult {
  const execution = {
    id: crypto.randomUUID(),
    type,
    idempotencyKey: "scope",
    status: status === "success" ? "succeeded" as const : "failed" as const,
    payload: {},
    availableAt: now,
    attemptCount: 1,
    maxAttempts: 3,
    claimedBy: null,
    claimVersion: 1,
    leaseExpiresAt: null,
    startedAt: now,
    finishedAt: now,
    lastErrorCode: null,
    lastErrorMessage: null,
    createdAt: now,
    updatedAt: now,
  };

  return status === "success"
    ? { outcome: { status, execution }, exitCode: 0 }
    : { outcome: { status, execution }, exitCode: 2 };
}

function repository(input: {
  matches?: MatchLifecycleSnapshot[];
  lifecycle?: DispatcherExecution[];
  matchExecutions?: DispatcherExecution[];
  locked?: boolean;
} = {}): MatchLifecycleRepositoryContract {
  return {
    tryAcquireLock: vi.fn(async () =>
      input.locked === false ? null : { release: vi.fn(async () => undefined) },
    ),
    listCurrentSerieAMatches: vi.fn(async () => input.matches ?? [activeMatch()]),
    listLifecycleExecutions: vi.fn(async () => input.lifecycle ?? [lifecycleSuccess()]),
    listMatchExecutions: vi.fn(async () => input.matchExecutions ?? []),
  };
}

describe("Match lifecycle dispatcher", () => {
  it("turns an overlapping singleton tick into a no-op", async () => {
    const runJob = vi.fn();

    await expect(
      runMatchLifecycleDispatcher({
        repository: repository({ locked: false }),
        runJob,
        config: config(),
        now,
      }),
    ).resolves.toMatchObject({ status: "no_op", reason: "lock_held" });
    expect(runJob).not.toHaveBeenCalled();
  });

  it("does not fan out from a stale active status when lifecycle refresh fails", async () => {
    const staleLifecycle = {
      ...lifecycleSuccess(),
      finishedAt: new Date("2026-10-05T19:50:00.000Z"),
      updatedAt: new Date("2026-10-05T19:50:00.000Z"),
    };
    const runJob = vi.fn(async (type: string) => jobResult(type, "terminal_failure"));

    const result = await runMatchLifecycleDispatcher({
      repository: repository({ lifecycle: [staleLifecycle] }),
      runJob,
      config: config(),
      now,
    });

    expect(result).toMatchObject({
      status: "no_op",
      reason: "lifecycle_not_fresh",
      selectedTasks: 0,
    });
    expect(runJob).toHaveBeenCalledTimes(1);
    expect(runJob).toHaveBeenCalledWith(SERIE_A_MATCHES_JOB_TYPE, []);
  });

  it("admits a pre-migration null-marker active Match only after successful refresh", async () => {
    const repo = repository({ lifecycle: [] });
    vi.mocked(repo.listLifecycleExecutions)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([lifecycleSuccess()]);
    const runJob = vi.fn(async (type: string) => jobResult(type));

    const result = await runMatchLifecycleDispatcher({
      repository: repo,
      runJob,
      config: config(),
      now,
    });

    expect(result).toMatchObject({
      status: "completed",
      lifecycleRefreshed: true,
      lifecycleFresh: true,
      selectedTasks: 2,
      completedTasks: 2,
    });
    expect(runJob.mock.calls.map(([type]) => type)).toEqual([
      SERIE_A_MATCHES_JOB_TYPE,
      SERIE_A_MATCH_EVENTS_JOB_TYPE,
      SERIE_A_MATCH_STATISTICS_JOB_TYPE,
    ]);
  });

  it.each(["paused", "suspended", "interrupted"] as const)(
    "admits a freshly confirmed null-marker %s Match during rollout",
    async (status) => {
      const runJob = vi.fn(async (type: string) => jobResult(type));
      const result = await runMatchLifecycleDispatcher({
        repository: repository({ matches: [{ ...activeMatch(), status }] }),
        runJob,
        config: config(),
        now,
      });

      expect(result.lifecycleFresh).toBe(true);
      expect(result.selectedTasks).toBe(2);
      expect(runJob).toHaveBeenCalledTimes(2);
    },
  );

  it("keeps historical finished null-marker Matches out after a fresh lifecycle gate", async () => {
    const runJob = vi.fn(async (type: string) => jobResult(type));
    const result = await runMatchLifecycleDispatcher({
      repository: repository({
        matches: [{ ...activeMatch(), status: "finished" }],
      }),
      runJob,
      config: config(),
      now,
    });

    expect(result.selectedTasks).toBe(0);
    expect(runJob).not.toHaveBeenCalled();
  });

  it("caps concurrent dataset execution at two", async () => {
    const matches = Array.from({ length: 4 }, (_, index) =>
      activeMatch(`11111111-1111-4111-8111-11111111111${index}`),
    );
    let active = 0;
    let maximum = 0;
    const runJob = vi.fn(async (type: string) => {
      active += 1;
      maximum = Math.max(maximum, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return jobResult(type);
    });

    const result = await runMatchLifecycleDispatcher({
      repository: repository({ matches }),
      runJob,
      config: config(),
      now,
    });

    expect(result.selectedTasks).toBe(8);
    expect(maximum).toBe(2);
  });

  it("dry-run never invokes lifecycle or dataset jobs", async () => {
    const runJob = vi.fn();

    const result = await runMatchLifecycleDispatcher({
      repository: repository({ lifecycle: [] }),
      runJob,
      config: config(),
      now,
      dryRun: true,
    });

    expect(result).toMatchObject({
      status: "no_op",
      reason: "lifecycle_not_fresh",
    });
    expect(runJob).not.toHaveBeenCalled();
  });

  it("adds closed dispatcher metadata internally without changing the job arguments", async () => {
    const pendingExecution = {
      id: "execution-1",
      type: SERIE_A_MATCH_EVENTS_JOB_TYPE,
      idempotencyKey: "scope",
      status: "pending" as const,
      payload: {},
      availableAt: now,
      attemptCount: 0,
      maxAttempts: 3,
      claimedBy: null,
      claimVersion: 0,
      leaseExpiresAt: null,
      startedAt: null,
      finishedAt: null,
      lastErrorCode: null,
      lastErrorMessage: null,
      createdAt: now,
      updatedAt: now,
    };
    const createOrGetActiveExecution = vi.fn(async (input: { payload: Record<string, unknown> }) => ({
      ...pendingExecution,
      payload: input.payload,
    }));
    const fakeRepository = {
      createOrGetActiveExecution,
      claimExecution: vi.fn(async () => null),
      getExecution: vi.fn(async () => pendingExecution),
    } as unknown as JobRepository;
    const runner = createDispatcherJobRunner({
      config: {
        databaseUrl: "postgresql://unused",
        jobsSchema: "jobs",
        leaseSeconds: 60,
        maxAttempts: 3,
        retryDelaySeconds: 60,
        retryDelayCapSeconds: 300,
      },
      repository: fakeRepository,
    });

    await runner(
      SERIE_A_MATCH_EVENTS_JOB_TYPE,
      ["--match-id", "11111111-1111-4111-8111-111111111111"],
      {
        matchId: "11111111-1111-4111-8111-111111111111",
        type: SERIE_A_MATCH_EVENTS_JOB_TYPE,
        phase: "terminal-final",
        statusChangedAt: "2026-10-05T19:00:00.000Z",
        priority: 20,
      },
    );

    expect(createOrGetActiveExecution).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          matchId: "11111111-1111-4111-8111-111111111111",
          dispatcher: {
            version: 1,
            phase: "terminal-final",
            statusChangedAt: "2026-10-05T19:00:00.000Z",
          },
        }),
      }),
    );
  });
});
