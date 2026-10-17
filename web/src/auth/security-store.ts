import { createHash, createHmac, randomUUID } from "node:crypto";
import type { PoolClient, QueryResultRow } from "pg";
import { hasPermissionForRoles, isStaffRoleId, PERMISSION_IDS } from "../identity/rbac";

export class AuthSecurityError extends Error {
  constructor(readonly code: string, readonly status = 403) { super(code); }
}

export type StaffSecurity = {
  userId: string; accountId: string; email: string; status: string; roles: string[];
  securityRevision: number; twoFactorEnabled: boolean; totpVerified: boolean; emailVerified: boolean;
};
export type StaffSession = { id: string; userId: string; securityRevision: number; mfaVerifiedAt: Date | null; createdAt: Date };

export class AuthSecurityStore {
  constructor(readonly client: Pick<PoolClient, "query">, readonly secret: string) {}

  async rows<T extends QueryResultRow>(text: string, values: unknown[] = []): Promise<T[]> {
    return (await this.client.query<T>(text, values)).rows;
  }

  async user(value: string, by: "id" | "email" = "id"): Promise<StaffSecurity | null> {
    const rows = await this.rows<StaffSecurity>(`
      select u.id as "userId", a.id as "accountId", u.email, a.status,
        u.security_revision as "securityRevision", u.two_factor_enabled as "twoFactorEnabled",
        u.email_verified_flag as "emailVerified", coalesce(t.verified, false) as "totpVerified",
        coalesce(array_agg(r.role_id) filter (where r.role_id is not null), '{}') as roles
      from auth.users u join identity.accounts a on a.auth_user_id=u.id
      left join identity.account_roles r on r.account_id=a.id
      left join auth.two_factors t on t.user_id=u.id
      where ${by === "id" ? "u.id" : "u.email"}=$1
      group by u.id,a.id,t.verified`, [value]);
    return rows[0] ?? null;
  }

  async lock(userId: string): Promise<void> {
    // Same transaction lock for HTTP credential checks, MFA, operator recovery,
    // password replacement and session creation. No process-local coordination.
    await this.client.query("select pg_advisory_xact_lock(910230207, hashtext($1))", [userId]);
  }

  async session(token: string): Promise<StaffSession | null> {
    return (await this.rows<StaffSession>(`select id,user_id as "userId",security_revision as "securityRevision",
      mfa_verified_at as "mfaVerifiedAt",created_at as "createdAt" from auth.staff_sessions
      where token=$1 and expires_at>now()`, [token]))[0] ?? null;
  }

  async challenge(identifier: string): Promise<string | null> {
    return (await this.rows<{ value: string }>("select value from auth.staff_verifications where identifier=$1 and expires_at>now() limit 1", [identifier]))[0]?.value ?? null;
  }

  async audit(operationId: string, eventType: string, operator: string, accountId: string | null,
    details: Record<string, string | number | boolean | null> = {}): Promise<void> {
    await this.client.query(`insert into auth.security_audit(id,operation_id,event_type,operator,target_account_id,details)
      values($1,$2,$3,$4,$5,$6) on conflict do nothing`,
    [randomUUID(), operationId, eventType, operator, accountId, JSON.stringify(details)]);
  }

  async revoke(user: StaffSecurity): Promise<void> {
    await this.client.query("update auth.users set security_revision=security_revision+1,updated_at=now() where id=$1", [user.userId]);
    await this.client.query("delete from auth.staff_sessions where user_id=$1", [user.userId]);
    await this.client.query("delete from auth.staff_verifications where value=$1 or identifier=$2", [user.userId, user.email]);
  }

  async passwordHash(userId: string): Promise<string | null> {
    return (await this.rows<{ password: string }>("select password from auth.credential_accounts where user_id=$1 and provider_id='credential'", [userId]))[0]?.password ?? null;
  }

