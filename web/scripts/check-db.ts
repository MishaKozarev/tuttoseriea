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

type RoleAttributesRow = {
  username: string;
  canLogin: boolean;
  isSuperuser: boolean;
  canCreateDatabase: boolean;
  canCreateRole: boolean;
  canReplicate: boolean;
  canBypassRls: boolean;
};

type SchemaPrivilegesRow = {
  canUseSchema: boolean;
  canCreateInSchema: boolean;
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

function postgresErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object") {
    return undefined;
  }

  const code = (error as { code?: unknown }).code;

  if (typeof code === "string") {
    return code;
  }

  return postgresErrorCode((error as { cause?: unknown }).cause);
}

async function assertRuntimeDdlDenied(db: ReturnType<typeof getDb>): Promise<void> {
  const probeTable = "__tuttoseriea_runtime_ddl_probe";
  let probeCreated = false;

  try {
    await db.execute(
      sql`create table ${sql.identifier("public")}.${sql.identifier(probeTable)} (id integer)`,
    );
    probeCreated = true;
  } catch (error: unknown) {
    if (postgresErrorCode(error) === "42501") {
      return;
    }

    throw error;
  } finally {
    if (probeCreated) {
      await db.execute(
        sql`drop table if exists ${sql.identifier("public")}.${sql.identifier(probeTable)}`,
      );
    }
  }

  throw new Error("Runtime database role can create tables in public schema");
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

  if (pgvector.installedVersion !== "0.8.6") {
    throw new Error(`Expected installed pgvector 0.8.6, got ${pgvector.installedVersion}`);
  }

  const roleAttributes = firstRow(
    (
      await db.execute(
        sql<RoleAttributesRow>`
          select
            rolname as "username",
            rolcanlogin as "canLogin",
            rolsuper as "isSuperuser",
            rolcreatedb as "canCreateDatabase",
            rolcreaterole as "canCreateRole",
            rolreplication as "canReplicate",
            rolbypassrls as "canBypassRls"
          from pg_roles
          where rolname = current_user
        `,
      )
    ).rows,
    "runtime role attributes check",
  );

  if (
    roleAttributes.canLogin !== true ||
    roleAttributes.isSuperuser !== false ||
    roleAttributes.canCreateDatabase !== false ||
    roleAttributes.canCreateRole !== false ||
    roleAttributes.canReplicate !== false ||
    roleAttributes.canBypassRls !== false
  ) {
    throw new Error("DATABASE_URL role is not a restricted runtime role");
  }

  const schemaPrivileges = firstRow(
    (
      await db.execute(
        sql<SchemaPrivilegesRow>`
          select
            has_schema_privilege(current_user, 'public', 'USAGE') as "canUseSchema",
            has_schema_privilege(current_user, 'public', 'CREATE') as "canCreateInSchema"
        `,
      )
    ).rows,
    "runtime schema privileges check",
  );

  if (schemaPrivileges.canUseSchema !== true) {
    throw new Error("DATABASE_URL role cannot use public schema");
  }

  if (schemaPrivileges.canCreateInSchema !== false) {
    throw new Error("DATABASE_URL role can create objects in public schema");
  }

  const tablePrivileges = firstRow(
    (
      await db.execute(
        sql<CountRow>`
          select count(*)::int as "count"
          from pg_class c
          join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'public'
            and c.relkind in ('r', 'p', 'v', 'm', 'f')
            and (
              has_table_privilege(current_user, c.oid, 'SELECT')
              or has_table_privilege(current_user, c.oid, 'INSERT')
              or has_table_privilege(current_user, c.oid, 'UPDATE')
              or has_table_privilege(current_user, c.oid, 'DELETE')
            )
        `,
      )
    ).rows,
    "runtime table privilege check",
  );

  if (tablePrivileges.count !== 0) {
    throw new Error("DATABASE_URL role has table DML privileges in public schema");
  }

  const sequencePrivileges = firstRow(
    (
      await db.execute(
        sql<CountRow>`
          select count(*)::int as "count"
          from pg_class c
          join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'public'
            and c.relkind = 'S'
            and (
              has_sequence_privilege(current_user, c.oid, 'USAGE')
              or has_sequence_privilege(current_user, c.oid, 'SELECT')
              or has_sequence_privilege(current_user, c.oid, 'UPDATE')
            )
        `,
      )
    ).rows,
    "runtime sequence privilege check",
  );

  if (sequencePrivileges.count !== 0) {
    throw new Error("DATABASE_URL role has sequence privileges in public schema");
  }

  const defaultPrivileges = firstRow(
    (
      await db.execute(
        sql<CountRow>`
          select count(*)::int as "count"
          from pg_default_acl da
          join pg_namespace n on n.oid = da.defaclnamespace
          join lateral aclexplode(da.defaclacl) acl on true
          join pg_roles grantee on grantee.oid = acl.grantee
          where n.nspname = 'public'
            and grantee.rolname = current_user
        `,
      )
    ).rows,
    "runtime default privilege check",
  );

  if (defaultPrivileges.count !== 0) {
    throw new Error("DATABASE_URL role has default privileges in public schema");
  }

  await assertRuntimeDdlDenied(db);

  console.log("Drizzle LOCAL database check passed.");
  console.log(`select_1=${selectOne.value}`);
  console.log(`current_database=${identity.database}`);
  console.log(`current_user=${identity.username}`);
  console.log(`postgres_major=${postgresMajor}`);
  console.log(`pgvector_available=${pgvector.defaultVersion}`);
  console.log(`vector_extension_installed=${pgvector.installedVersion}`);
  console.log(`runtime_role=${roleAttributes.username}`);
  console.log("runtime_role_superuser=false");
  console.log("runtime_role_create_schema=false");
  console.log("runtime_role_table_dml_privileges=false");
  console.log("runtime_role_default_privileges=false");
  console.log("runtime_role_ddl_denied=true");
}

main()
  .finally(async () => {
    await closeDbConnection();
  })
  .catch((error: unknown) => {
    logError(error);
    process.exitCode = 1;
  });
