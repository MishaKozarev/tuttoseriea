import { config } from "dotenv";
import { sql } from "drizzle-orm";

import { closeDbConnection, getDb } from "../src/db";

config({ path: ".env.local", quiet: true });
config({ path: ".env", quiet: true });

type SelectOneRow = {
  value: number;
};

type IdentityRow = {
  database: string;
  username: string;
};

type VersionRow = {
  versionNumber: string;
};

type PgVectorRow = {
  name: string;
  defaultVersion: string;
  installedVersion: string | null;
};

type CountRow = {
  count: number;
};

function firstRow<T>(rows: T[], label: string): T {
  const row = rows[0];

  if (!row) {
    throw new Error(`${label} returned no rows`);
  }

  return row;
}

function logError(error: unknown): void {
  if (error instanceof Error) {
    console.error(error.stack ?? error.message);

    const cause = (error as Error & { cause?: unknown }).cause;

    if (cause) {
      console.error("Cause:", cause);
    }

    return;
  }

  console.error(error);
}

async function main(): Promise<void> {
  const db = getDb();

  const selectOne = firstRow(
    (await db.execute(sql<SelectOneRow>`select 1::int as "value"`)).rows,
    "select 1",
  );

  if (selectOne.value !== 1) {
    throw new Error(`select 1 returned ${selectOne.value}`);
  }

  const identity = firstRow(
    (
      await db.execute(
        sql<IdentityRow>`select current_database() as "database", current_user as "username"`,
      )
    ).rows,
    "database identity check",
  );

  const version = firstRow(
    (
      await db.execute(
        sql<VersionRow>`select current_setting('server_version_num') as "versionNumber"`,
      )
    ).rows,
    "PostgreSQL version check",
  );
  const postgresMajor = Math.trunc(Number(version.versionNumber) / 10000);

  if (postgresMajor !== 18) {
    throw new Error(`Expected PostgreSQL major 18, got ${postgresMajor}`);
  }

  const pgvector = firstRow(
    (
      await db.execute(
        sql<PgVectorRow>`
          select
            name,
            default_version as "defaultVersion",
            installed_version as "installedVersion"
          from pg_available_extensions
          where name = 'vector'
        `,
      )
    ).rows,
    "pgvector availability check",
  );

  if (pgvector.defaultVersion !== "0.8.6") {
    throw new Error(`Expected pgvector 0.8.6, got ${pgvector.defaultVersion}`);
  }

  const vectorExtension = firstRow(
    (
      await db.execute(
        sql<CountRow>`select count(*)::int as "count" from pg_extension where extname = 'vector'`,
      )
    ).rows,
    "vector extension installation check",
  );

  if (vectorExtension.count !== 0) {
    throw new Error("vector extension is installed; Stage 2.2 must not create it");
  }

  console.log("Drizzle LOCAL database check passed.");
  console.log(`select_1=${selectOne.value}`);
  console.log(`current_database=${identity.database}`);
  console.log(`current_user=${identity.username}`);
  console.log(`postgres_major=${postgresMajor}`);
  console.log(`pgvector_available=${pgvector.defaultVersion}`);
  console.log("vector_extension_installed=false");
}

main()
  .finally(async () => {
    await closeDbConnection();
  })
  .catch((error: unknown) => {
    logError(error);
    process.exitCode = 1;
  });
