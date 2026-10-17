import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { hashPassword } from "better-auth/crypto";
import { normalizeIdentityEmail } from "../identity/email";
import { assertStaffRoleId } from "../identity/rbac";
import { validStaffPassword } from "./config";
import { AuthSecurityStore, AuthSecurityError } from "./security-store";
import type { AuthEmailSender } from "../email/resend";

export type StaffOperatorCommand = {
  action: "provision" | "grant-roles" | "reissue-password" | "recover-mfa" | "disable";
  email: string; operationId: string; operator: string; confirmation: string;
  password?: string; roles?: string[];
};
async function ownerOnly(client: PoolClient) {
  const result = await client.query<{ allowed: boolean }>(`select has_table_privilege(current_user,'identity.accounts','INSERT')
    and has_table_privilege(current_user,'auth.security_audit','SELECT') as allowed`);
  if (!result.rows[0].allowed) throw new AuthSecurityError("OPERATOR_DATABASE_ROLE_REQUIRED");
}

export async function operateStaff(pool: Pool, secret: string, command: StaffOperatorCommand) {
  const email = normalizeIdentityEmail(command.email);
  if (!email || command.confirmation !== email || !command.operator || !/^[0-9a-f-]{36}$/i.test(command.operationId)) throw new AuthSecurityError("OPERATOR_CONFIRMATION_REQUIRED");
  const roles = command.roles?.map(assertStaffRoleId);
  if (["provision", "grant-roles"].includes(command.action) && !roles?.length) throw new AuthSecurityError("STAFF_ROLES_REQUIRED");
  if (["provision", "reissue-password"].includes(command.action) && !validStaffPassword(command.password)) throw new AuthSecurityError("INVALID_PASSWORD");
  const password = command.password ? await hashPassword(command.password) : null;
  const client = await pool.connect();
  try {
    await client.query("begin");
    await ownerOnly(client);
    const store = new AuthSecurityStore(client, secret);
    // Email lock also serializes first provisioning, where no canonical user exists yet.
    await client.query("select pg_advisory_xact_lock(910230208,hashtext($1))", [email]);
    let user = await store.user(email, "email");
    if (user) await store.lock(user.userId);
    const previous = await store.rows<{ email: string; action: string; accountId: string; roles: string | null }>(`select details->>'email' as email,
      details->>'action' as action,details->>'roles' as roles,target_account_id as "accountId" from auth.security_audit where operation_id=$1 and event_type='operator_applied'`, [command.operationId]);
    if (previous.length) {
      if (previous[0].email !== email || previous[0].action !== command.action) throw new AuthSecurityError("OPERATION_ID_CONFLICT", 409);
      if (roles && previous[0].roles !== roles.slice().sort().join(",")) throw new AuthSecurityError("OPERATION_ID_CONFLICT", 409);
      await client.query("commit");
      return { accountId: previous[0].accountId, replay: true };
    }
    if (command.action === "provision") {
      const result = await client.query<{ id: string }>(`insert into auth.users(id,email,name) values($1,$2,'Staff')
        on conflict(email) do update set email=excluded.email returning id`, [randomUUID(), email]);
      const userId = result.rows[0].id;
      await store.lock(userId);
      // Provision never replaces an existing credential or resets MFA.
      if (await store.passwordHash(userId)) throw new AuthSecurityError("STAFF_ALREADY_PROVISIONED", 409);
      await client.query(`insert into identity.accounts(id,auth_user_id) values($1,$2) on conflict(auth_user_id) do nothing`, [randomUUID(), userId]);
      user = await store.user(userId);
      if (!user || user.status !== "active") throw new AuthSecurityError("ACCOUNT_UNAVAILABLE");
      for (const role of roles!) await client.query(`insert into identity.account_roles(account_id,role_id) values($1,$2) on conflict do nothing`, [user.accountId, role]);
      await client.query(`insert into auth.credential_accounts(id,user_id,account_id,provider_id,password) values($1,$2,$2,'credential',$3)`, [randomUUID(), userId, password]);
    } else {
      // Re-read the security state after acquiring the same lock as HTTP authentication.
      user = await store.user(email, "email");
      if (!user) throw new AuthSecurityError("STAFF_NOT_FOUND", 404);
      if (command.action === "recover-mfa") {
        if (!user.roles.includes("super_admin")) throw new AuthSecurityError("SUPER_ADMIN_REQUIRED");
        await client.query("delete from auth.two_factors where user_id=$1", [user.userId]);
        await client.query("update auth.users set two_factor_enabled=false where id=$1", [user.userId]);
      } else if (command.action === "grant-roles") {
        if (user.status !== "active") throw new AuthSecurityError("ACCOUNT_UNAVAILABLE");
        for (const role of roles!) await client.query(`insert into identity.account_roles(account_id,role_id) values($1,$2) on conflict do nothing`, [user.accountId, role]);
      } else if (command.action === "reissue-password") {
        await client.query(`insert into auth.credential_accounts(id,user_id,account_id,provider_id,password) values($1,$2,$2,'credential',$3)
          on conflict(provider_id,account_id) do update set password=excluded.password,updated_at=now()`, [randomUUID(), user.userId, password]);
      } else if (command.action === "disable") {
        await client.query("update identity.accounts set status='disabled' where id=$1", [user.accountId]);
      }
    }
    await store.revoke(user!);
    await client.query("update auth.sessions set expires=least(expires,now() at time zone 'UTC') where user_id=$1", [user!.userId]);
    await client.query("update auth.verification_tokens set expires=least(expires,now() at time zone 'UTC') where identifier=$1", [email]);
    await store.audit(command.operationId, "operator_applied", command.operator, user!.accountId, { action: command.action, email, roles: roles?.slice().sort().join(",") ?? null, outcome: "applied" });
    await client.query("commit");
    return { accountId: user!.accountId, replay: false };
  } catch (error) { await client.query("rollback"); throw error; }
  finally { client.release(); }
}

