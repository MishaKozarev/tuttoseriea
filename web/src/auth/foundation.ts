import { randomUUID, createHash } from "node:crypto";
import { betterAuth } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { twoFactor } from "better-auth/plugins";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { users, credentialAccounts, staffSessions, staffVerifications, twoFactors, authRateLimits } from "../db/schema/auth";
import { normalizeIdentityEmail } from "../identity/email";
import type { AuthConfig } from "./config";
import { activeStaff, fullStaffSession, hasRequiredEmailVerification, type StaffSecurity, type StaffSession, AuthSecurityStore } from "./security-store";
import type { AuthEmail, AuthEmailSender } from "../email/resend";

export const STAFF_AUTH_POST_PATHS = new Set([
  "/sign-in/email", "/sign-out", "/two-factor/enable", "/two-factor/verify-totp",
  "/two-factor/verify-backup-code", "/two-factor/generate-backup-codes", "/send-verification-email",
]);
export const STAFF_AUTH_GET_PATHS = new Set(["/get-session", "/verify-email"]);
export type AuthRequestState = {
  user: StaffSecurity | null;
  session: StaffSession | null;
  revision: number | null;
  afterCommit: AuthEmail[];
};
export function newAuthRequestState(): AuthRequestState {
  return { user: null, session: null, revision: null, afterCommit: [] };
}

