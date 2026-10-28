import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { hashPassword } from "better-auth/crypto";
import type { Pool } from "pg";
import { updateCookies } from "./auth-test-helpers";

export type ArticleStaffFixture = { userId: string; accountId: string; email: string; password: string };

/** Only call with the harness's already validated LOCAL/isolated-CI owner pool. */
export async function seedArticleStaff(pool: Pool, roles: readonly string[] = ["writer"]): Promise<ArticleStaffFixture> {
  assert(roles.every(role => ["writer", "admin", "super_admin"].includes(role)), "Unsupported fixture role");
  const fixture = { userId: randomUUID(), accountId: randomUUID(), email: `articles-${randomUUID()}@articles-check.invalid`, password: `Synthetic articles ${randomUUID()}` };
  const passwordHash = await hashPassword(fixture.password);
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("insert into auth.users(id,name,email) values($1,'Articles fixture',$2)", [fixture.userId, fixture.email]);
    await client.query("insert into identity.accounts(id,auth_user_id) values($1,$2)", [fixture.accountId, fixture.userId]);
    for (const role of roles) await client.query("insert into identity.account_roles(account_id,role_id) values($1,$2)", [fixture.accountId, role]);
    await client.query("insert into auth.credential_accounts(id,user_id,account_id,provider_id,password) values($1,$2,$2,'credential',$3)", [randomUUID(), fixture.userId, passwordHash]);
    await client.query("commit");
    return fixture;
  } catch (error) { await client.query("rollback"); throw error; }
  finally { client.release(); }
}

/** Writer/Admin login only; no MFA bypass or synthesized session. */
export async function loginArticleStaff(origin: string, fixture: Pick<ArticleStaffFixture, "email" | "password">): Promise<string> {
  assert(["127.0.0.1", "localhost"].includes(new URL(origin).hostname), "Fixture login must stay on loopback");
  const response = await fetch(`${origin}/api/auth/sign-in/email`, {
    method: "POST", headers: { origin, "Content-Type": "application/json" }, body: JSON.stringify({ email: fixture.email, password: fixture.password }), redirect: "manual",
  });
  assert.equal(response.status, 200, "Synthetic fixture password login failed");
  const result = await response.json() as { twoFactorRedirect?: boolean };
  assert(!result.twoFactorRedirect, "Use the real browser MFA flow for a Super Admin fixture");
  const cookie = updateCookies(response);
  assert(cookie, "Fixture password login did not issue a cookie");
  return cookie;
}
