import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import type { Pool } from "pg";

export async function checkAuthMigration(pool: Pool) {
  const names = await readdir("drizzle");
  const authDdl = await readFile(`drizzle/${names.find(name => /^0001_.*\.sql$/.test(name))!}`, "utf8");
  const identityDdl = await readFile(`drizzle/${names.find(name => /^0002_.*\.sql$/.test(name))!}`, "utf8");
  const migration = await readFile("drizzle/0019_staff_password_auth.sql", "utf8");
  const retirement = await readFile("drizzle/0020_retire_legacy_auth.sql", "utf8");
  for (const mode of ["valid", "missing", "collision"]) {
    const suffix = randomUUID().replaceAll("-", "");
    const auth = `"auth_check_${suffix}"`, identity = `"identity_check_${suffix}"`;
    const map = (sql: string) => sql.replaceAll('"auth"', auth).replaceAll('"identity"', identity).replace(/\bauth\./g, `${auth}.`).replace(/\bidentity\./g, `${identity}.`);
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query(map(authDdl)); await client.query(map(identityDdl));
      await client.query(`insert into ${auth}.users(id,email,email_verified) values('existing-user',$1,'2026-10-01')`, [mode === "missing" ? null : "Staff@auth-migration.invalid"]);
      await client.query(`insert into ${identity}.accounts(id,auth_user_id) values('existing-account','existing-user');
        insert into ${identity}.account_roles(account_id,role_id) values('existing-account','super_admin');
        create table ${identity}.ownership_fixture(account_id text references ${identity}.accounts(id) on delete restrict);
        insert into ${identity}.ownership_fixture values('existing-account')`);
      if (mode === "collision") await client.query(`insert into ${auth}.users(id,email) values('collision','staff@auth-migration.invalid')`);
      if (mode !== "valid") { await assert.rejects(client.query(map(migration)), /unique non-empty normalized emails/); continue; }
      await client.query(map(migration));
      await client.query(`insert into ${auth}.sessions(session_token,user_id,expires) values('legacy-synthetic','existing-user',now() at time zone 'UTC'+interval '1 day');
        insert into ${auth}.verification_tokens(identifier,token,expires) values('staff@auth-migration.invalid','synthetic-token',now() at time zone 'UTC'+interval '1 day');
        insert into ${auth}.staff_sessions(id,token,user_id,expires_at) values('new-session','new-synthetic','existing-user',now()+interval '1 hour')`);
      await client.query(map(retirement));
      await client.query(map(retirement)); // Idempotent even without the migration journal.
      assert.equal((await client.query(`select count(*)::int as count from ${auth}.sessions where expires>now() at time zone 'UTC'`)).rows[0].count, 0);
      assert.equal((await client.query(`select count(*)::int as count from ${auth}.verification_tokens where expires>now() at time zone 'UTC'`)).rows[0].count, 0);
      assert.equal((await client.query(`select count(*)::int as count from ${auth}.security_audit where operation_id='migration/0020'`)).rows[0].count, 1);
      const row = (await client.query(`select u.id as user,a.id as account,u.name,u.email,u.email_verified_flag as verified,a.status,r.role_id as role,
        f.account_id as owner from ${auth}.users u join ${identity}.accounts a on a.auth_user_id=u.id
        join ${identity}.account_roles r on r.account_id=a.id join ${identity}.ownership_fixture f on f.account_id=a.id`)).rows[0];
      assert.deepEqual(row, { user: "existing-user", account: "existing-account", name: "Staff", email: "staff@auth-migration.invalid", verified: true, status: "active", role: "super_admin", owner: "existing-account" });
      assert.equal((await client.query(`select count(*)::int as count from ${auth}.staff_sessions where expires_at>now()`)).rows[0].count, 1);
    } finally { await client.query("rollback"); client.release(); }
  }
}
