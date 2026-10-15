import { describe, expect, it, vi } from "vitest";
import {
  ADMIN_JOB_TYPES, ADMIN_JOB_MIN_REQUEST_INTERVAL_MS, parseAdminJobCommand,
} from "@/src/jobs/admin-contract";
import { createAdminProviderGate, consumeAdminJob, runAdminConsumer } from "@/src/jobs/admin-consumer";
import { adminConsumerMain, parseAdminConsumerArguments, requireAdminConsumerOptIn } from "@/src/jobs/admin-consumer-cli";
import { createJobRegistry, productionJobRegistry } from "@/src/jobs/registry";
import type { AdminJobRepository } from "@/src/jobs/admin-repository";
import { JobLeaseLostError } from "@/src/jobs/types";

const uuid = "a184203a-fc94-40a8-8ee2-c1144295750f";
const config = { databaseUrl: "postgresql://example.invalid/db", jobsSchema: "jobs", leaseSeconds: 60,
  maxAttempts: 3, retryDelaySeconds: 60, retryDelayCapSeconds: 300 };
const body = (jobType: string = ADMIN_JOB_TYPES[0]) => ({ jobType, requestKey: uuid, confirmed: true });

describe("bounded Admin job command", () => {
  it.each(ADMIN_JOB_TYPES.slice(0, 5))("accepts only the canonical no-argument scope for %s", (type) => {
    const parsed = parseAdminJobCommand(body(type));
    expect(parsed.matchId).toBeNull();
    expect(parsed.idempotencyKey).toBe(productionJobRegistry.get(type)!.parseArguments([]).idempotencyKey);
    expect(() => parseAdminJobCommand({ ...body(type), matchId: uuid })).toThrow();
  });
  it.each(ADMIN_JOB_TYPES.slice(5))("requires a lowercase Match UUID for %s", (type) => {
    expect(parseAdminJobCommand({ ...body(type), matchId: uuid })).toMatchObject({ matchId: uuid });
    for (const matchId of [undefined, uuid.toUpperCase(), "../match", "not-uuid", 1]) {
      expect(() => parseAdminJobCommand({ ...body(type), matchId })).toThrow();
    }
  });
  it.each([
    null, [], {}, { ...body(), jobType: "arbitrary.job" }, { ...body(), confirmed: false },
    { ...body(), confirmed: "true" }, { ...body(), requestKey: "bad" },
    { ...body(), args: [] }, { ...body(), payload: {} }, { ...body(), actorAccountId: uuid },
    { ...body(), season: 2025 }, { ...body(), executionId: uuid },
  ])("rejects unconfirmed, invalid or arbitrary input %#", (input) => {
    expect(() => parseAdminJobCommand(input)).toThrow();
  });
});

