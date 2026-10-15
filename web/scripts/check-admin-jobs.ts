import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { config as loadEnv } from "dotenv";
import pg from "pg";
import { ADMIN_JOB_TYPES, AdminJobRequestError, parseAdminJobCommand } from "../src/jobs/admin-contract";
import { AdminJobRepository } from "../src/jobs/admin-repository";
import { consumeAdminJob, runAdminConsumer } from "../src/jobs/admin-consumer";
import { getJobRunnerConfig, quoteIdentifier } from "../src/jobs/config";
import { MatchLifecycleRepository } from "../src/jobs/match-lifecycle-repository";
import { createJobRegistry, productionJobRegistry } from "../src/jobs/registry";
import { checkAdminDispatcherCoordination } from "./check-admin-dispatcher-coordination";

loadEnv({ path: ".env.local", quiet: true });
loadEnv({ path: ".env", quiet: true });

async function expectCode(operation: Promise<unknown>, code: string) {
  await assert.rejects(operation, (error: unknown) => error instanceof AdminJobRequestError && error.code === code);
}

// Football fixtures exist only in this transaction and are always rolled back.
async function checkMatchScope(pool: pg.Pool, repository: AdminJobRepository) {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const suffix = randomUUID();
    const competitionId = randomUUID();
    await client.query(`insert into football.competitions
      (id, provider, provider_competition_id, provider_name, slug)
      values ($1, 'api-football', 135, 'Admin check', $2) on conflict (provider, provider_competition_id) do nothing`,
    [competitionId, `admin-check-${suffix}`]);
    const competition = await client.query<{ id: string }>(
      "select id from football.competitions where provider = 'api-football' and provider_competition_id = 135");
    const seasons: string[] = [];
    for (const year of [2026, 2025]) {
      await client.query(`insert into football.seasons
        (id, competition_id, provider, provider_season_year, provider_current, display_label)
        values ($1,$2,'api-football',$3,false,'Admin check') on conflict (competition_id, provider, provider_season_year) do nothing`,
      [randomUUID(), competition.rows[0].id, year]);
      const season = await client.query<{ id: string }>(`select id from football.seasons
        where competition_id = $1 and provider = 'api-football' and provider_season_year = $2`, [competition.rows[0].id, year]);
      seasons.push(season.rows[0].id);
    }
    const clubs = [randomUUID(), randomUUID()];
    const base = 1_800_000_000 + Math.floor(Math.random() * 1_000_000);
    for (let i = 0; i < clubs.length; i++) {
      await client.query(`insert into football.clubs (id, provider, provider_club_id, provider_name, slug)
        values ($1,'api-football',$2,'Admin check',$3)`, [clubs[i], base + i, `admin-club-${suffix}-${i}`]);
    }
    const matches = [randomUUID(), randomUUID()];
    for (let i = 0; i < matches.length; i++) {
      for (const club of clubs) {
        await client.query("insert into football.season_clubs (season_id, club_id) values ($1,$2)", [seasons[i], club]);
      }
      await client.query(`insert into football.matches
        (id,provider,provider_fixture_id,slug,season_id,home_club_id,away_club_id,round,kickoff_at,
         status,polling_category,provider_status_short,provider_raw)
        values ($1,'api-football',$2,$3,$4,$5,$6,'Check','2026-10-01','scheduled','WATCH','NS','{}'::jsonb)`,
      [matches[i], base + i, `admin-match-${suffix}-${i}`, seasons[i], clubs[0], clubs[1]]);
    }
    for (const type of ADMIN_JOB_TYPES.slice(5)) {
      const scope = parseAdminJobCommand({ jobType: type, matchId: matches[0], requestKey: randomUUID(), confirmed: true });
      await repository.assertCurrentScope(scope, client);
      await expectCode(repository.assertCurrentScope({ ...scope, matchId: matches[1] }, client), "MATCH_OUTSIDE_CURRENT_SERIE_A");
    }
  } finally { await client.query("rollback"); client.release(); }
}

