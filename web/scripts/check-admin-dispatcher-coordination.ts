import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import type pg from "pg";

import { createApiFootballClient } from "../src/football/api-football/core-client";
import { SERIE_A_MATCHES_JOB_TYPE } from "../src/football/foundation";
import { parseAdminJobCommand } from "../src/jobs/admin-contract";
import { consumeAdminJob, createAdminProviderGate } from "../src/jobs/admin-consumer";
import { AdminJobRepository } from "../src/jobs/admin-repository";
import { quoteIdentifier, type JobRunnerConfig } from "../src/jobs/config";
import { createDispatcherJobRunner } from "../src/jobs/match-lifecycle-dispatcher";
import { createJobRegistry, productionJobRegistry } from "../src/jobs/registry";
import { JobRepository } from "../src/jobs/repository";
import { runJobOnce, type RunJobResult } from "../src/jobs/runner";
import type { JobDefinition } from "../src/jobs/types";

function latch() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

async function bounded<T>(promise: Promise<T>): Promise<T> {
  let timeout!: ReturnType<typeof setTimeout>;
  try {
    return await Promise.race([promise, new Promise<never>((_, reject) => {
      timeout = setTimeout(() => reject(new Error("Coordination fixture timed out")), 5000);
    })]);
  } finally { clearTimeout(timeout); }
}

async function waitForRowLock(pool: pg.Pool, schema: string, statement = "") {
  for (let i = 0; i < 200; i++) {
    const result = await pool.query(`select 1 from pg_stat_activity
      where pid <> pg_backend_pid() and wait_event_type = 'Lock' and position($1 in query) > 0
        and position($2 in query) > 0`, [schema, statement]);
    if (result.rowCount) return;
    await delay(10);
  }
  throw new Error("Expected concurrent runner to wait for the fixture row lock");
}

