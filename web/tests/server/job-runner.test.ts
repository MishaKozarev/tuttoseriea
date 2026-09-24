import { describe, expect, it } from "vitest";

import {
  createJobRegistry,
  JobUsageError,
  normalizeRetryDelaySeconds,
  RUNNER_EXIT_CODES,
  runJobOnce,
  type ClaimedJobExecution,
  type JobDefinition,
  type JobExecution,
  type JobRepository,
} from "@/src/jobs";

function createExecution(
  overrides: Partial<JobExecution> = {},
): JobExecution {
  const now = new Date("2026-01-01T00:00:00Z");

  return {
    id: "execution-1",
    type: "test.job",
    idempotencyKey: "scope:test",
    status: "pending",
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
    ...overrides,
  };
}

function createClaimedExecution(): ClaimedJobExecution {
  return createExecution({
    status: "running",
    attemptCount: 1,
    claimedBy: "runner-1",
    claimVersion: 1,
    leaseExpiresAt: new Date("2026-01-01T00:01:00Z"),
  }) as ClaimedJobExecution;
}

function createDefinition(
  handle: JobDefinition["handle"],
): JobDefinition {
  return {
    type: "test.job",
    parseArguments: () => ({
      idempotencyKey: "scope:test",
      payload: { scope: "test" },
    }),
    handle,
  };
}

describe("job runner foundation", () => {
  it("rejects duplicate job types in an injectable registry", () => {
    const definition = createDefinition(async () => ({ status: "success" }));

    expect(() => createJobRegistry([definition, definition])).toThrow(JobUsageError);
  });

  it("caps explicit retry delays using runner configuration", () => {
    expect(
      normalizeRetryDelaySeconds(600, {
        retryDelaySeconds: 60,
        retryDelayCapSeconds: 300,
      }),
    ).toBe(300);
  });

  it("marks unexpected handler exceptions as terminal failures", async () => {
    const claimed = createClaimedExecution();
    const failed = createExecution({
      status: "failed",
      attemptCount: 1,
      lastErrorCode: "handler_unexpected_error",
      lastErrorMessage: "Job handler failed unexpectedly.",
    });
    const repository = {
      createOrGetActiveExecution: async () => createExecution(),
      claimExecution: async () => claimed,
      finalizeFailure: async () => failed,
    } as unknown as JobRepository;
    const registry = createJobRegistry([
      createDefinition(async () => {
        throw new Error("boom");
      }),
    ]);

    const result = await runJobOnce({
      type: "test.job",
      args: [],
      registry,
      config: {
        databaseUrl: "postgresql://example.invalid/db",
        jobsSchema: "jobs",
        leaseSeconds: 60,
        maxAttempts: 3,
        retryDelaySeconds: 60,
        retryDelayCapSeconds: 300,
      },
      repository,
      runnerId: "runner-1",
    });

    expect(result.exitCode).toBe(RUNNER_EXIT_CODES.terminalFailure);
    expect(result.outcome.status).toBe("terminal_failure");
    expect(result.outcome).toMatchObject({
      execution: { lastErrorCode: "handler_unexpected_error" },
    });
  });

  it("returns lease_lost when heartbeat loses fencing ownership", async () => {
    const claimed = createClaimedExecution();
    let finalized = false;
    const repository = {
      createOrGetActiveExecution: async () => createExecution(),
      claimExecution: async () => claimed,
      heartbeat: async () => null,
      finalizeSuccess: async () => {
        finalized = true;
        return createExecution({ status: "succeeded" });
      },
      finalizeFailure: async () => {
        finalized = true;
        return createExecution({ status: "failed" });
      },
    } as unknown as JobRepository;
    const registry = createJobRegistry([
      createDefinition(async (context) => {
        await context.heartbeat();
        return { status: "success" };
      }),
    ]);

    const result = await runJobOnce({
      type: "test.job",
      args: [],
      registry,
      config: {
        databaseUrl: "postgresql://example.invalid/db",
        jobsSchema: "jobs",
        leaseSeconds: 60,
        maxAttempts: 3,
        retryDelaySeconds: 60,
        retryDelayCapSeconds: 300,
      },
      repository,
      runnerId: "runner-1",
    });

    expect(result.exitCode).toBe(RUNNER_EXIT_CODES.leaseLost);
    expect(result.outcome.status).toBe("lease_lost");
    expect(finalized).toBe(false);
  });
});
