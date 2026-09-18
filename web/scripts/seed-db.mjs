import crypto from "node:crypto";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";

import { seedModules } from "./seed/modules.mjs";

const { Pool } = pg;

const appDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const seedLockKeys = [910230201, 230000005];
const identifierPattern = /^[A-Za-z_][A-Za-z0-9_]*$/;

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

function parseSchemaList(value) {
  const schemas = value
    .split(",")
    .map((schema) => schema.trim())
    .filter(Boolean);

  if (schemas.length === 0) {
    throw new Error("At least one seed schema must be configured");
  }

  return schemas;
}

function assertIdentifier(value, label) {
  if (!identifierPattern.test(value)) {
    throw new Error(`${label} must be an unquoted PostgreSQL identifier`);
  }
}

function quoteIdentifier(value) {
  return `"${value.replaceAll('"', '""')}"`;
}

function logError(error) {
  if (error instanceof Error) {
    console.error(error.stack ?? error.message);
    return;
  }

  console.error(error);
}

function postgresErrorCode(error) {
  if (!error || typeof error !== "object") {
    return undefined;
  }

  const code = error.code;

  if (typeof code === "string") {
    return code;
  }

  return postgresErrorCode(error.cause);
}

function canonicalize(value) {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalize(value[key])]),
    );
  }

  return value;
}

async function queryRows(client, query) {
  const result = await client.query(query);
  return result.rows;
}

async function getSchemaSnapshot(client) {
  const userSchemaPredicate = `
    n.nspname <> 'information_schema'
    and n.nspname !~ '^pg_'
  `;

  return {
    extensions: await queryRows(
      client,
      `
        select extname as name, extversion as version
        from pg_extension
        where extname <> 'plpgsql'
        order by extname
      `,
    ),
    schemas: await queryRows(
      client,
      `
        select nspname as schema_name
        from pg_namespace
        where nspname <> 'information_schema'
          and nspname !~ '^pg_'
        order by nspname
      `,
    ),
    relations: await queryRows(
      client,
      `
        select
          n.nspname as schema_name,
          c.relname as relation_name,
          c.relkind as relation_kind,
          c.relpersistence as persistence
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
        where ${userSchemaPredicate}
          and c.relkind in ('r', 'p', 'v', 'm', 'f', 'S')
        order by n.nspname, c.relname, c.relkind
      `,
    ),
    columns: await queryRows(
      client,
      `
        select
          n.nspname as schema_name,
          c.relname as relation_name,
          a.attnum as ordinal_position,
          a.attname as column_name,
          format_type(a.atttypid, a.atttypmod) as data_type,
          a.attnotnull as not_null,
          coalesce(pg_get_expr(ad.adbin, ad.adrelid), '') as default_expression,
          a.attidentity as identity_kind,
          a.attgenerated as generated_kind
        from pg_attribute a
        join pg_class c on c.oid = a.attrelid
        join pg_namespace n on n.oid = c.relnamespace
        left join pg_attrdef ad on ad.adrelid = a.attrelid and ad.adnum = a.attnum
        where ${userSchemaPredicate}
          and c.relkind in ('r', 'p', 'v', 'm', 'f')
          and a.attnum > 0
          and not a.attisdropped
        order by n.nspname, c.relname, a.attnum
      `,
    ),
    constraints: await queryRows(
      client,
      `
        select
          n.nspname as schema_name,
          c.relname as relation_name,
          con.conname as constraint_name,
          con.contype as constraint_type,
          pg_get_constraintdef(con.oid, true) as definition
        from pg_constraint con
        join pg_class c on c.oid = con.conrelid
        join pg_namespace n on n.oid = con.connamespace
        where ${userSchemaPredicate}
        order by n.nspname, c.relname, con.conname
      `,
    ),
    indexes: await queryRows(
      client,
      `
        select
          schemaname as schema_name,
          tablename as table_name,
          indexname as index_name,
          indexdef as definition
        from pg_indexes
        where schemaname <> 'information_schema'
          and schemaname !~ '^pg_'
        order by schemaname, tablename, indexname
      `,
    ),
    sequences: await queryRows(
      client,
      `
        select
          schemaname as schema_name,
          sequencename as sequence_name,
          data_type,
          start_value,
          min_value,
          max_value,
          increment_by,
          cycle
        from pg_sequences
        where schemaname <> 'information_schema'
          and schemaname !~ '^pg_'
        order by schemaname, sequencename
      `,
    ),
    enum_and_domain_types: await queryRows(
      client,
      `
        select
          n.nspname as schema_name,
          t.typname as type_name,
          t.typtype as type_kind,
          t.typcategory as type_category
        from pg_type t
        join pg_namespace n on n.oid = t.typnamespace
        where ${userSchemaPredicate}
          and t.typtype in ('e', 'd')
        order by n.nspname, t.typname
      `,
    ),
    functions: await queryRows(
      client,
      `
        select
          n.nspname as schema_name,
          p.proname as function_name,
          pg_get_function_identity_arguments(p.oid) as identity_arguments,
          pg_get_function_result(p.oid) as result_type,
          p.prokind as function_kind,
          p.provolatile as volatility,
          l.lanname as language
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
        join pg_language l on l.oid = p.prolang
        where ${userSchemaPredicate}
        order by n.nspname, p.proname, identity_arguments
      `,
    ),
    policies: await queryRows(
      client,
      `
        select
          schemaname as schema_name,
          tablename as table_name,
          policyname as policy_name,
          permissive,
          roles,
          cmd,
          qual,
          with_check
        from pg_policies
        where schemaname <> 'information_schema'
          and schemaname !~ '^pg_'
        order by schemaname, tablename, policyname
      `,
    ),
  };
}