export async function checkAdminDispatcherCoordination(input: {
  repository: AdminJobRepository; config: JobRunnerConfig; pool: pg.Pool; actor: string;
}): Promise<void> {
  const { repository, config, pool, actor } = input;
  const schema = quoteIdentifier(config.jobsSchema);
  const executions = `${schema}.executions`;
  const requests = `${schema}.admin_requests`;
  const clear = async () => { await pool.query(`delete from ${requests}`); await pool.query(`delete from ${executions}`); };
  const type = SERIE_A_MATCHES_JOB_TYPE;
  const original = productionJobRegistry.get(type)!;
  const parsed = original.parseArguments([]);
  const command = () => parseAdminJobCommand({ jobType: type, requestKey: randomUUID(), confirmed: true });
  const dispatcher = createDispatcherJobRunner({ config, repository: repository.jobs });
  const starts: number[] = [];
  let handlerCalls = 0;
  let retryJob = false;
  let fetchEntered = latch();
  let fetchReleased = latch();
  let holdFetch = false;
  const definition: JobDefinition = { ...original, handle: async (context) => {
    handlerCalls++;
    let fetchCount = 0;
    const client = createApiFootballClient({
      config: { baseUrl: new URL("https://example.invalid/"), apiKey: "fixture-only", timeoutMs: 4000 },
      beforeRequestAttempt: context.beforeProviderRequestAttempt,
      jitter: () => 0,
      fetch: async () => {
        starts.push(performance.now());
        if (holdFetch && fetchCount === 0) {
          fetchEntered.resolve();
          await bounded(fetchReleased.promise);
        }
        fetchCount++;
        if (fetchCount === 1) return new Response("fixture transient error", { status: 503 });
        return Response.json({ get: "fixtures", parameters: {}, errors: [], results: 0,
          paging: { current: 1, total: 1 }, response: [] });
      },
    });
    assert((await client.get("/fixtures")).ok);
    return retryJob && context.execution.attemptCount === 1
      ? { status: "retry", errorCode: "fixture_job_retry", message: "Fixture retry", retryDelaySeconds: 60 }
      : { status: "success" };
  } };
  const registry = createJobRegistry([definition]);
  const mutableRegistry = productionJobRegistry as Map<string, JobDefinition>;
  const previousEnablement = process.env.FOOTBALL_ADMIN_CONSUMER_ENABLED;
  mutableRegistry.set(type, definition); // Real dispatcher runner, fake handler/provider only, restored below.
  process.env.FOOTBALL_ADMIN_CONSUMER_ENABLED = "false";
  try {
    await clear();
    holdFetch = true;
    const runningDispatcher = dispatcher(type, []);
    try {
      await bounded(fetchEntered.promise);
      await assert.rejects(repository.admit(actor, command(), "dispatcher-won-claim", 3),
        (error: unknown) => error instanceof Error && "code" in error && error.code === "FOOTBALL_JOB_ALREADY_RUNNING");
      assert.equal((await repository.history()).length, 0);
    } finally {
      fetchReleased.resolve();
      const completed = await runningDispatcher;
      assert.equal(completed.outcome.status, "success", "ordinary dispatcher behavior regressed");
      holdFetch = false;
    }
    await clear();

    // Admission must not recover any ordinary running row, even an exhausted lease.
    for (const [expired, maxAttempts, idBound] of [
      [false, 3, false], [true, 3, false], [true, 1, false], [true, 3, true], [true, 1, true],
    ] as const) {
      const execution = await repository.jobs.createOrGetActiveExecution({ type, ...parsed, maxAttempts });
      const claim = await repository.jobs.claimExecution(execution.id, "ordinary-crashed-fixture", 60);
      assert(claim);
      if (expired) await pool.query(`update ${executions} set lease_expires_at = now() - interval '1 second' where id = $1`, [execution.id]);
      const before = (await pool.query(`select to_jsonb(e) as row from ${executions} e where id = $1`, [execution.id])).rows[0].row;
      await assert.rejects(repository.admit(actor, command(), "running-before-recovery", 3),
        (error: unknown) => error instanceof Error && "code" in error && "status" in error &&
          error.code === "FOOTBALL_JOB_ALREADY_RUNNING" && error.status === 409);
      assert.deepEqual((await pool.query(`select to_jsonb(e) as row from ${executions} e where id = $1`, [execution.id])).rows[0].row,
        before, "Admin admission changed an ordinary running execution");
      assert.equal((await repository.history()).length, 0);
      if (expired) {
        const recovered = idBound
          ? await runJobOnce({ type, args: [], executionId: execution.id, config, registry, repository: repository.jobs })
          : await dispatcher(type, []);
        assert.equal(recovered.outcome.status, idBound && maxAttempts === 1 ? "no_op" : "success");
        assert("execution" in recovered.outcome);
        assert.equal(recovered.outcome.execution.id === execution.id, idBound || maxAttempts > 1);
        const previous = await repository.jobs.getExecution(execution.id);
        assert.equal(previous?.status, maxAttempts === 1 ? "failed" : "succeeded");
        if (maxAttempts > 1) {
          assert.equal(previous?.attemptCount, 2);
          assert.equal(previous?.claimVersion, claim.claimVersion + 1);
        }
        assert.equal(await repository.jobs.finalizeSuccess({ id: execution.id,
          runnerId: claim.claimedBy, claimVersion: claim.claimVersion }), null);
      }
      await clear();
    }
    console.log("admin_dispatcher_regression_running_active_expired_unchanged_409=true");
    console.log("admin_dispatcher_regression_ordinary_canonical_id_recovery_preserved=true");
    starts.length = 0;
    handlerCalls = 0;

    // Hold the actual admission after locking an existing pending row but before attribution.
    const pending = await repository.jobs.createOrGetActiveExecution({ type, ...parsed,
      payload: { ...parsed.payload, dispatcher: { phase: "active-poll" } }, maxAttempts: 3 });
    const admissionLocked = latch();
    const admissionReleased = latch();
    const originalCreate = repository.jobs.createOrGetActiveExecution.bind(repository.jobs);
    repository.jobs.createOrGetActiveExecution = async (...args) => {
      const execution = await originalCreate(...args);
      if (args[1]) { admissionLocked.resolve(); await bounded(admissionReleased.promise); }
      return execution;
    };
    const admitting = repository.admit(actor, command(), "admission-claim-race", 3);
    let racingDispatcher: Promise<RunJobResult> | undefined;
    try {
      await bounded(admissionLocked.promise);
      racingDispatcher = dispatcher(type, []);
      await waitForRowLock(pool, config.jobsSchema);
    } finally {
      admissionReleased.resolve();
      repository.jobs.createOrGetActiveExecution = originalCreate;
      await Promise.allSettled([admitting, ...(racingDispatcher ? [racingDispatcher] : [])]);
    }
    const admitted = await admitting;
    assert(racingDispatcher);
    const raced = await racingDispatcher;
    assert.equal(raced.outcome.status, "no_op");
    assert.equal("execution" in raced.outcome && raced.outcome.execution.id, pending.id);
    assert.equal(admitted.executionId, pending.id);
    assert.equal(handlerCalls, 0, "dispatcher bypassed the consumer while disabled");
    assert.equal((await repository.jobs.getExecution(pending.id))?.attemptCount, 0);
    assert((await repository.jobs.getExecution(pending.id))?.payload.dispatcher);

    // Neither a hook alone nor a request ID for a different request grants a claim.
    for (const adminRequestId of [undefined, randomUUID()]) {
      const denied = await runJobOnce({ type, args: [], executionId: pending.id, adminRequestId,
        config, registry, repository: repository.jobs, beforeProviderRequestAttempt: async () => {} });
      assert.equal(denied.outcome.status, "no_op");
    }

    const lock = await repository.tryAcquireConsumerLock();
    assert(lock);
    retryJob = true;
    holdFetch = true;
    fetchEntered = latch();
    fetchReleased = latch();
    const consuming = consumeAdminJob({ repository, config, registry, lock, providerGate: createAdminProviderGate() });
    let result: Awaited<typeof consuming>;
    try {
      await bounded(fetchEntered.promise);
      const competing = await dispatcher(type, []);
      assert.equal(competing.outcome.status, "no_op");
      assert.equal("execution" in competing.outcome && competing.outcome.execution.id, pending.id);
      assert.equal((await repository.jobs.getExecution(pending.id))?.attemptCount, 1);
    } finally {
      fetchReleased.resolve();
      result = await consuming;
      await lock.release();
      holdFetch = false;
    }
    assert.equal(result?.outcome.status, "retry_scheduled");
    assert.equal((await dispatcher(type, [])).outcome.status, "no_op");
    assert.equal((await repository.jobs.getExecution(pending.id))?.attemptCount, 1);
    await pool.query(`update ${executions} set available_at = now() - interval '1 second' where id = $1`, [pending.id]);
    assert.equal((await dispatcher(type, [])).outcome.status, "no_op", "dispatcher claimed a due Admin retry");

    const restarted = new AdminJobRepository(config);
    try {
      const restartLock = await restarted.tryAcquireConsumerLock();
      assert(restartLock);
      try {
        const resumed = await consumeAdminJob({ repository: restarted, config, registry,
          lock: restartLock, providerGate: createAdminProviderGate() });
        assert.equal(resumed?.outcome.status, "success");
        assert.equal(resumed && "execution" in resumed.outcome && resumed.outcome.execution.id, pending.id);
      } finally { await restartLock.release(); }
    } finally { await restarted.close(); }
    assert.equal(handlerCalls, 2);
    assert.equal(starts.length, 4, "HTTP retries were not exercised in both job attempts");
    const gaps = starts.slice(1).map((at, index) => at - starts[index]);
    assert(gaps.every((gap) => gap >= 500), `Admin provider attempt interval below 500ms: ${gaps}`);
    const replay = await runJobOnce({ type, args: [], executionId: pending.id, config, registry, repository: repository.jobs });
    assert.equal(replay.outcome.status, "no_op");
    assert.equal((await pool.query(`select * from ${executions}`)).rowCount, 1);
    console.log(`admin_dispatcher_regression_min_attempt_gap_ms=${Math.min(...gaps).toFixed(3)}`);

    for (const maxAttempts of [1, 3]) {
      await clear();
      const request = await repository.admit(actor, command(), "expired-admin", maxAttempts);
      const claim = await repository.jobs.claimExecution(request.executionId, "crashed-admin-fixture", 60, undefined, request.requestId);
      assert(claim);
      await pool.query(`update ${executions} set lease_expires_at = now() - interval '1 second' where id = $1`, [request.executionId]);
      const refused = await dispatcher(type, []);
      assert.equal(refused.outcome.status, "no_op");
      const unchanged = await repository.jobs.getExecution(request.executionId);
      assert.equal(unchanged?.status, "running", "ordinary runner recovered a protected expired lease");
      assert.equal(unchanged?.claimVersion, claim.claimVersion);
      const recoveryLock = await repository.tryAcquireConsumerLock();
      assert(recoveryLock);
      try {
        await consumeAdminJob({ repository, config, registry, lock: recoveryLock, providerGate: createAdminProviderGate() });
      } finally { await recoveryLock.release(); }
      assert.equal((await repository.jobs.getExecution(request.executionId))?.status, maxAttempts === 1 ? "failed" : "succeeded");
      assert.equal(await repository.jobs.finalizeSuccess({ id: request.executionId,
        runnerId: "crashed-admin-fixture", claimVersion: claim.claimVersion }), null);
      assert.equal((await pool.query(`select * from ${executions}`)).rowCount, 1);
    }

    // This runner has committed create-or-get before admission starts. Its claim
    // statement must wait on admission, then read the newly committed association.
    await clear();
    const ordinaryRepository = new JobRepository(config);
    const ordinaryCreated = latch();
    const claimReleased = latch();
    const attributionLocked = latch();
    const attributionReleased = latch();
    const claimOrdinary = ordinaryRepository.claimExecution.bind(ordinaryRepository);
    const createForAdmission = repository.jobs.createOrGetActiveExecution.bind(repository.jobs);
    ordinaryRepository.claimExecution = async (...args) => {
      ordinaryCreated.resolve();
      await bounded(claimReleased.promise);
      return claimOrdinary(...args);
    };
    repository.jobs.createOrGetActiveExecution = async (...args) => {
      const execution = await createForAdmission(...args);
      if (args[1]) { attributionLocked.resolve(); await bounded(attributionReleased.promise); }
      return execution;
    };
    const callsBeforeWait = handlerCalls;
    const waitingDispatcher = createDispatcherJobRunner({ config, repository: ordinaryRepository })(type, []);
    let attributing: ReturnType<typeof repository.admit> | undefined;
    try {
      await bounded(ordinaryCreated.promise);
      attributing = repository.admit(actor, command(), "claim-statement-snapshot-race", 3);
      await bounded(attributionLocked.promise);
      claimReleased.resolve();
      await waitForRowLock(pool, config.jobsSchema, "select id from");
    } finally {
      claimReleased.resolve();
      attributionReleased.resolve();
      repository.jobs.createOrGetActiveExecution = createForAdmission;
      await Promise.allSettled([waitingDispatcher, ...(attributing ? [attributing] : [])]);
      await ordinaryRepository.close();
    }
    assert(attributing);
    const associated = await attributing;
    const refusedClaim = await waitingDispatcher;
    assert.equal(refusedClaim.outcome.status, "no_op");
    assert.equal("execution" in refusedClaim.outcome && refusedClaim.outcome.execution.id, associated.executionId);
    const unchangedPending = await repository.jobs.getExecution(associated.executionId);
    assert.equal(unchangedPending?.status, "pending");
    assert.equal(unchangedPending?.attemptCount, 0);
    assert.equal(unchangedPending?.claimVersion, 0);
    assert.equal(handlerCalls, callsBeforeWait, "waiting ordinary claim bypassed Admin safeguards");
    console.log("admin_dispatcher_regression_claim_waits_for_attribution_commit=true");

    // Row-lock waiting must not consume the new owner's lease duration.
    await clear();
    const waiting = await repository.jobs.createOrGetActiveExecution({ type, ...parsed, maxAttempts: 3 });
    const blocker = await pool.connect();
    let waitedClaim: ReturnType<typeof repository.jobs.claimExecution> | undefined;
    let releasedAt: Date | undefined;
    try {
      await blocker.query("begin");
      await blocker.query(`select id from ${executions} where id = $1 for update`, [waiting.id]);
      waitedClaim = repository.jobs.claimExecution(waiting.id, "waited-fixture", 1);
      await waitForRowLock(pool, config.jobsSchema);
      await delay(1100);
    } finally {
      releasedAt = (await blocker.query<{ at: Date }>("select clock_timestamp() as at")).rows[0].at;
      await blocker.query("rollback");
      blocker.release();
      await waitedClaim;
    }
    assert(await waitedClaim);
    assert(releasedAt);
    assert.equal((await pool.query(`select lease_expires_at >= $2::timestamptz + interval '900 milliseconds' as valid
      from ${executions} where id = $1`, [waiting.id, releasedAt])).rows[0].valid, true);
    console.log("admin_dispatcher_regression_disabled_consumer_claim_denied=true");
    console.log("admin_dispatcher_regression_admission_claim_race=true");
    console.log("admin_dispatcher_regression_http_and_job_retries_same_id=true");
    console.log("admin_dispatcher_regression_expired_lease_no_replacement=true");
    console.log("admin_dispatcher_regression_waited_claim_full_lease=true");
  } finally {
    mutableRegistry.set(type, original);
    if (previousEnablement === undefined) delete process.env.FOOTBALL_ADMIN_CONSUMER_ENABLED;
    else process.env.FOOTBALL_ADMIN_CONSUMER_ENABLED = previousEnablement;
    await clear();
  }
}
