import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type pg from "pg";
import { setTimeout as delay } from "node:timers/promises";
import type { CoachQueryable } from "../src/football/coaches-repository";
import { getSerieACoachProfileIds, getStoredCoachProfile, upsertCoachProfile } from "../src/football/coach-profile-repository";
import { parseCoachProfile } from "../src/football/coach-profile";
import { coachProfileFixture } from "../tests/fixtures/coach-profile";
import { syncSerieACoaches } from "../src/football/serie-a-coaches-sync";
import type { ApiFootballClient, ApiFootballResult, ApiFootballRequestParameters } from "../src/football/api-football/node";
import { createJobRegistry } from "../src/jobs/registry";
import { fenceCoachProfileExecution, syncSerieACoachesJob } from "../src/jobs/football-sync";
import { JobRepository } from "../src/jobs/repository";
import { runJobOnce } from "../src/jobs/runner";
import type { ClaimedJobExecution } from "../src/jobs/types";

export async function checkCoachProfiles(input: { owner: pg.Pool; runtime: pg.Pool; scope: (db: CoachQueryable) => CoachQueryable }) {
  const { owner, runtime, scope } = input;
  const db = scope(runtime);
  const profile = (name: string) => parseCoachProfile(coachProfileFixture(2914, name), 2914);
  await upsertCoachProfile(db, profile("First API profile"), new Date("2026-10-20T11:00:00Z"));
  const id = (await db.query("select id from football.coaches where provider_coach_id=2914")).rows[0].id;
  await scope(owner).query("update football.coaches set name_ru='Reviewed profile',name_ru_review_status='reviewed',localization_revision=12 where id=$1", [id]);
  assert.equal(await upsertCoachProfile(db, profile("Older ignored"), new Date("2026-10-19T11:00:00Z")), false);
  const view = await getStoredCoachProfile(db, id); assert.equal(view?.providerName, "First API profile"); assert.equal(view?.career.length, 3);
  // Both lock orders: API update and a manual localization edit preserve each other's fields.
  for (const apiFirst of [true, false]) {
    const one = await runtime.connect(), two = await runtime.connect(); let waiting: Promise<unknown> | undefined;
    try {
      await one.query("begin"); await two.query("begin");
      const at = new Date(apiFirst ? "2026-10-21T11:00:00Z" : "2026-10-22T11:00:00Z");
      const writeName = async (client: pg.PoolClient) => scope(client).query(`update football.coaches set
        name_ru='Concurrent manual',name_ru_review_status='unreviewed',localization_revision=localization_revision+1 where id=$1`, [id]);
      if (apiFirst) await upsertCoachProfile(scope(one), profile("API wins facts only"), at);
      else await writeName(one);
      const pid = (await two.query("select pg_backend_pid() as pid")).rows[0].pid;
      waiting = apiFirst ? writeName(two) : upsertCoachProfile(scope(two), profile("API wins facts only"), at);
      const deadline = Date.now() + 5000; let locked = false;
      while (Date.now() < deadline && !locked) {
        locked = (await owner.query("select wait_event_type='Lock' as locked from pg_stat_activity where pid=$1", [pid])).rows[0]?.locked;
        if (!locked) await delay(15);
      }
      assert(locked, "Profile/localization writers must contend on a real PostgreSQL row lock");
      await one.query("commit"); await waiting; await two.query("commit");
      const row = (await db.query("select provider_name,name_ru,name_ru_review_status,localization_revision from football.coaches where id=$1", [id])).rows[0];
      assert.equal(row.provider_name, "API wins facts only"); assert.equal(row.name_ru, "Concurrent manual");
      assert.equal(row.name_ru_review_status, "unreviewed"); assert.equal(row.localization_revision, apiFirst ? 13 : 14);
    } finally { await one.query("rollback"); await two.query("rollback"); await waiting; one.release(); two.release(); }
  }
  // A delayed older request waits for the newer commit, then its ON CONFLICT predicate rejects it.
  const latest = await runtime.connect(), stale = await runtime.connect(); let staleWrite: Promise<boolean> | undefined;
  try {
    await latest.query("begin"); await stale.query("begin");
    await upsertCoachProfile(scope(latest), profile("Newest profile"), new Date("2026-10-24T11:00:00Z"));
    const pid = (await stale.query("select pg_backend_pid() as pid")).rows[0].pid;
    staleWrite = upsertCoachProfile(scope(stale), profile("Delayed old profile"), new Date("2026-10-23T11:00:00Z"));
    const deadline = Date.now() + 5000; let locked = false;
    while (Date.now() < deadline && !locked) {
      locked = (await owner.query("select wait_event_type='Lock' as locked from pg_stat_activity where pid=$1", [pid])).rows[0]?.locked;
      if (!locked) await delay(15);
    }
    assert(locked); await latest.query("commit"); assert.equal(await staleWrite, false); await stale.query("commit");
    assert.equal((await getStoredCoachProfile(db, id))?.providerName, "Newest profile");
  } finally { await latest.query("rollback"); await stale.query("rollback"); await staleWrite; latest.release(); stale.release(); }

  const jobsSchema = `coach_jobs_${randomUUID().replaceAll("-", "")}`, qJobs = `"${jobsSchema}"`;
  const role = (await runtime.query("select current_user")).rows[0].current_user.replaceAll('"', '""');
  let repository: JobRepository | undefined;
  try {
    await owner.query(`create schema ${qJobs}; create table ${qJobs}.executions(like jobs.executions including all);
      create table ${qJobs}.admin_requests(like jobs.admin_requests including all);
      grant usage on schema ${qJobs} to "${role}";
      grant select,insert,update on ${qJobs}.executions to "${role}";
      grant select,insert on ${qJobs}.admin_requests to "${role}"`);
    const ids = await getSerieACoachProfileIds(db);
    assert(ids.length > 1); assert.equal(new Set(ids).size, ids.length);
    const localization = (await db.query("select id,provider_coach_id,name_ru,name_ru_review_status,localization_revision from football.coaches order by id")).rows;
    const snapshots = (await db.query("select to_jsonb(l) as value from football.match_lineups l order by id")).rows;
    let calls = 0, retry = true, captured: ClaimedJobExecution | undefined;
    const fake: ApiFootballClient = { getRequestAttemptCount: () => calls, async get<T>(path: string, parameters?: ApiFootballRequestParameters) {
      assert.equal(path, "/coachs"); assert.deepEqual(Object.keys(parameters!), ["id"]); calls++;
      const providerId = parameters!.id as number;
      if (retry && calls === 2) return { ok: false, error: { code: "http_rate_limited", message: "Fake rate limit", retryable: true, attempts: 1 } };
      return { ok: true, data: [coachProfileFixture(providerId)], results: 1, paging: { current: 1, total: 1 }, operation: "coachs", attempts: 1 } as ApiFootballResult<T>;
    } };
    const pool = { query: db.query, connect: async () => { const client = await runtime.connect();
      return { query: scope(client).query, release: () => client.release() }; } } as unknown as pg.Pool;
    const registry = createJobRegistry([{ ...syncSerieACoachesJob, handle: context => {
      captured = context.execution;
      return syncSerieACoaches({ client: fake, pool, heartbeat: context.heartbeat,
        fence: transaction => fenceCoachProfileExecution(transaction, context.execution, jobsSchema) });
    } }]);
    const config = { databaseUrl: process.env.DATABASE_URL!, jobsSchema, leaseSeconds: 60, maxAttempts: 3,
      retryDelaySeconds: 1, retryDelayCapSeconds: 1 };
    repository = new JobRepository(config);
    const command = { type: syncSerieACoachesJob.type, args: [], registry, config, repository };
    const first = await runJobOnce(command); assert.equal(first.outcome.status, "retry_scheduled");
    const executionId = "execution" in first.outcome ? first.outcome.execution.id : assert.fail();
    const firstClaim = captured!;
    await owner.query(`update ${qJobs}.executions set available_at=clock_timestamp() where id=$1`, [executionId]);
    retry = false;
    const second = await runJobOnce({ ...command, executionId }); assert.equal(second.outcome.status, "success");
    assert("execution" in second.outcome); assert.equal(second.outcome.execution.id, executionId);
    assert.equal(second.outcome.execution.attemptCount, 2); assert.equal(second.outcome.execution.claimVersion, 2);
    const completedCalls = calls;
    assert.equal((await runJobOnce({ ...command, executionId })).outcome.status, "no_op"); assert.equal(calls, completedCalls);
    await assert.rejects(fenceCoachProfileExecution(runtime, firstClaim, jobsSchema), /lease ownership/);
    // A new fixture execution proves each fence predicate and natural lease expiry while a
    // competing recovery waits on the very same PostgreSQL execution row lock.
    const parsed = syncSerieACoachesJob.parseArguments([]);
    const next = await repository.createOrGetActiveExecution({ type: syncSerieACoachesJob.type, ...parsed, maxAttempts: 3 });
    const claimed = await repository.claimExecution(next.id, "fixture-profile-writer", 60); assert(claimed);
    await assert.rejects(fenceCoachProfileExecution(runtime, { ...claimed, claimVersion: claimed.claimVersion - 1 }, jobsSchema), /lease ownership/);
    await assert.rejects(fenceCoachProfileExecution(runtime, { ...claimed, claimedBy: "other-worker" }, jobsSchema), /lease ownership/);
    const writer = await runtime.connect(); let recovery: Promise<unknown> | undefined;
    const unchanged = (await db.query("select to_jsonb(c) as value from football.coaches c where id=$1", [id])).rows[0].value;
    try {
      await owner.query(`update ${qJobs}.executions set lease_expires_at=clock_timestamp()+interval '1 second' where id=$1`, [claimed.id]);
      await writer.query("begin"); await fenceCoachProfileExecution(writer, claimed, jobsSchema);
      assert(await upsertCoachProfile(scope(writer), profile("Must roll back on lease expiry"), new Date("2026-10-25T12:00:00Z")));
      recovery = repository.recoverExpiredExecution(claimed.id, { type: syncSerieACoachesJob.type, idempotencyKey: parsed.idempotencyKey });
      const deadline = Date.now() + 5000; let blocked = false;
      while (!blocked && Date.now() < deadline) {
        blocked = (await owner.query("select exists(select 1 from pg_stat_activity where wait_event_type='Lock' and query like $1) as blocked", [`%${jobsSchema}%`])).rows[0].blocked;
        if (!blocked) await delay(15);
      }
      assert(blocked, "Recovery must wait for the profile execution fence row lock");
      await delay(1100);
      await assert.rejects(fenceCoachProfileExecution(writer, claimed, jobsSchema), /lease ownership/);
      await writer.query("rollback"); await recovery;
      assert.deepEqual((await db.query("select to_jsonb(c) as value from football.coaches c where id=$1", [id])).rows[0].value, unchanged);
      const reclaimed = await repository.claimExecution(claimed.id, "fixture-after-restart", 60); assert(reclaimed);
      assert.equal(reclaimed.claimVersion, claimed.claimVersion + 1);
      await assert.rejects(fenceCoachProfileExecution(runtime, claimed, jobsSchema), /lease ownership/);
      await fenceCoachProfileExecution(runtime, reclaimed, jobsSchema);
    } finally { await writer.query("rollback"); await recovery; writer.release(); }
    const after = (await db.query("select id,provider_coach_id,name_ru,name_ru_review_status,localization_revision from football.coaches order by id")).rows;
    for (const before of localization) assert.deepEqual(after.find(row => row.id === before.id), before);
    assert.deepEqual((await db.query("select to_jsonb(l) as value from football.match_lineups l order by id")).rows, snapshots);
    assert.equal((await db.query("select count(*)::int as n from football.coaches where provider_coach_id=any($1) and profile_observed_at is null", [ids])).rows[0].n, 0);
    console.log("coach_profiles_postgresql_lock_orders_stale_request_fencing_retry_restart_execution_id_terminal_replay=passed");
  } finally { await repository?.close(); await owner.query(`drop schema if exists ${qJobs} cascade`); }
}
