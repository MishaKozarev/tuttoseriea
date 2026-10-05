import { config as loadEnv } from "dotenv";
import pg from "pg";

import { getJobRunnerConfig } from "../src/jobs/config";
import { MatchLifecycleRepository } from "../src/jobs/match-lifecycle-repository";

const { Pool } = pg;

loadEnv({ path: ".env.local", quiet: true });
loadEnv({ path: ".env", quiet: true });

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`${name} is required`);
  }

  return value;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

async function main(): Promise<void> {
  const jobConfig = getJobRunnerConfig();
  const first = new MatchLifecycleRepository(jobConfig);
  const second = new MatchLifecycleRepository(jobConfig);
  const migrationPool = new Pool({
    connectionString: requireEnv("MIGRATION_DATABASE_URL"),
    max: 1,
  });

  try {
    const column = await migrationPool.query<{
      is_nullable: string;
      column_default: string | null;
    }>(`
      select is_nullable, column_default
      from information_schema.columns
      where table_schema = 'football'
        and table_name = 'matches'
        and column_name = 'status_changed_at'
    `);

    assert(column.rows.length === 1, "football.matches.status_changed_at is missing");
    assert(
      column.rows[0]?.is_nullable === "YES" &&
        column.rows[0].column_default === null,
      "status_changed_at must remain nullable without a database default",
    );

    const firstLock = await first.tryAcquireLock();
    assert(firstLock, "first dispatcher repository did not acquire the advisory lock");

    try {
      assert(
        (await second.tryAcquireLock()) === null,
        "overlapping dispatcher repository acquired the singleton lock",
      );
    } finally {
      await firstLock.release();
    }

    const secondLock = await second.tryAcquireLock();
    assert(secondLock, "dispatcher advisory lock was not released with its session");
    await secondLock.release();

    await first.listCurrentSerieAMatches();
    await first.listLifecycleExecutions();
    await first.listMatchExecutions(new Date("2026-01-01T00:00:00.000Z"));

    console.log("match_lifecycle_status_changed_at_nullable=true");
    console.log("match_lifecycle_status_changed_at_default=none");
    console.log("match_lifecycle_advisory_lock_singleton=true");
    console.log("match_lifecycle_fixed_repository_reads=true");
  } finally {
    await Promise.all([first.close(), second.close(), migrationPool.end()]);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? (error.stack ?? error.message) : error);
  process.exitCode = 1;
});
