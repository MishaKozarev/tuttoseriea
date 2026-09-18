import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import pg from "pg";

const { Pool } = pg;

const appDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const provisionLockKeys = [910230201, 230000004];
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
  return value
    .split(",")
    .map((schema) => schema.trim())
    .filter(Boolean);
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

async function formatSql(client, template, values) {
  const placeholders = values.map((_, index) => `$${index + 2}::text`).join(", ");
  const query = placeholders
    ? `select format($1, ${placeholders}) as statement`
    : "select format($1) as statement";
  const result = await client.query(query, [template, ...values]);
  const statement = result.rows[0]?.statement;

  if (typeof statement !== "string" || !statement) {
    throw new Error("Failed to format SQL statement");
  }

  return statement;
}

async function main() {
  await loadLocalEnvFiles();

  const migrationDatabaseUrl = requireEnv("MIGRATION_DATABASE_URL");
  const appRole = requireEnv("DATABASE_APP_ROLE");
  const appPassword = requireEnv("DATABASE_APP_PASSWORD");
  const appSchemas = parseSchemaList(process.env.DATABASE_APP_SCHEMAS ?? "public");

  assertIdentifier(appRole, "DATABASE_APP_ROLE");

  for (const schema of appSchemas) {
    assertIdentifier(schema, "DATABASE_APP_SCHEMAS entry");
  }

  const pool = new Pool({ connectionString: migrationDatabaseUrl, max: 1 });
  const client = await pool.connect();
  let lockAcquired = false;
  let transactionStarted = false;

  try {
    const lockResult = await client.query(
      "select pg_try_advisory_lock($1, $2) as locked",
      provisionLockKeys,
    );

    lockAcquired = lockResult.rows[0]?.locked === true;

    if (!lockAcquired) {
      throw new Error("Another database role provisioning process is already running");
    }

    await client.query("begin");
    transactionStarted = true;

    const identity = await client.query(
      "select current_database() as database_name, current_user as migration_role",
    );
    const databaseName = identity.rows[0]?.database_name;
    const migrationRole = identity.rows[0]?.migration_role;

    if (!databaseName || !migrationRole) {
      throw new Error("Could not determine migration database identity");
    }

    const existingRole = await client.query("select 1 from pg_roles where rolname = $1", [
      appRole,
    ]);

    if (existingRole.rowCount === 0) {
      const createRoleSql = await formatSql(
        client,
        "create role %I with login nosuperuser nocreatedb nocreaterole noreplication nobypassrls password %L",
        [appRole, appPassword],
      );

      await client.query(createRoleSql);
    } else {
      const alterRoleSql = await formatSql(
        client,
        "alter role %I with login nosuperuser nocreatedb nocreaterole noreplication nobypassrls password %L",
        [appRole, appPassword],
      );

      await client.query(alterRoleSql);
    }

    await client.query(
      `grant connect on database ${quoteIdentifier(databaseName)} to ${quoteIdentifier(appRole)}`,
    );

    for (const schema of appSchemas) {
      await client.query(`revoke create on schema ${quoteIdentifier(schema)} from public`);
      await client.query(
        `revoke create on schema ${quoteIdentifier(schema)} from ${quoteIdentifier(appRole)}`,
      );
      await client.query(
        `revoke all privileges on all tables in schema ${quoteIdentifier(schema)} from ${quoteIdentifier(appRole)}`,
      );
      await client.query(
        `revoke all privileges on all sequences in schema ${quoteIdentifier(schema)} from ${quoteIdentifier(appRole)}`,
      );
      await client.query(
        `alter default privileges for role ${quoteIdentifier(migrationRole)} in schema ${quoteIdentifier(schema)} revoke all privileges on tables from ${quoteIdentifier(appRole)}`,
      );
      await client.query(
        `alter default privileges for role ${quoteIdentifier(migrationRole)} in schema ${quoteIdentifier(schema)} revoke all privileges on sequences from ${quoteIdentifier(appRole)}`,
      );
      await client.query(
        `grant usage on schema ${quoteIdentifier(schema)} to ${quoteIdentifier(appRole)}`,
      );
    }

    const roleResult = await client.query(
      `
        select
          rolcanlogin,
          rolsuper,
          rolcreatedb,
          rolcreaterole,
          rolreplication,
          rolbypassrls
        from pg_roles
        where rolname = $1
      `,
      [appRole],
    );
    const role = roleResult.rows[0];

    if (!role) {
      throw new Error("Application database role was not created");
    }

    if (
      role.rolcanlogin !== true ||
      role.rolsuper !== false ||
      role.rolcreatedb !== false ||
      role.rolcreaterole !== false ||
      role.rolreplication !== false ||
      role.rolbypassrls !== false
    ) {
      throw new Error("Application database role does not have the expected restricted attributes");
    }

    for (const schema of appSchemas) {
      const privileges = await client.query(
        `
          select
            has_schema_privilege($1, $2, 'USAGE') as can_use_schema,
            has_schema_privilege($1, $2, 'CREATE') as can_create_in_schema
        `,
        [appRole, schema],
      );
      const row = privileges.rows[0];

      if (row?.can_use_schema !== true) {
        throw new Error(`Application database role cannot use schema ${schema}`);
      }

      if (row?.can_create_in_schema !== false) {
        throw new Error(`Application database role can create objects in schema ${schema}`);
      }

      const tablePrivileges = await client.query(
        `
          select count(*)::int as privilege_count
          from pg_class c
          join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = $1
            and c.relkind in ('r', 'p', 'v', 'm', 'f')
            and (
              has_table_privilege($2, c.oid, 'SELECT')
              or has_table_privilege($2, c.oid, 'INSERT')
              or has_table_privilege($2, c.oid, 'UPDATE')
              or has_table_privilege($2, c.oid, 'DELETE')
            )
        `,
        [schema, appRole],
      );

      if (tablePrivileges.rows[0]?.privilege_count !== 0) {
        throw new Error(`Application database role has table DML privileges in schema ${schema}`);
      }

      const sequencePrivileges = await client.query(
        `
          select count(*)::int as privilege_count
          from pg_class c
          join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = $1
            and c.relkind = 'S'
            and (
              has_sequence_privilege($2, c.oid, 'USAGE')
              or has_sequence_privilege($2, c.oid, 'SELECT')
              or has_sequence_privilege($2, c.oid, 'UPDATE')
            )
        `,
        [schema, appRole],
      );

      if (sequencePrivileges.rows[0]?.privilege_count !== 0) {
        throw new Error(`Application database role has sequence privileges in schema ${schema}`);
      }

      const defaultPrivileges = await client.query(
        `
          select count(*)::int as privilege_count
          from pg_default_acl da
          join pg_namespace n on n.oid = da.defaclnamespace
          join lateral aclexplode(da.defaclacl) acl on true
          join pg_roles grantee on grantee.oid = acl.grantee
          where n.nspname = $1
            and grantee.rolname = $2
        `,
        [schema, appRole],
      );

      if (defaultPrivileges.rows[0]?.privilege_count !== 0) {
        throw new Error(`Application database role has default privileges in schema ${schema}`);
      }
    }

    await client.query("commit");
    transactionStarted = false;

    console.log("Application database role provisioned.");
    console.log(`database=${databaseName}`);
    console.log(`migration_role=${migrationRole}`);
    console.log(`application_role=${appRole}`);
    console.log(`schemas=${appSchemas.join(",")}`);
  } finally {
    try {
      if (transactionStarted) {
        await client.query("rollback");
      }

      if (lockAcquired) {
        await client.query("select pg_advisory_unlock($1, $2)", provisionLockKeys);
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