async function main() {
  const base = getJobRunnerConfig();
  const migrationUrl = process.env.MIGRATION_DATABASE_URL;
  if (!migrationUrl) throw new Error("MIGRATION_DATABASE_URL is required");
  for (const value of [base.databaseUrl, migrationUrl]) {
    const target = new URL(value);
    const local = target.port === "15432";
    const isolatedCi = process.env.CI === "true" && target.port === "5432" && target.pathname === "/tuttoseriea_ci";
    assert(["127.0.0.1", "localhost"].includes(target.hostname) && (local || isolatedCi),
      "Admin DB check requires LOCAL PostgreSQL or the isolated CI database");
  }
  const pool = new pg.Pool({ connectionString: migrationUrl, max: 3 });
  const runtimePool = new pg.Pool({ connectionString: base.databaseUrl, max: 1 });
  const schema = `admin_check_${randomUUID().replaceAll("-", "")}`;
  const quoted = quoteIdentifier(schema);
  const executions = `${quoted}.executions`;
  const requests = `${quoted}.admin_requests`;
  const config = { ...base, jobsSchema: schema };
  let repository = new AdminJobRepository(config);
  const actor = randomUUID();
  const otherActor = randomUUID();
  const users = [randomUUID(), randomUUID()];
  let schemaCreated = false;
  const command = (index = 0, requestKey: string = randomUUID()) => parseAdminJobCommand({
    jobType: ADMIN_JOB_TYPES[index], requestKey, confirmed: true,
  });
  const clear = async () => { await pool.query(`delete from ${requests}`); await pool.query(`delete from ${executions}`); };
  let calls = 0;
  let mode: "success" | "retry" | "lease_loss" = "success";
  const registry = createJobRegistry([...productionJobRegistry.values()].map((definition) => ({
    ...definition,
    handle: async (context) => {
      calls++;
      await context.heartbeat();
      await context.beforeProviderRequestAttempt!(); // Fake outbound attempt, no HTTP client.
      if (mode === "lease_loss") {
        await pool.query(`update ${executions} set claim_version = claim_version + 1 where id = $1`, [context.execution.id]);
        await context.heartbeat();
      }
      return mode === "retry" ? { status: "retry" as const, errorCode: "fixture_retry", message: "Fixture retry", retryDelaySeconds: 60 }
        : { status: "success" as const };
    },
  })));
  const tick = () => runAdminConsumer({ repository, config, registry, once: true });
  try {
    // Use the actual Drizzle DDL in an isolated fixture schema, never real canonical executions.
    const migrations = await readdir("drizzle");
    const foundation = migrations.find((name) => name.startsWith("0003_") && name.endsWith(".sql"));
    assert(foundation);
    const ddl = (await readFile(`drizzle/${foundation}`, "utf8")).replaceAll('"jobs"', quoted);
    await pool.query(ddl);
    schemaCreated = true;
    await pool.query((await readFile("drizzle/0017_parched_harpoon.sql", "utf8")).replaceAll('"jobs"', quoted));
    const role = (await runtimePool.query<{ current_user: string }>("select current_user")).rows[0].current_user;
    await pool.query(`grant usage on schema ${quoted} to ${quoteIdentifier(role)}`);
    await pool.query(`grant select, insert, update on ${executions} to ${quoteIdentifier(role)}`);
    await pool.query(`grant select, insert on ${requests} to ${quoteIdentifier(role)}`);
    for (let i = 0; i < users.length; i++) {
      await pool.query('insert into auth.users (id, email) values ($1,$2)', [users[i], `${users[i]}@admin-check.invalid`]);
      await pool.query('insert into identity.accounts (id, auth_user_id) values ($1,$2)', [i ? otherActor : actor, users[i]]);
    }
    await assert.rejects(runtimePool.query(`update ${requests} set correlation_id = 'forbidden' where false`), { code: "42501" });
    await assert.rejects(runtimePool.query(`delete from ${requests} where false`), { code: "42501" });
    await checkMatchScope(pool, repository);

    const first = command();
    const duplicates = await Promise.all([
      repository.admit(actor, first, "correlation", 3), repository.admit(actor, first, "duplicate", 3),
    ]);
    assert.equal(duplicates[0].requestId, duplicates[1].requestId);
    assert.equal(duplicates[0].executionId, duplicates[1].executionId);
    assert.equal((await repository.history())[0].actorAccountId, actor);
    await expectCode(repository.admit(actor, command(1, first.requestKey), "conflict", 3), "IDEMPOTENCY_CONFLICT");
    await expectCode(repository.admit(otherActor, command(1), "busy", 3), "ADMIN_JOB_BUSY");
    await tick();
    const view = await repository.get(duplicates[0].requestId);
    assert.equal(view?.execution.status, "succeeded");
    const terminalCalls = calls;
    await tick();
    assert.equal(calls, terminalCalls);
    assert.equal((await repository.admit(actor, first, "replay", 3)).executionId, duplicates[0].executionId);
    await expectCode(repository.admit(actor, command(), "cooldown", 3), "ADMIN_JOB_COOLDOWN");
    await pool.query(`update ${executions} set finished_at = now() - interval '301 seconds' where id = $1`, [duplicates[0].executionId]);
    const afterCooldown = await repository.admit(actor, command(), "after-cooldown", 3);
    assert.notEqual(afterCooldown.executionId, duplicates[0].executionId);
    await clear();

    const admissions = await Promise.allSettled([
      repository.admit(actor, command(), "race-a", 3), repository.admit(otherActor, command(1), "race-b", 3),
    ]);
    assert.equal(admissions.filter((value) => value.status === "fulfilled").length, 1);
    assert(admissions.some((value) => value.status === "rejected" && value.reason.code === "ADMIN_JOB_BUSY"));
    await clear();
    await assert.rejects(repository.admit(randomUUID(), command(), "invalid-actor", 3), { code: "23503" });
    assert.equal((await pool.query(`select * from ${executions}`)).rowCount, 0, "request failure must roll back execution creation");

    const timestampRequest = await repository.admit(actor, command(), "timestamp-fixture", 3);
    await pool.query(`update ${requests} set created_at = timestamp '2026-10-15 18:00:00' where id = $1`, [timestampRequest.requestId]);
    await pool.query(`update ${executions} set status = 'succeeded',
      available_at = timestamp '2026-10-15 18:00:01', started_at = timestamp '2026-10-15 18:00:02',
      finished_at = timestamp '2026-10-15 18:01:00', updated_at = timestamp '2026-10-15 18:01:01' where id = $1`,
    [timestampRequest.executionId]);
    for (const timezone of ["UTC", "Europe/Minsk"]) {
      const child = await promisify(execFile)(process.execPath, [resolve("node_modules/vitest/vitest.mjs"),
        "run", "tests/server/football-admin-job-timestamps.test.ts"], {
        windowsHide: true, timeout: 60_000,
        env: { ...process.env, TZ: timezone, DATABASE_JOBS_SCHEMA: schema,
          FOOTBALL_ADMIN_TIMESTAMP_CHECK: "true", FOOTBALL_ADMIN_TIMESTAMP_ACTOR: actor,
          FOOTBALL_ADMIN_TIMESTAMP_REQUEST_ID: timestampRequest.requestId },
      });
      process.stdout.write(child.stdout);
      console.log(`admin_jobs_repository_api_formatter_timezone=${timezone}:passed`);
    }
    await clear();

    const lifecycleScope = command();
    const parsed = productionJobRegistry.get(lifecycleScope.jobType)!.parseArguments([]);
    const preexisting = await repository.jobs.createOrGetActiveExecution({ type: lifecycleScope.jobType,
      ...parsed, payload: { ...parsed.payload, dispatcher: { phase: "active-poll" } }, maxAttempts: 3 });
    assert.equal(await repository.nextDue(), null, "unassociated execution selected by Admin consumer");
    const claimed = await repository.jobs.claimExecution(preexisting.id, "lifecycle-fixture", 60);
    assert(claimed);
    await expectCode(repository.admit(actor, lifecycleScope, "running", 3), "FOOTBALL_JOB_ALREADY_RUNNING");
    assert.equal((await repository.history()).length, 0, "running non-Admin execution was associated");
    await tick();
    assert.equal((await repository.jobs.getExecution(preexisting.id))?.claimedBy, "lifecycle-fixture");
    await repository.jobs.finalizeSuccess({ id: preexisting.id, runnerId: "lifecycle-fixture", claimVersion: claimed.claimVersion });
    await tick();
    assert.equal((await pool.query(`select * from ${executions}`)).rowCount, 1);
    const lock = await repository.tryAcquireConsumerLock();
    assert(lock);
    const second = new AdminJobRepository(config);
    const lifecycle = new MatchLifecycleRepository(config);
    try {
      assert.equal(await second.tryAcquireConsumerLock(), null);
      const independent = await lifecycle.tryAcquireLock();
      assert(independent, "Admin lock must not expand or seize the dispatcher lock");
      await independent.release();
    } finally { await lock.release(); await second.close(); await lifecycle.close(); }
    await clear();

    mode = "retry";
    const retry = await repository.admit(actor, command(), "retry", 3);
    await tick();
    assert.equal((await repository.jobs.getExecution(retry.executionId))?.attemptCount, 1);
    await repository.close();
    repository = new AdminJobRepository(config);
    assert.equal(await repository.nextDue(), null, "restart ignored scheduled retry availability");
    await pool.query(`update ${executions} set available_at = now() - interval '1 second' where id = $1`, [retry.executionId]);
    mode = "success";
    await tick();
    assert.equal((await repository.jobs.getExecution(retry.executionId))?.status, "succeeded");
    assert.equal((await repository.jobs.getExecution(retry.executionId))?.attemptCount, 2);
    await clear();

    mode = "lease_loss";
    const lost = await repository.admit(actor, command(), "lost", 3);
    let outcome: string | undefined;
    await runAdminConsumer({ repository, config, registry, once: true, onResult: (result) => { outcome = result.outcome.status; } });
    assert.equal(outcome, "lease_lost");
    assert.equal((await repository.jobs.getExecution(lost.executionId))?.status, "running");
    await pool.query(`update ${executions} set lease_expires_at = now() - interval '1 second' where id = $1`, [lost.executionId]);
    mode = "success";
    await tick();
    assert.equal((await repository.jobs.getExecution(lost.executionId))?.status, "succeeded");
    await clear();

    const exhausted = await repository.admit(actor, command(), "exhausted", 1);
    assert(await repository.jobs.claimExecution(exhausted.executionId, "crashed-fixture", 60, undefined, exhausted.requestId));
    await pool.query(`update ${executions} set lease_expires_at = now() - interval '1 second' where id = $1`, [exhausted.executionId]);
    const beforeExhausted = calls;
    await tick();
    await tick();
    assert.equal(calls, beforeExhausted);
    assert.equal((await repository.jobs.getExecution(exhausted.executionId))?.status, "failed");
    assert.equal((await pool.query(`select * from ${executions}`)).rowCount, 1);

    // An expired nonterminal execution remains associated until the consumer recovers it.
    const noWork = await consumeAdminJob({ repository, config, registry,
      lock: { assertHeld: async () => {}, release: async () => {} }, providerGate: async () => {} });
    assert.equal(noWork, null);

    await clear();
    mode = "retry";
    const continuous = await repository.admit(actor, command(), "continuous-retry", 3);
    const controller = new AbortController();
    let firstResult!: () => void;
    const firstTick = new Promise<void>((resolve) => { firstResult = resolve; });
    const timeout = setTimeout(() => controller.abort(), 5000);
    const running = runAdminConsumer({ repository, config, registry, signal: controller.signal,
      onResult: (result) => {
        firstResult();
        if (result.outcome.status === "success") controller.abort();
      },
    });
    try {
      await Promise.race([firstTick, running]);
      // Fast-forward only this fixture's scheduled retry, then prove the loop picks it up itself.
      await pool.query(`update ${executions} set available_at = now() + interval '100 milliseconds' where id = $1`, [continuous.executionId]);
      mode = "success";
      await running;
      assert.equal((await repository.jobs.getExecution(continuous.executionId))?.status, "succeeded");
      assert.equal((await repository.jobs.getExecution(continuous.executionId))?.attemptCount, 2);
    } finally {
      controller.abort();
      clearTimeout(timeout);
      await running;
    }
    await checkAdminDispatcherCoordination({ repository, config, pool, actor });
    console.log("admin_jobs_postgresql_check=passed");
    console.log("admin_jobs_atomic_dedup_admission_attribution=true");
    console.log("admin_jobs_cooldown_300_seconds=true");
    console.log("admin_jobs_current_serie_a_scope=true");
    console.log("admin_jobs_retry_restart_lease_fencing=true");
    console.log("admin_jobs_continuous_loop_resumes_due_retry=true");
    console.log("admin_jobs_terminal_no_replacement=true");
    console.log("admin_jobs_shared_execution_dispatcher_coordination=true");
    console.log("admin_jobs_consumer_singleton_distinct_from_dispatcher=true");
    console.log("admin_jobs_runtime_request_update_delete_denied=true");
    console.log("provider_requests=0");
  } finally {
    await repository.close();
    await runtimePool.end();
    if (schemaCreated) {
      // Only these two tables in the unique schema created above; no CASCADE/reset.
      await pool.query(`drop table if exists ${requests}`);
      await pool.query(`drop table if exists ${executions}`);
      await pool.query(`drop schema ${quoted}`);
    }
    await pool.query("delete from identity.accounts where id = any($1::text[])", [[actor, otherActor]]);
    await pool.query("delete from auth.users where id = any($1::text[])", [users]);
    await pool.end();
    console.log("admin_jobs_fixture_cleanup=complete");
  }
}

main().catch((error: unknown) => {
  console.error("Admin jobs PostgreSQL check failed; no provider requests were made");
  console.error(error instanceof Error ? error.message : "Unknown fixture check failure");
  process.exitCode = 1;
});