export async function notifyStaffOperation(pool: Pool, secret: string, operationId: string, send: AuthEmailSender) {
  const client = await pool.connect();
  try {
    await ownerOnly(client);
    const store = new AuthSecurityStore(client, secret);
    const applied = (await store.rows<{ operator: string; accountId: string; details: { email: string; action: string } }>(`select operator,target_account_id as "accountId",details
      from auth.security_audit where operation_id=$1 and event_type='operator_applied'`, [operationId]))[0];
    if (!applied) throw new AuthSecurityError("OPERATION_NOT_FOUND", 404);
    try {
      await send({ to: applied.details.email, deliveryId: `operator/${operationId}`, subject: "TuttoSerieA — изменение безопасности аккаунта",
        text: `Оператор выполнил операцию ${applied.details.action}. Если вы её не ожидали, немедленно свяжитесь с владельцем. Пароли и резервные коды не отправляются по email.` });
      await store.audit(operationId, "notification_sent", applied.operator, applied.accountId, { outcome: "sent" });
    } catch {
      await store.audit(operationId, "notification_failed", applied.operator, applied.accountId, { outcome: "failed" });
      throw new AuthSecurityError("NOTIFICATION_FAILED", 503);
    }
  } finally { client.release(); }
}

export async function retireLegacyAuth(pool: Pool, secret: string, operator: string, confirmation: string) {
  if (confirmation !== "RETIRE LEGACY AUTH") throw new AuthSecurityError("OPERATOR_CONFIRMATION_REQUIRED");
  const client = await pool.connect();
  try {
    await client.query("begin"); await ownerOnly(client);
    const sessions = await client.query("update auth.sessions set expires=least(expires,now() at time zone 'UTC') where expires>now() at time zone 'UTC'");
    const tokens = await client.query("update auth.verification_tokens set expires=least(expires,now() at time zone 'UTC') where expires>now() at time zone 'UTC'");
    await new AuthSecurityStore(client, secret).audit(randomUUID(), "legacy_retired", operator, null, { sessions: sessions.rowCount ?? 0, tokens: tokens.rowCount ?? 0 });
    await client.query("commit");
    return { sessions: sessions.rowCount, tokens: tokens.rowCount };
  } catch (error) { await client.query("rollback"); throw error; }
  finally { client.release(); }
}
