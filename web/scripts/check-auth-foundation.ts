import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { config as dotenv } from "dotenv";
import pg from "pg";
import { handleStaffAuth } from "../src/auth/http";
import { getAuthConfig } from "../src/auth/config";
import { AuthSecurityStore, fullStaffSession } from "../src/auth/security-store";
import { operateStaff, notifyStaffOperation } from "../src/auth/operator";
import { totpCode, updateCookies } from "./auth-test-helpers";
import type { AuthEmail } from "../src/email/resend";
import { checkAuthMigration } from "./check-auth-migration";

dotenv({ path: ".env.local", quiet: true }); dotenv({ path: ".env", quiet: true });
const authConfig = getAuthConfig({ AUTH_URL: "http://localhost:3198", BETTER_AUTH_SECRET: "synthetic-only-auth-integration-secret-at-least-32", AUTH_TRUSTED_IP_HEADER: "x-real-ip" });
const emails: AuthEmail[] = [];
const fakeSend = async (message: AuthEmail) => { emails.push(message); };
let phase = "preflight";
async function main() {
  for (const name of ["DATABASE_URL", "MIGRATION_DATABASE_URL"]) {
    const target = new URL(process.env[name] ?? "");
    assert(["localhost", "127.0.0.1"].includes(target.hostname) && (target.port === "15432" || (process.env.CI === "true" && target.port === "5432" && target.pathname === "/tuttoseriea_ci")), "LOCAL/exact CI database required");
  }
  const owner = new pg.Pool({ connectionString: process.env.MIGRATION_DATABASE_URL, max: 4 });
  const runtime = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 6 });
  const store = new AuthSecurityStore(owner, authConfig.secret);
  const suffix = randomUUID();
  const identities: { email: string; userId: string; accountId: string; password: string }[] = [];
  const operationIds: string[] = [];
  let sequence = 0;
  async function call(path: string, body?: Record<string, unknown>, cookie = "", config = authConfig) {
    const headers = { origin: authConfig.origin, "content-type": "application/json", cookie, "x-real-ip": `2001:db8:${suffix.slice(0, 4)}:${(++sequence).toString(16)}::1` };
    return handleStaffAuth(new Request(`${authConfig.origin}/api/auth${path}`, { headers, method: body === undefined ? "GET" : "POST", ...(body === undefined ? {} : { body: JSON.stringify(body) }) }), runtime, config, fakeSend, error => {
      // Only synthetic credentials exist in this check; report the underlying SQL message without parameters.
      const cause = (error as Error & { cause?: Error }).cause ?? error as Error;
      console.error("Synthetic auth diagnostic:", cause.name, cause.message.split("\n")[0]);
    });
  }
  async function provision(role: string) {
    const email = `${role}-${suffix}@auth-check.invalid`, password = `Synthetic staff ${randomUUID()}`;
    const operationId = randomUUID(); operationIds.push(operationId);
    const result = await operateStaff(owner, authConfig.secret, { action: "provision", email, roles: [role], operator: "test:operator", confirmation: email, operationId, password });
    const user = await store.user(email, "email"); assert(user);
    identities.push({ email, password, userId: user.userId, accountId: user.accountId });
    assert.equal(result.accountId, user.accountId);
    // Provisioning is not email verification and never creates a session.
    assert.equal(user.emailVerified, false);
    assert.equal((await call("/sign-in/email", { email, password })).status, 403);
    assert.equal((await call("/send-verification-email", { email, callbackURL: "/admin/login" })).status, 200);
    const message = emails.findLast(item => item.to === email && item.deliveryId.startsWith("verification/")); assert(message);
    const link = message.text.match(/http[^\s]+/)![0];
    const verified = await handleStaffAuth(new Request(link), runtime, authConfig, fakeSend);
    assert([200, 302].includes(verified.status)); assert.equal(verified.headers.getSetCookie().length, 0);
    return identities[identities.length - 1];
  }
  try {
    phase = "migration preservation and fail-closed preflight";
    await checkAuthMigration(owner);
    phase = "runtime privileges";
    const privileges = (await runtime.query(`select has_table_privilege(current_user,'auth.security_audit','INSERT') as append,
      has_table_privilege(current_user,'auth.security_audit','UPDATE') as update,
      has_table_privilege(current_user,'auth.security_audit','DELETE') as delete,
      has_table_privilege(current_user,'identity.accounts','UPDATE') as identity_write,
      has_table_privilege(current_user,'auth.sessions','INSERT') as legacy_write`)).rows[0];
    assert.deepEqual(privileges, { append: true, update: false, delete: false, identity_write: false, legacy_write: false });
    phase = "blocked endpoints / origin / write freeze";
    for (const path of ["/sign-up/email", "/request-password-reset", "/reset-password", "/change-password", "/set-password", "/change-email", "/two-factor/disable", "/sign-in/magic-link", "/signin/nodemailer"]) assert.equal((await call(path, {})).status, 404, path);
    assert.equal((await handleStaffAuth(new Request(`${authConfig.origin}/api/auth/sign-in/email`, { method: "POST", headers: { origin: "https://evil.invalid", "content-type": "application/json" }, body: "{}" }), runtime, authConfig, fakeSend)).status, 403);
    assert.equal((await call("/sign-in/email", {}, "", { ...authConfig, writesEnabled: false })).status, 503);
    phase = "writer / admin authentication";
    for (const role of ["writer", "admin"]) {
      const user = await provision(role);
      assert.equal((await call("/sign-in/email", { email: user.email, password: "incorrect credential" })).status, 401);
      const login = await call("/sign-in/email", { email: user.email, password: user.password }); assert.equal(login.status, 200, await login.clone().text());
      assert.equal((await login.clone().json()).token, undefined);
      const cookie = updateCookies(login); assert(cookie.includes("tuttoseriea-auth.session_token"));
      assert.equal((await call("/password-change/start", { currentPassword: user.password, newPassword: "Synthetic new password" }, cookie)).status, 403);
      assert.equal((await call("/two-factor/enable", { password: user.password }, cookie)).status, 403);
      assert.equal((await call("/sign-out", {}, cookie)).status, 200);
      assert.equal(await (await call("/get-session", undefined, cookie)).json(), null);
      await owner.query("update identity.accounts set status='disabled' where id=$1", [user.accountId]);
      assert.equal((await call("/sign-in/email", { email: user.email, password: user.password })).status, 403);
    }
    phase = "super admin enrollment boundary";
    const superAdmin = await provision("super_admin");
    const login = await call("/sign-in/email", { email: superAdmin.email, password: superAdmin.password }); assert.equal(login.status, 200, await login.clone().text());
    let cookie = updateCookies(login);
    const sessionRow = (await owner.query("select token from auth.staff_sessions where user_id=$1", [superAdmin.userId])).rows[0]; assert(sessionRow);
    assert.equal(fullStaffSession(await store.user(superAdmin.userId), await store.session(sessionRow.token)), false);
    assert.equal((await call("/password-change/start", { currentPassword: superAdmin.password, newPassword: "Synthetic new password" }, cookie)).status, 403);
    const enabled = await call("/two-factor/enable", { password: superAdmin.password }, cookie); assert.equal(enabled.status, 200, await enabled.clone().text());
    const enrollment = await enabled.json() as { totpURI: string; backupCodes: string[] }; assert.equal(enrollment.backupCodes.length, 10);
    assert.equal((await call("/two-factor/verify-backup-code", { code: enrollment.backupCodes[0] }, cookie)).status, 403);
    assert.equal((await call("/two-factor/verify-totp", { code: "invalid" }, cookie)).status, 401);
    const enrollmentCode = totpCode(enrollment.totpURI);
    const enrolled = await call("/two-factor/verify-totp", { code: enrollmentCode }, cookie); assert.equal(enrolled.status, 200, await enrolled.clone().text()); cookie = updateCookies(enrolled, cookie);
    const verifiedSession = (await owner.query("select token,mfa_verified_at from auth.staff_sessions where user_id=$1", [superAdmin.userId])).rows[0];
    assert(verifiedSession.mfa_verified_at); assert(fullStaffSession(await store.user(superAdmin.userId), await store.session(verifiedSession.token)));
    assert.equal((await call("/two-factor/verify-totp", { code: enrollmentCode }, cookie)).status, 409);
    const totpChallenge = await call("/sign-in/email", { email: superAdmin.email, password: superAdmin.password });
    assert.equal((await totpChallenge.clone().json()).twoFactorRedirect, true);
    const currentCode = totpCode(enrollment.totpURI);
    const challengeCode = currentCode !== enrollmentCode ? currentCode : totpCode(enrollment.totpURI, Date.now() + 30_000);
    const totpLogin = await call("/two-factor/verify-totp", { code: challengeCode }, updateCookies(totpChallenge));
    assert.equal(totpLogin.status, 200, await totpLogin.clone().text());
    phase = "recovery codes / replay / password operation binding";
    const challenge = await call("/sign-in/email", { email: superAdmin.email, password: superAdmin.password }); assert.equal((await challenge.clone().json()).twoFactorRedirect, true);
    const challengeCookie = updateCookies(challenge);
    const recovered = await call("/two-factor/verify-backup-code", { code: enrollment.backupCodes[0] }, challengeCookie); assert.equal(recovered.status, 200, await recovered.clone().text());
    const secondCookie = updateCookies(recovered, challengeCookie);
    const wrongPassword = await call("/password-change/start", { currentPassword: "Synthetic wrong password", newPassword: "Synthetic replacement password" }, cookie);
    assert.equal(wrongPassword.status, 403); assert.equal((await wrongPassword.json()).error.code, "INVALID_PASSWORD");
    const expiring = await call("/password-change/start", { currentPassword: superAdmin.password, newPassword: "Synthetic expired password" }, cookie);
    assert.equal(expiring.status, 200);
    const expiredOperation = (await expiring.json()).operationId;
    await owner.query("update auth.password_operations set expires_at=now()-interval '1 second' where id=$1", [expiredOperation]);
    const expired = await call("/password-change/confirm", { operationId: expiredOperation, code: totpCode(enrollment.totpURI) }, cookie);
    assert.equal(expired.status, 409); assert.equal((await expired.json()).error.code, "PASSWORD_OPERATION_INVALID");
    const start = await call("/password-change/start", { currentPassword: superAdmin.password, newPassword: "Synthetic replacement password" }, cookie); assert.equal(start.status, 200, await start.clone().text());
    const { operationId } = await start.json(); operationIds.push(operationId);
    assert.equal((await call("/password-change/confirm", { operationId, code: totpCode(enrollment.totpURI) }, secondCookie)).status, 409);
    const anotherChallenge = await call("/sign-in/email", { email: superAdmin.email, password: superAdmin.password });
    assert.equal((await call("/two-factor/verify-backup-code", { code: enrollment.backupCodes[0] }, updateCookies(anotherChallenge))).status, 401);
    phase = "parallel password confirmation";
    // A fresh TOTP step, no replay bypass or clock changes.
    const wait = (challengeCode === totpCode(enrollment.totpURI, Date.now() + 30_000) ? 60_000 : 30_000) - Date.now() % 30_000 + 100;
    await new Promise(resolve => setTimeout(resolve, wait));
    const code = totpCode(enrollment.totpURI);
    const concurrent = await Promise.all([call("/password-change/confirm", { operationId, code }, cookie), call("/password-change/confirm", { operationId, code }, cookie)]);
    const statuses = concurrent.map(item => item.status).sort();
    assert.equal(statuses[0], 200); assert([401, 403].includes(statuses[1]));
    assert.equal((await owner.query("select count(*)::int as count from auth.staff_sessions where user_id=$1", [superAdmin.userId])).rows[0].count, 0);
    assert.equal((await owner.query("select count(*)::int as count from auth.security_audit where operation_id=$1 and event_type='password_changed'", [operationId])).rows[0].count, 1);
    assert.equal(await (await call("/get-session", undefined, secondCookie)).json(), null);
    assert.equal((await call("/sign-in/email", { email: superAdmin.email, password: superAdmin.password })).status, 401);
    phase = "operator recovery / idempotency / notification retry";
    const recoveryId = randomUUID(); operationIds.push(recoveryId);
    const recoveryCommand = { action: "recover-mfa" as const, email: superAdmin.email, operator: "test:operator", confirmation: superAdmin.email, operationId: recoveryId };
    const recoveries = await Promise.all([operateStaff(owner, authConfig.secret, recoveryCommand), operateStaff(owner, authConfig.secret, recoveryCommand)]);
    assert.equal(recoveries.filter(item => !item.replay).length, 1);
    assert.equal(recoveries[0].accountId, superAdmin.accountId);
    const revision = (await store.user(superAdmin.userId))!.securityRevision;
    assert.equal((await operateStaff(owner, authConfig.secret, recoveryCommand)).replay, true);
    assert.equal((await store.user(superAdmin.userId))!.securityRevision, revision);
    assert.equal((await store.user(superAdmin.userId))!.totpVerified, false);
    assert.equal((await owner.query("select count(*)::int as count from auth.two_factors where user_id=$1", [superAdmin.userId])).rows[0].count, 0);
    await assert.rejects(operateStaff(runtime, authConfig.secret, recoveryCommand));
    await assert.rejects(notifyStaffOperation(owner, authConfig.secret, recoveryId, async () => { throw new Error("fake delivery failure"); }));
    await notifyStaffOperation(owner, authConfig.secret, recoveryId, fakeSend);
    assert.equal((await owner.query("select count(*)::int as count from auth.security_audit where operation_id=$1", [recoveryId])).rows[0].count, 3);
    const replacementLogin = await call("/sign-in/email", { email: superAdmin.email, password: "Synthetic replacement password" }); assert.equal(replacementLogin.status, 200);
    assert.equal((await replacementLogin.clone().json()).twoFactorRedirect, undefined);
    assert.equal((await call("/password-change/start", { currentPassword: "Synthetic replacement password", newPassword: "Synthetic next password" }, updateCookies(replacementLogin))).status, 403);
    // Revoked pre-recovery challenge cannot mint a session with old backup codes.
    assert.notEqual((await call("/two-factor/verify-backup-code", { code: enrollment.backupCodes[1] }, updateCookies(anotherChallenge))).status, 200);
    phase = "fresh enrollment after emergency recovery / terminal replay";
    let newCookie = updateCookies(replacementLogin);
    const freshEnrollment = await call("/two-factor/enable", { password: "Synthetic replacement password" }, newCookie); assert.equal(freshEnrollment.status, 200);
    const fresh = await freshEnrollment.json() as { totpURI: string; backupCodes: string[] };
    assert.notEqual(fresh.totpURI, enrollment.totpURI); assert.notDeepEqual(fresh.backupCodes, enrollment.backupCodes);
    const freshVerified = await call("/two-factor/verify-totp", { code: totpCode(fresh.totpURI) }, newCookie); assert.equal(freshVerified.status, 200);
    newCookie = updateCookies(freshVerified, newCookie);
    const factorId = (await owner.query("select id from auth.two_factors where user_id=$1 and verified", [superAdmin.userId])).rows[0].id;
    await operateStaff(owner, authConfig.secret, recoveryCommand);
    assert.equal((await owner.query("select id from auth.two_factors where user_id=$1 and verified", [superAdmin.userId])).rows[0].id, factorId);
    assert.equal((await call("/get-session", undefined, newCookie)).status, 200);
    phase = "operator reissue / sign-in transaction races";
    const writer = identities[0];
    await owner.query("update identity.accounts set status='active' where id=$1", [writer.accountId]);
    const grantId = randomUUID(); operationIds.push(grantId);
    const originalHash = await store.passwordHash(writer.userId);
    const grant = { action: "grant-roles" as const, email: writer.email, roles: ["admin"], operator: "test:operator", operationId: grantId, confirmation: writer.email };
    await operateStaff(owner, authConfig.secret, grant);
    assert.equal((await operateStaff(owner, authConfig.secret, grant)).replay, true);
    await assert.rejects(operateStaff(owner, authConfig.secret, { ...grant, roles: ["super_admin"] }));
    assert.deepEqual((await store.user(writer.userId))!.roles.sort(), ["admin", "writer"]);
    assert.equal(await store.passwordHash(writer.userId), originalHash);
    assert.equal((await store.user(writer.userId))!.accountId, writer.accountId);
    let oldPassword = writer.password;
    for (const first of ["sign-in", "operator"]) {
      const holder = await owner.connect();
      try {
        await holder.query("begin");
        await new AuthSecurityStore(holder, authConfig.secret).lock(writer.userId);
        const id = randomUUID(); operationIds.push(id);
        const newPassword = `Synthetic replacement ${randomUUID()}`;
        const signin = () => call("/sign-in/email", { email: writer.email, password: oldPassword });
        const reissue = () => operateStaff(owner, authConfig.secret, { action: "reissue-password", email: writer.email, operator: "test:operator", operationId: id, confirmation: writer.email, password: newPassword });
        const waiters = async (number: number) => {
          const until = Date.now() + 10_000;
          while (Date.now() < until) {
            const count = (await owner.query(`select count(*)::int as count from pg_locks where locktype='advisory'
              and classid=910230207::oid and objid=((hashtext($1)::bigint & 4294967295)::oid) and not granted`, [writer.userId])).rows[0].count;
            if (count >= number) return;
            await new Promise(resolve => setTimeout(resolve, 20));
          }
          throw new Error("AUTH_LOCK_NOT_OBSERVED");
        };
        // Observe actual waiting PostgreSQL locks for both explicit orders.
        const firstPromise = first === "sign-in" ? signin() : reissue();
        await waiters(1);
        const secondPromise = first === "sign-in" ? reissue() : signin();
        await waiters(2);
        await holder.query("commit");
        const results = await Promise.all([firstPromise, secondPromise]);
        const signinResult = results[first === "sign-in" ? 0 : 1] as Response;
        assert.equal(signinResult.status, first === "sign-in" ? 200 : 401);
        assert.equal((await owner.query("select count(*)::int as count from auth.staff_sessions where user_id=$1", [writer.userId])).rows[0].count, 0);
        assert.equal((await store.user(writer.userId))!.accountId, writer.accountId);
        oldPassword = newPassword;
      } finally { await holder.query("rollback"); holder.release(); }
    }
    console.log("auth_password_mfa_operator_postgresql=PASS real_email_requests=0 football_jobs=0");
  } finally {
    for (const item of identities) await owner.query("delete from auth.users where id=$1", [item.userId]);
    await owner.query("delete from auth.security_audit where operation_id=any($1::text[])", [operationIds]);
    await owner.end(); await runtime.end();
  }
}
main().catch(error => { console.error(`Auth check failed at ${phase}:`, error instanceof assert.AssertionError ? error.message : (error as Error).name); process.exitCode = 1; });
