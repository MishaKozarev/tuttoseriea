import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";

const { Pool } = pg;

const appDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const migrationsFolder = path.join(appDirectory, "drizzle");
const migrationLockKeys = [910230201, 230000003];

async function loadLocalEnvFiles() {
  try {
    const { config } = await import("dotenv");

    config({ path: path.join(appDirectory, ".env.local"), quiet: true });
    config({ path: path.join(appDirectory, ".env"), quiet: true });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error) {
      if (error.code === "ERR_MODULE_NOT_FOUND") {
        return;
      }
    }

    throw error;
  }
}

function requireEnv(name) {
  const value = process.env[name];

  if (!value) {
    throw new Error(`${name} is required`);
  }

  return value;
}

function logError(error) {
  if (error instanceof Error) {
    console.error(error.stack ?? error.message);
    return;
  }

  console.error(error);
}

async function main() {
  await loadLocalEnvFiles();

  const migrationDatabaseUrl = requireEnv("MIGRATION_DATABASE_URL");
  const pool = new Pool({
    connectionString: migrationDatabaseUrl,
    max: 5,
  });
  const lockClient = await pool.connect();
  let lockAcquired = false;

  try {
    const lockResult = await lockClient.query(
      "select pg_try_advisory_lock($1, $2) as locked",
      migrationLockKeys,
    );

    lockAcquired = lockResult.rows[0]?.locked === true;

    if (!lockAcquired) {
      throw new Error("Another database migration process is already running");
    }

    const db = drizzle(pool);

    await migrate(db, {
      migrationsFolder,
      migrationsSchema: "drizzle",
      migrationsTable: "__drizzle_migrations",
    });

    console.log("Database migrations applied.");
  } finally {
    try {
      if (lockAcquired) {
        await lockClient.query("select pg_advisory_unlock($1, $2)", migrationLockKeys);
      }
    } finally {
      lockClient.release();
      await pool.end();
    }
  }
}

main().catch((error) => {
  logError(error);
  process.exitCode = 1;
});