describe("Admin consumer", () => {
  it("paces all attempts including concurrent calls and starts with a full restart interval", async () => {
    let now = 0;
    const waits: number[] = [];
    const gate = createAdminProviderGate({ now: () => now, sleep: async (ms) => { waits.push(ms); now += ms; } });
    await Promise.all([gate(), gate(), gate()]);
    expect(waits).toEqual([500, 500, 500]);
    now += ADMIN_JOB_MIN_REQUEST_INTERVAL_MS * 3;
    await gate();
    expect(waits).toHaveLength(3);
  });

  it("measures the interval after asynchronous ownership verification", async () => {
    let now = 0;
    const starts: number[] = [];
    const gate = createAdminProviderGate({ now: () => now, sleep: async (ms) => { now += ms; } });
    await gate(async () => { now += 700; });
    starts.push(now);
    await gate();
    starts.push(now);
    expect(starts[1] - starts[0]).toBe(500);
  });

  it("rechecks elapsed time when a timer wakes early", async () => {
    let now = 0;
    const waits: number[] = [];
    const gate = createAdminProviderGate({ now: () => now, sleep: async (ms) => {
      waits.push(ms);
      now += waits.length === 1 ? ms - 1 : ms;
    } });
    await gate();
    expect(now).toBe(500);
    expect(waits).toEqual([500, 1]);
  });

  function fake() {
    const parsed = parseAdminJobCommand(body());
    const execution = { id: uuid, type: parsed.jobType, idempotencyKey: parsed.idempotencyKey,
      payload: productionJobRegistry.get(parsed.jobType)!.parseArguments([]).payload,
      status: "pending", attemptCount: 0, maxAttempts: 3, claimVersion: 0 };
    const jobs = {
      getExecution: vi.fn(async () => execution), recoverExpiredExecution: vi.fn(),
      createOrGetActiveExecution: vi.fn(() => { throw new Error("Unexpected creation"); }),
      claimExecution: vi.fn(async (_id, owner) => {
        Object.assign(execution, { status: "running", claimedBy: owner, claimVersion: 1, attemptCount: 1 });
        return execution;
      }),
      heartbeat: vi.fn(async () => execution),
      finalizeSuccess: vi.fn(async () => ({ ...execution, status: "succeeded" })),
    };
    const lock = { assertHeld: vi.fn(async () => {}), release: vi.fn(async () => {}) };
    const repository = { jobs, nextDue: vi.fn(async () => ({ ...parsed, executionId: uuid, requestId: uuid })),
      assertCurrentScope: vi.fn(async () => {}), tryAcquireConsumerLock: vi.fn(async () => lock) };
    return { repository, jobs, lock, execution };
  }

  it("runs a selected associated ID through the shared runner and gates each provider attempt", async () => {
    const { repository, jobs, lock } = fake();
    const gate = vi.fn(async (verify: () => Promise<void>) => { await verify(); });
    const definition = productionJobRegistry.get(ADMIN_JOB_TYPES[0])!;
    const registry = createJobRegistry([{ ...definition, handle: async (context) => {
      await context.beforeProviderRequestAttempt!();
      await context.beforeProviderRequestAttempt!();
      return { status: "success" };
    } }]);
    const result = await consumeAdminJob({ repository: repository as unknown as AdminJobRepository,
      lock, config, registry, providerGate: gate });
    expect(result?.outcome.status).toBe("success");
    expect(gate).toHaveBeenCalledTimes(2);
    expect(jobs.heartbeat).toHaveBeenCalledTimes(2);
    expect(jobs.createOrGetActiveExecution).not.toHaveBeenCalled();
  });

  it("stops provider work when the consumer lock is lost", async () => {
    const { repository, jobs, lock } = fake();
    lock.assertHeld.mockResolvedValueOnce(undefined).mockRejectedValue(new JobLeaseLostError());
    const definition = productionJobRegistry.get(ADMIN_JOB_TYPES[0])!;
    const provider = vi.fn();
    const registry = createJobRegistry([{ ...definition, handle: async (context) => {
      await context.beforeProviderRequestAttempt!();
      provider();
      return { status: "success" };
    } }]);
    const result = await consumeAdminJob({ repository: repository as unknown as AdminJobRepository,
      lock, config, registry, providerGate: async (verify) => { await verify(); } });
    expect(result?.outcome.status).toBe("lease_lost");
    expect(provider).not.toHaveBeenCalled();
    expect(jobs.finalizeSuccess).not.toHaveBeenCalled();
  });

  it("does no work when another consumer holds the singleton lock", async () => {
    const nextDue = vi.fn();
    const repository = { tryAcquireConsumerLock: async () => null, nextDue };
    expect(await runAdminConsumer({ repository: repository as unknown as AdminJobRepository, config, once: true }))
      .toBe("already_running");
    expect(nextDue).not.toHaveBeenCalled();
  });

  it("releases its lock after an empty once tick", async () => {
    const { repository, lock } = fake();
    repository.nextDue.mockResolvedValue(null as never);
    await runAdminConsumer({ repository: repository as unknown as AdminJobRepository, config, once: true });
    expect(lock.release).toHaveBeenCalledOnce();
  });

  it.each([[], ["--run", "--scope", "x"], ["--shell"], ["--once", "--run"]].map((args) => ({ args })))
  ("rejects arbitrary CLI arguments %#", ({ args }) => {
    expect(() => parseAdminConsumerArguments(args)).toThrow();
  });
  it("runtime check requires no database, credentials or real-provider opt-in", async () => {
    expect(await adminConsumerMain(["--check-runtime"])).toBe(0);
  });
  it("requires explicit STAGING and real-provider opt-ins for execution", () => {
    for (const env of [{}, { FOOTBALL_ADMIN_CONSUMER_STAGE: "production", FOOTBALL_ADMIN_CONSUMER_ENABLED: "true" },
      { FOOTBALL_ADMIN_CONSUMER_STAGE: "staging", FOOTBALL_ADMIN_CONSUMER_ENABLED: "true" }]) {
      expect(() => requireAdminConsumerOptIn(env)).toThrow();
    }
    expect(() => requireAdminConsumerOptIn({ FOOTBALL_ADMIN_CONSUMER_STAGE: "staging",
      FOOTBALL_ADMIN_CONSUMER_ENABLED: "true", API_FOOTBALL_ENABLE_REAL: "true", API_FOOTBALL_KEY: "fixture" })).not.toThrow();
  });
});
