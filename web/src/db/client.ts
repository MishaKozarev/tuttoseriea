import "server-only";

import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as schema from "./schema";

type Database = ReturnType<typeof createDatabase>;

type DatabaseGlobals = typeof globalThis & {
  __tuttoserieaDbPool?: Pool;
  __tuttoserieaDb?: Database;
};

function requireDatabaseUrl(): string {
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required for server-side database access");
  }

  return databaseUrl;
}

function createDatabasePool(): Pool {
  return new Pool({
    connectionString: requireDatabaseUrl(),
  });
}

function createDatabase(pool: Pool) {
  return drizzle(pool, { schema });
}

function getDatabaseGlobals(): DatabaseGlobals {
  return globalThis as DatabaseGlobals;
}

export function getDbPool(): Pool {
  const globals = getDatabaseGlobals();

  if (!globals.__tuttoserieaDbPool) {
    globals.__tuttoserieaDbPool = createDatabasePool();
  }

  return globals.__tuttoserieaDbPool;
}

export function getDb(): Database {
  const globals = getDatabaseGlobals();

  if (!globals.__tuttoserieaDb) {
    globals.__tuttoserieaDb = createDatabase(getDbPool());
  }

  return globals.__tuttoserieaDb;
}

export async function closeDbConnection(): Promise<void> {
  const globals = getDatabaseGlobals();

  if (globals.__tuttoserieaDbPool) {
    await globals.__tuttoserieaDbPool.end();
  }

  globals.__tuttoserieaDbPool = undefined;
  globals.__tuttoserieaDb = undefined;
}
