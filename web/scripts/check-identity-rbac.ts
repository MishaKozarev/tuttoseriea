import crypto from "node:crypto";

import { config } from "dotenv";
import { sql } from "drizzle-orm";
import pg from "pg";

import { closeDbConnection, getDb } from "@/src/db";
import { emailHasPermission, getIdentityAccessByAuthUserId } from "@/src/identity/repository";
import {
  PERMISSION_IDS,
  STAFF_ROLE_IDS,
  hasPermissionForRoles,
  type StaffRoleId,
} from "@/src/identity/rbac";

const { Pool } = pg;

config({ path: ".env.local", quiet: true });
config({ path: ".env", quiet: true });

function requireEnv(name: string): string {
  const value = process.env[name];

  if (!value) {
    throw new Error(`${name} is required`);
  }

  return value;
}

function logError(error: unknown): void {
  if (error instanceof Error) {
    console.error(error.stack ?? error.message);
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

async function expectPostgresErrorCode(
  operation: () => Promise<unknown>,
  code: string,
  label: string,
): Promise<void> {
  try {
    await operation();
  } catch (error) {
    if (postgresErrorCode(error) === code) {
      return;
    }

    throw error;
  }

  throw new Error(`${label} did not fail with PostgreSQL error ${code}`);
}

async function insertIdentityFixture(
  client: pg.PoolClient,
  suffix: string,
  label: string,
  roles: readonly StaffRoleId[],
): Promise<{ accountId: string; authUserId: string; email: string }> {
  const authUserId = `identity-check-auth-${label}-${suffix}`;
  const accountId = `identity-check-account-${label}-${suffix}`;
  const email = `identity-check-${label}-${suffix}@example.invalid`;

  await client.query(
    `
      insert into auth.users (id, name, email, email_verified, image)
      values ($1, $2, $3, null, null)
    `,
    [authUserId, `Identity Check ${label}`, email],
  );
  await client.query(
    `
      insert into identity.accounts (id, auth_user_id)
      values ($1, $2)
    `,
    [accountId, authUserId],
  );

  for (const role of roles) {
    await client.query(
      `
        insert into identity.account_roles (account_id, role_id)
        values ($1, $2)
      `,
      [accountId, role],
    );
  }

  return { accountId, authUserId, email };
}

async function assertRuntimeCannotWriteIdentity(
  accountId: string,
  authUserId: string,
): Promise<void> {
  await expectPostgresErrorCode(
    () =>
      getDb().execute(
        sql`
          insert into identity.accounts (id, auth_user_id)
          values (${`${accountId}-runtime-denied`}, ${authUserId})
        `,
      ),
    "42501",
    "runtime identity insert",
  );
}

async function main(): Promise<void> {
  const migrationPool = new Pool({
    connectionString: requireEnv("MIGRATION_DATABASE_URL"),
    max: 1,
  });
  const client = await migrationPool.connect();
  const suffix = crypto.randomUUID();
  const authUserIds: string[] = [];

  try {
    const roleRows = await client.query<{ id: string }>(
      "select id from identity.roles order by id",
    );
    const actualRoles = roleRows.rows.map((row) => row.id).sort();
    const expectedRoles = [...STAFF_ROLE_IDS].sort();

    if (JSON.stringify(actualRoles) !== JSON.stringify(expectedRoles)) {
      throw new Error(`Identity roles mismatch: ${actualRoles.join(",")}`);
    }

    const writer = await insertIdentityFixture(client, suffix, "writer", ["writer"]);
    const admin = await insertIdentityFixture(client, suffix, "admin", ["admin"]);
    const superAdmin = await insertIdentityFixture(client, suffix, "super-admin", [
      "super_admin",
    ]);
    const multiRole = await insertIdentityFixture(client, suffix, "multi-role", [
      "writer",
      "admin",
    ]);
    const ordinary = await insertIdentityFixture(client, suffix, "ordinary", []);

    authUserIds.push(
      writer.authUserId,
      admin.authUserId,
      superAdmin.authUserId,
      multiRole.authUserId,
      ordinary.authUserId,
    );

    const writerAccess = await getIdentityAccessByAuthUserId(writer.authUserId);
    const adminAccess = await getIdentityAccessByAuthUserId(admin.authUserId);
    const superAdminAccess = await getIdentityAccessByAuthUserId(superAdmin.authUserId);
    const multiRoleAccess = await getIdentityAccessByAuthUserId(multiRole.authUserId);
    const ordinaryAccess = await getIdentityAccessByAuthUserId(ordinary.authUserId);

    for (const access of [writerAccess, adminAccess, superAdminAccess, multiRoleAccess]) {
      if (!access || !hasPermissionForRoles(access.roles, PERMISSION_IDS.adminAccess)) {
        throw new Error("Expected staff identity to have admin.access");
      }
    }

    if (
      !ordinaryAccess ||
      hasPermissionForRoles(ordinaryAccess.roles, PERMISSION_IDS.adminAccess)
    ) {
      throw new Error("Ordinary Identity Account unexpectedly has admin.access");
    }

    if (!(await emailHasPermission(writer.email, PERMISSION_IDS.adminAccess))) {
      throw new Error("emailHasPermission did not resolve staff access");
    }

    if (await emailHasPermission(ordinary.email, PERMISSION_IDS.adminAccess)) {
      throw new Error("emailHasPermission granted ordinary access");
    }

    await expectPostgresErrorCode(
      () =>
        client.query(
          `
            insert into identity.accounts (id, auth_user_id)
            values ($1, $2)
          `,
          [`${ordinary.accountId}-duplicate`, ordinary.authUserId],
        ),
      "23505",
      "identity.accounts auth_user_id uniqueness",
    );

    await expectPostgresErrorCode(
      () =>
        client.query(
          `
            insert into identity.account_roles (account_id, role_id)
            values ($1, $2)
          `,
          [writer.accountId, "writer"],
        ),
      "23505",
      "identity.account_roles duplicate assignment",
    );

    await assertRuntimeCannotWriteIdentity(ordinary.accountId, ordinary.authUserId);
  } finally {
    if (authUserIds.length > 0) {
      await client.query("delete from auth.users where id = any($1::text[])", [authUserIds]);
    }

    client.release();
    await migrationPool.end();
    await closeDbConnection();
  }

  console.log("Identity RBAC check passed.");
  console.log("identity_accounts_1_to_1=true");
  console.log("identity_account_roles_multi_role=true");
  console.log("identity_admin_access_mapping=true");
  console.log("identity_runtime_write_denied=true");
}

main().catch((error: unknown) => {
  logError(error);
  process.exitCode = 1;
});