export function createStaffAuth(
  database: Parameters<typeof drizzleAdapter>[0],
  store: AuthSecurityStore,
  config: AuthConfig,
  state: AuthRequestState = newAuthRequestState(),
  sendEmail?: AuthEmailSender,
) {
  function deny(code = "FORBIDDEN"): never { throw new APIError("FORBIDDEN", { code, message: "Access denied" }); }
  return betterAuth({
    appName: "TuttoSerieA",
    baseURL: config.origin,
    basePath: "/api/auth",
    secret: config.secret,
    trustedOrigins: [config.origin],
    database: drizzleAdapter(database, {
      provider: "pg", transaction: true,
      schema: { user: users, account: credentialAccounts, session: staffSessions,
        verification: staffVerifications, twoFactor: twoFactors, rateLimit: authRateLimits },
    }),
    user: {
      fields: { emailVerified: "emailVerifiedFlag" },
      additionalFields: { securityRevision: { type: "number", defaultValue: 0, input: false, returned: false } },
      changeEmail: { enabled: false },
      deleteUser: { enabled: false },
    },
    account: { accountLinking: { enabled: false } },
    session: {
      expiresIn: 8 * 60 * 60, freshAge: 15 * 60,
      cookieCache: { enabled: false },
      additionalFields: {
        securityRevision: { type: "number", defaultValue: 0, input: false, returned: false },
        mfaVerifiedAt: { type: "date", required: false, input: false, returned: true },
      },
    },
    advanced: {
      database: { generateId: () => randomUUID() },
      cookiePrefix: "tuttoseriea-auth",
      useSecureCookies: config.origin.startsWith("https:"),
      crossSubDomainCookies: { enabled: false },
      defaultCookieAttributes: { httpOnly: true, sameSite: "lax", path: "/" },
      ipAddress: { ipAddressHeaders: config.ipHeader ? [config.ipHeader] : [] },
    },
    emailAndPassword: {
      // The shared server policy below handles the Identity-based staff exemption.
      enabled: true, disableSignUp: true, requireEmailVerification: false,
      minPasswordLength: 15, maxPasswordLength: 128,
    },
    emailVerification: {
      autoSignInAfterVerification: false, sendOnSignIn: false, sendOnSignUp: false,
      expiresIn: 60 * 60,
      async beforeEmailVerification(user) {
        await store.lock(user.id);
        if (!activeStaff(await store.user(user.id))) deny("ACCOUNT_UNAVAILABLE");
      },
      async sendVerificationEmail({ user, url, token }) {
        const message: AuthEmail = { to: user.email, subject: "TuttoSerieA — подтверждение адреса",
          text: `Подтвердите адрес: ${url}\nЭта ссылка не выполняет вход и не меняет пароль.`,
          deliveryId: `verification/${createHash("sha256").update(token).digest("hex")}` };
        if (sendEmail) await sendEmail(message);
        else state.afterCommit.push(message);
      },
    },
    rateLimit: { enabled: true, storage: "database", window: 60, max: 60 },
    logger: { disabled: true },
    plugins: [twoFactor({
      issuer: "TuttoSerieA", skipVerificationOnEnable: false,
      accountLockout: { enabled: true, maxFailedAttempts: 5, durationSeconds: 900 },
      backupCodeOptions: { amount: 10, length: 12, storeBackupCodes: "encrypted" },
    })],
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        const path = ctx.path;
        if (!STAFF_AUTH_GET_PATHS.has(path) && !STAFF_AUTH_POST_PATHS.has(path)) deny("AUTH_OPERATION_DISABLED");
        if (!STAFF_AUTH_GET_PATHS.has(path) && !config.writesEnabled) deny("AUTH_WRITES_DISABLED");
        if (ctx.body?.trustDevice === true || (ctx.body?.method && ctx.body.method !== "totp")) deny();
        let userId: string | null = null;
        let session: StaffSession | null = null;
        if (path === "/sign-in/email" || path === "/send-verification-email") {
          const email = normalizeIdentityEmail(ctx.body?.email);
          if (!email) throw new APIError("UNAUTHORIZED", { code: "INVALID_EMAIL_OR_PASSWORD", message: "Invalid credentials" });
          ctx.body.email = email;
          userId = (await store.user(email, "email"))?.userId ?? null;
        } else {
          const token = await ctx.getSignedCookie(ctx.context.authCookies.sessionToken.name, ctx.context.secret);
          if (token) session = await store.session(token);
          userId = session?.userId ?? null;
          if (!userId && path.startsWith("/two-factor/")) {
            const challenge = await ctx.getSignedCookie(ctx.context.createAuthCookie("two_factor").name, ctx.context.secret);
            if (challenge) userId = await store.challenge(challenge);
          }
        }
        if (userId && path !== "/get-session") await store.lock(userId);
        const user = userId ? await store.user(userId) : null;
        // Re-read after the lock: operator revocation can commit while a request waits.
        if (session) {
          const token = await ctx.getSignedCookie(ctx.context.authCookies.sessionToken.name, ctx.context.secret);
          session = token ? await store.session(token) : null;
        }
        state.user = user; state.session = session; state.revision = user?.securityRevision ?? null;
        if (["/sign-in/email", "/sign-out", "/get-session", "/verify-email"].includes(path)) return;
        if (!activeStaff(user)) deny("ACCOUNT_UNAVAILABLE");
        if (session && session.securityRevision !== user.securityRevision) deny("SESSION_REVOKED");
        if (path === "/send-verification-email") return;
        if (!user.roles.includes("super_admin")) deny();
        if (path === "/two-factor/enable" && (!session || user.totpVerified)) deny();
        if (path === "/two-factor/verify-backup-code" && (!user.twoFactorEnabled || !user.totpVerified)) deny("MFA_ENROLLMENT_REQUIRED");
        if (path === "/two-factor/generate-backup-codes" && (!fullStaffSession(user, session) ||
          !session?.mfaVerifiedAt || Date.now() - session.mfaVerifiedAt.getTime() > 15 * 60_000)) deny("FRESH_MFA_REQUIRED");
      }),
    },
    databaseHooks: {
      user: { create: { before: async () => deny("REGISTRATION_CLOSED") } },
      session: { create: { before: async (session, ctx) => {
        const current = await store.user(session.userId);
        if (!activeStaff(current) || !hasRequiredEmailVerification(current) || current.securityRevision !== state.revision) deny("ACCOUNT_UNAVAILABLE");
        const verifiedPath = ctx?.path === "/two-factor/verify-totp" || ctx?.path === "/two-factor/verify-backup-code";
        return { data: { ...session, expiresAt: new Date(Date.now() + 8 * 60 * 60_000),
          securityRevision: current.securityRevision, mfaVerifiedAt: verifiedPath ? new Date() : null } };
      } } },
    },
  });
}
