import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import pg from "pg";

const { Pool } = pg;

const appDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

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

  const pool = new Pool({
    connectionString: requireEnv("MIGRATION_DATABASE_URL"),
    max: 1,
  });

  try {
    const migrationTable = await pool.query(`
      select to_regclass('drizzle.__drizzle_migrations') as migration_table
    `);

    if (!migrationTable.rows[0]?.migration_table) {
      throw new Error("Drizzle migration table does not exist");
    }

    const migrationState = await pool.query(`
      select count(*)::int as migration_count
      from drizzle.__drizzle_migrations
    `);
    const migrationCount = migrationState.rows[0]?.migration_count;

    if (!Number.isInteger(migrationCount) || migrationCount < 1) {
      throw new Error("No Drizzle migrations are recorded");
    }

    const vectorExtension = await pool.query(`
      select extversion as installed_version
      from pg_extension
      where extname = 'vector'
    `);
    const installedVersion = vectorExtension.rows[0]?.installed_version;

    if (installedVersion !== "0.8.6") {
      throw new Error(`Expected installed vector extension 0.8.6, got ${installedVersion}`);
    }

    console.log("Drizzle migration state check passed.");
    console.log(`recorded_migrations=${migrationCount}`);
    console.log(`vector_extension_installed=${installedVersion}`);
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  logError(error);
  process.exitCode = 1;
});
