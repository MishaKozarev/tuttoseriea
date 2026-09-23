import crypto from "node:crypto";

import { config } from "dotenv";
import pg from "pg";

import { normalizeIdentityEmail } from "@/src/identity/email";
import { assertStaffRoleId, STAFF_ROLE_IDS, type StaffRoleId } from "@/src/identity/rbac";

const { Pool } = pg;

config({ path: ".env.local", quiet: true });
config({ path: ".env", quiet: true });

type ProvisionOptions = {
  dryRun: boolean;
  email: string;
  roles: StaffRoleId[];
};

function requireEnv(name: string): string {
  const value = process.env[name];

  if (!value) {
    throw new Error(`${name} is required`);
  }

  return value;
}

function parseArgs(argv: string[]): ProvisionOptions {
  const args = new Map<string, string | true>();

  for (const arg of argv) {
    if (arg === "--dry-run") {
      args.set("dry-run", true);
      continue;
    }

    const match = /^--([^=]+)=(.*)$/.exec(arg);

    if (!match) {
      throw new Error(`Unknown argument: ${arg}`);
    }

    args.set(match[1], match[2]);
  }

  const email = normalizeIdentityEmail(args.get("email"));

  if (!email) {
    throw new Error("--email must be a valid email address");
  }

  const rolesArg = args.get("roles");

  if (typeof rolesArg !== "string") {
    throw new Error(`--roles is required, allowed values: ${STAFF_ROLE_IDS.join(",")}`);
  }

  const roles = rolesArg
    .split(",")
    .map((role) => role.trim())
    .filter(Boolean)
    .map(assertStaffRoleId);

  if (roles.length === 0) {
    throw new Error("--roles must include at least one staff role");
  }

  return {
    dryRun: args.get("dry-run") === true,
    email,
    roles: [...new Set(roles)],
  };
}

function logError(error: unknown): void {
  if (error instanceof Error) {
    console.error(error.stack ?? error.message);
    return;
  }

  console.error(error);
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const pool = new Pool({
    connectionString: requireEnv("MIGRATION_DATABASE_URL"),
    max: 1,
  });
  const client = await pool.connect();
  let transactionStarted = false;

  try {
    await client.query("begin");
    transactionStarted = true;

    const missingRoles = await client.query<{ id: string }>(
      `
        select expected.id
        from unnest($1::text[]) as expected(id)
        left join identity.roles r on r.id = expected.id
        where r.id is null
      `,
      [options.roles],
    );

    if (missingRoles.rowCount !== 0) {
      throw new Error("Identity roles are missing; run migrations before provisioning staff");
    }

    const authUserId = crypto.randomUUID();
    const authUser = await client.query<{ id: string }>(
      `
        insert into auth.users (id, name, email, email_verified, image)
        values ($1, null, $2, null, null)
        on conflict (email) do update set email = excluded.email
        returning id
      `,
      [authUserId, options.email],
    );
    const resolvedAuthUserId = authUser.rows[0]?.id;

    if (!resolvedAuthUserId) {
      throw new Error("Failed to create or resolve Auth.js user");
    }

    const accountId = crypto.randomUUID();
    const identityAccount = await client.query<{ id: string }>(
      `
        insert into identity.accounts (id, auth_user_id)
        values ($1, $2)
        on conflict (auth_user_id) do update set auth_user_id = excluded.auth_user_id
        returning id
      `,
      [accountId, resolvedAuthUserId],
    );
    const resolvedAccountId = identityAccount.rows[0]?.id;

    if (!resolvedAccountId) {
      throw new Error("Failed to create or resolve Identity Account");
    }

    for (const role of options.roles) {
      await client.query(
        `
          insert into identity.account_roles (account_id, role_id)
          values ($1, $2)
          on conflict (account_id, role_id) do nothing
        `,
        [resolvedAccountId, role],
      );
    }

    if (options.dryRun) {
      await client.query("rollback");
      transactionStarted = false;
      console.log("Staff identity provisioning dry run completed.");
    } else {
      await client.query("commit");
      transactionStarted = false;
      console.log("Staff identity provisioned.");
    }

    console.log(`email=${options.email}`);
    console.log(`auth_user_id=${resolvedAuthUserId}`);
    console.log(`identity_account_id=${resolvedAccountId}`);
    console.log(`roles=${options.roles.join(",")}`);
    console.log(`dry_run=${options.dryRun}`);
  } finally {
    if (transactionStarted) {
      await client.query("rollback");
    }

    client.release();
    await pool.end();
  }
}

main().catch((error: unknown) => {
  logError(error);
  process.exitCode = 1;
});
