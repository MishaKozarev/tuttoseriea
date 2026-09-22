import "server-only";

import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import { getDatabaseUrl } from "@/src/config/runtime";

import * as schema from "./schema";

type Database = ReturnType<typeof createDatabase>;

type DatabaseGlobals = typeof globalThis & {
  __tuttoserieaDbPool?: Pool;
  __tuttoserieaDb?: Database;
};

function createDatabasePool(): Pool {
  return new Pool({
    connectionString: getDatabaseUrl(),
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