  async startPasswordChange(user: StaffSecurity, session: StaffSession, passwordHash: string): Promise<string> {
    const id = randomUUID();
    await this.client.query("delete from auth.password_operations where user_id=$1 and expires_at<=now()", [user.userId]);
    await this.client.query(`insert into auth.password_operations(id,user_id,session_id,security_revision,password_hash,expires_at)
      values($1,$2,$3,$4,$5,now()+interval '5 minutes')`, [id,user.userId,session.id,user.securityRevision,passwordHash]);
    return id;
  }

  async passwordOperation(id: string, user: StaffSecurity, session: StaffSession): Promise<{ passwordHash: string } | null> {
    return (await this.rows<{ passwordHash: string }>(`select password_hash as "passwordHash" from auth.password_operations
      where id=$1 and user_id=$2 and session_id=$3 and security_revision=$4
      and consumed_at is null and expires_at>now() for update`, [id,user.userId,session.id,user.securityRevision]))[0] ?? null;
  }

  async consumeTotp(userId: string, code: string): Promise<void> {
    await this.client.query("delete from auth.totp_step_up_uses where expires_at<=now()");
    const key = createHmac("sha256", this.secret).update(`step-up\0${userId}\0${code}`).digest("hex");
    const used = await this.rows(`insert into auth.totp_step_up_uses(proof_hash,expires_at)
      values($1,now()+interval '120 seconds') on conflict(proof_hash) do update
      set expires_at=excluded.expires_at where auth.totp_step_up_uses.expires_at<=now() returning proof_hash`, [key]);
    if (!used.length) throw new AuthSecurityError("TOTP_REPLAY", 409);
  }

  async finishPasswordChange(id: string, user: StaffSecurity, session: StaffSession): Promise<void> {
    const operation = await this.passwordOperation(id, user, session);
    if (!operation) throw new AuthSecurityError("PASSWORD_OPERATION_INVALID", 409);
    const used = await this.rows(`update auth.password_operations set consumed_at=now()
      where id=$1 and consumed_at is null returning id`, [id]);
    if (!used.length) throw new AuthSecurityError("PASSWORD_OPERATION_INVALID", 409);
    await this.client.query(`update auth.credential_accounts set password=$1,updated_at=now()
      where user_id=$2 and provider_id='credential'`, [operation.passwordHash, user.userId]);
    await this.audit(id, "password_changed", `session:${session.id}`, user.accountId);
    await this.revoke(user);
  }

  async rateLimit(path: string, subject: string, max = 5, seconds = 60): Promise<void> {
    const key = `staff/${createHash("sha256").update(`${path}/${subject}`).digest("hex")}`;
    const now = Date.now();
    const result = await this.rows(`insert into auth.rate_limits(id,key,count,last_request) values($1,$2,1,$3)
      on conflict(key) do update set count=case when auth.rate_limits.last_request<=$4 then 1 else auth.rate_limits.count+1 end,
      last_request=case when auth.rate_limits.last_request<=$4 then $3 else auth.rate_limits.last_request end
      where auth.rate_limits.last_request<=$4 or auth.rate_limits.count<$5 returning count`,
    [randomUUID(),key,now,now-seconds*1000,max]);
    if (!result.length) throw new AuthSecurityError("AUTH_RATE_LIMITED", 429);
  }
}

export function activeStaff(user: StaffSecurity | null): user is StaffSecurity {
  return !!user && user.status === "active" &&
    hasPermissionForRoles(user.roles.filter(isStaffRoleId), PERMISSION_IDS.adminAccess);
}

export function hasRequiredEmailVerification(user: StaffSecurity | null): boolean {
  // Roles/status come from PostgreSQL Identity, never request fields. Keep email
  // verification required by default for any future non-staff authentication.
  return !!user && (user.emailVerified || activeStaff(user));
}

export function fullStaffSession(user: StaffSecurity | null, session: StaffSession | null): boolean {
  return activeStaff(user) && !!session && session.userId === user.userId &&
    session.securityRevision === user.securityRevision && hasRequiredEmailVerification(user) &&
    (!user.roles.includes("super_admin") || (user.twoFactorEnabled && user.totpVerified && !!session.mfaVerifiedAt));
}
