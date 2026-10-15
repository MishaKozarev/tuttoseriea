import { describe, expect, it, vi } from "vitest";

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

  it("passes an optional provider request gate to the canonical job handler", async () => {
    const claimed = createClaimedExecution();
    const succeeded = createExecution({ status: "succeeded" });
    const beforeProviderRequestAttempt = async () => undefined;
    const repository = {
      createOrGetActiveExecution: async () => createExecution(),
      claimExecution: async () => claimed,
      finalizeSuccess: async () => succeeded,
    } as unknown as JobRepository;
    const registry = createJobRegistry([
      createDefinition(async (context) => {
        expect(context.beforeProviderRequestAttempt).toBe(
          beforeProviderRequestAttempt,
        );
        await context.beforeProviderRequestAttempt?.();
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
      beforeProviderRequestAttempt,
    });

    expect(result.exitCode).toBe(RUNNER_EXIT_CODES.success);
  });
});

describe("execution-ID runner binding", () => {
  const config = {
    databaseUrl: "postgresql://example.invalid/db",
    jobsSchema: "jobs",
    leaseSeconds: 60,
    maxAttempts: 3,
    retryDelaySeconds: 60,
    retryDelayCapSeconds: 300,
  };

  function boundRepository(execution: JobExecution | null) {
    return {
      getExecution: vi.fn().mockResolvedValue(execution),
      recoverExpiredExecution: vi.fn().mockResolvedValue(undefined),
      createOrGetActiveExecution: vi.fn(() => { throw new Error("Must not create an execution"); }),
      claimExecution: vi.fn().mockResolvedValue(null),
      finalizeSuccess: vi.fn().mockResolvedValue(execution),
    };
  }

  it.each([
    { executionId: undefined, beforeProviderRequestAttempt: async () => {} },
    { executionId: "execution-1", beforeProviderRequestAttempt: undefined },
  ])("rejects an Admin claim missing its execution binding or gate %#", async (input) => {
    const repository = boundRepository(null);
    await expect(runJobOnce({
      ...input, adminRequestId: "request-1", type: "test.job", args: [], config,
      registry: createJobRegistry([createDefinition(async () => ({ status: "success" }))]),
      repository: repository as unknown as JobRepository,
    })).rejects.toBeInstanceOf(JobUsageError);
    expect(repository.getExecution).not.toHaveBeenCalled();
    expect(repository.claimExecution).not.toHaveBeenCalled();
  });

  it("binds Admin recovery and claim to the same request/execution ID", async () => {
    const execution = createExecution({ payload: { scope: "test" } });
    const repository = boundRepository(execution);
    await runJobOnce({
      type: "test.job", args: [], executionId: execution.id, adminRequestId: "request-1",
      beforeProviderRequestAttempt: async () => {}, config, runnerId: "consumer-1",
      registry: createJobRegistry([createDefinition(async () => ({ status: "success" }))]),
      repository: repository as unknown as JobRepository,
    });
    expect(repository.recoverExpiredExecution).toHaveBeenCalledWith(execution.id, {
      type: "test.job", idempotencyKey: "scope:test",
    }, "request-1");
    expect(repository.claimExecution).toHaveBeenCalledWith(execution.id, "consumer-1", 60, {
      type: "test.job", idempotencyKey: "scope:test",
    }, "request-1");
    expect(repository.createOrGetActiveExecution).not.toHaveBeenCalled();
  });

  it("uses the same handler and claim/finalization for a specific existing ID", async () => {
    const execution = createExecution({ payload: { scope: "test", dispatcher: { phase: "active-poll" } } });
    const repository = boundRepository(execution);
    repository.claimExecution.mockResolvedValue({
      ...execution, ...createClaimedExecution(), payload: execution.payload,
    });
    repository.finalizeSuccess.mockResolvedValue({ ...execution, status: "succeeded" });
    const handler = vi.fn(async (context: { execution: JobExecution }) => {
      expect(context.execution.id).toBe(execution.id);
      expect(context.execution.payload.dispatcher).toEqual({ phase: "active-poll" });
      return { status: "success" as const };
    });

    const result = await runJobOnce({
      type: "test.job", args: [], executionId: execution.id, config,
      registry: createJobRegistry([createDefinition(handler)]),
      repository: repository as unknown as JobRepository, runnerId: "runner-1",
    });

    expect(result.outcome).toMatchObject({ status: "success", execution: { id: execution.id } });
    expect(repository.claimExecution).toHaveBeenCalledWith(execution.id, "runner-1", 60, {
      type: "test.job", idempotencyKey: "scope:test",
    });
    expect(handler).toHaveBeenCalledOnce();
    expect(repository.createOrGetActiveExecution).not.toHaveBeenCalled();
  });

  it.each(["succeeded", "failed", "running", "pending"] as const)(
    "never replaces a non-claimable %s execution with a new one", async (status) => {
      const execution = createExecution({ status, payload: { scope: "test" } });
      const repository = boundRepository(execution);
      const handler = vi.fn(async () => ({ status: "success" as const }));

      const result = await runJobOnce({
        type: "test.job", args: [], executionId: execution.id, config,
        registry: createJobRegistry([createDefinition(handler)]),
        repository: repository as unknown as JobRepository,
      });

      expect(result.outcome).toMatchObject({ status: "no_op", execution: { id: execution.id, status } });
      expect(repository.recoverExpiredExecution).toHaveBeenCalledWith(execution.id, {
        type: "test.job", idempotencyKey: "scope:test",
      });
      expect(handler).not.toHaveBeenCalled();
      expect(repository.createOrGetActiveExecution).not.toHaveBeenCalled();
    },
  );

  it.each([
    null,
    createExecution({ type: "other.job", payload: { scope: "test" } }),
    createExecution({ idempotencyKey: "other", payload: { scope: "test" } }),
    createExecution({ payload: { scope: "other" } }),
  ])("rejects a missing ID or canonical scope mismatch %#", async (execution) => {
    const repository = boundRepository(execution);
    const handler = vi.fn(async () => ({ status: "success" as const }));

    await expect(runJobOnce({
      type: "test.job", args: [], executionId: "execution-1", config,
      registry: createJobRegistry([createDefinition(handler)]),
      repository: repository as unknown as JobRepository,
    })).rejects.toBeInstanceOf(JobUsageError);

    expect(repository.recoverExpiredExecution).not.toHaveBeenCalled();
    expect(repository.claimExecution).not.toHaveBeenCalled();
    expect(repository.createOrGetActiveExecution).not.toHaveBeenCalled();
    expect(handler).not.toHaveBeenCalled();
  });

  it("observes completion by another trigger between selection and claim", async () => {
    const pending = createExecution({ payload: { scope: "test" } });
    const repository = boundRepository(pending);
    repository.getExecution.mockResolvedValueOnce(pending).mockResolvedValue({ ...pending, status: "succeeded" });

    const result = await runJobOnce({
      type: "test.job", args: [], executionId: pending.id, config,
      registry: createJobRegistry([createDefinition(async () => ({ status: "success" }))]),
      repository: repository as unknown as JobRepository,
    });

    expect(result.outcome).toMatchObject({ status: "no_op", execution: { id: pending.id, status: "succeeded" } });
    expect(repository.createOrGetActiveExecution).not.toHaveBeenCalled();
  });
});