async function createSchemaFingerprint(client) {
  const snapshot = await getSchemaSnapshot(client);
  const payload = JSON.stringify(canonicalize(snapshot));

  return crypto.createHash("sha256").update(payload).digest("hex");
}

async function assertDdlDenied(client, schema) {
  const probeTable = "__tuttoseriea_seed_ddl_probe";
  let probeCreated = false;

  try {
    await client.query(
      `create table ${quoteIdentifier(schema)}.${quoteIdentifier(probeTable)} (id integer)`,
    );
    probeCreated = true;
  } catch (error) {
    if (postgresErrorCode(error) === "42501") {
      return;
    }

    throw error;
  } finally {
    if (probeCreated) {
      await client.query(
        `drop table if exists ${quoteIdentifier(schema)}.${quoteIdentifier(probeTable)}`,
      );
    }
  }

  throw new Error("Seed database role can create schema objects");
}

function validateSeedModules() {
  if (!Array.isArray(seedModules)) {
    throw new Error("Seed registry must export seedModules as an array");
  }

  const names = new Set();

  for (const seedModule of seedModules) {
    if (!seedModule || typeof seedModule !== "object") {
      throw new Error("Seed module entries must be objects");
    }

    if (typeof seedModule.name !== "string" || seedModule.name.length === 0) {
      throw new Error("Seed module entries must define a non-empty name");
    }

    if (names.has(seedModule.name)) {
      throw new Error(`Duplicate seed module name: ${seedModule.name}`);
    }

    names.add(seedModule.name);

    if (typeof seedModule.run !== "function") {
      throw new Error(`Seed module ${seedModule.name} must define a run function`);
    }
  }
}

async function runSeed(client) {
  validateSeedModules();

  const fingerprintBefore = await createSchemaFingerprint(client);
  const db = drizzle(client);
  let transactionStarted = false;

  try {
    await client.query("begin");
    transactionStarted = true;

    for (const seedModule of seedModules) {
      await seedModule.run({ db, client });
    }

    const fingerprintAfter = await createSchemaFingerprint(client);

    if (fingerprintBefore !== fingerprintAfter) {
      throw new Error("Seed changed PostgreSQL schema state");
    }

    await client.query("commit");
    transactionStarted = false;

    console.log("Database seed completed.");
    console.log(`seed_modules=${seedModules.length}`);
    console.log("schema_changed=false");
  } finally {
    if (transactionStarted) {
      await client.query("rollback");
    }
  }
}

async function main() {
  await loadLocalEnvFiles();

  const seedDatabaseUrl = requireEnv("SEED_DATABASE_URL");
  const seedSchemas = parseSchemaList(process.env.DATABASE_SEED_SCHEMAS ?? "public");

  for (const schema of seedSchemas) {
    assertIdentifier(schema, "DATABASE_SEED_SCHEMAS entry");
  }

  const pool = new Pool({ connectionString: seedDatabaseUrl, max: 1 });
  const client = await pool.connect();
  let lockAcquired = false;

  try {
    const command = process.argv[2];

    if (command === "--schema-fingerprint") {
      console.log(await createSchemaFingerprint(client));
      return;
    }

    if (command === "--check-ddl-denied") {
      await assertDdlDenied(client, seedSchemas[0]);
      console.log("Seed role DDL denial check passed.");
      console.log(`schema=${seedSchemas[0]}`);
      console.log("seed_role_ddl_denied=true");
      return;
    }

    if (command) {
      throw new Error(`Unknown seed command: ${command}`);
    }

    const lockResult = await client.query(
      "select pg_try_advisory_lock($1, $2) as locked",
      seedLockKeys,
    );

    lockAcquired = lockResult.rows[0]?.locked === true;

    if (!lockAcquired) {
      throw new Error("Another database seed process is already running");
    }

    await runSeed(client);
  } finally {
    try {
      if (lockAcquired) {
        await client.query("select pg_advisory_unlock($1, $2)", seedLockKeys);
      }
    } finally {
      client.release();
      await pool.end();
    }
  }
}

main().catch((error) => {
  logError(error);
  process.exitCode = 1;
});
