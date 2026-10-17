import { describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import { getAuthConfig, validStaffPassword } from "@/src/auth/config";
import { fullStaffSession, hasRequiredEmailVerification, type StaffSecurity, type StaffSession } from "@/src/auth/security-store";
import { createAuthEmailSender, EmailDeliveryError } from "@/src/email/resend";
import { handleStaffAuth } from "@/src/auth/http";
import nextConfig from "@/next.config";

const config = getAuthConfig({ AUTH_URL: "https://staging.tuttoseriea.com", BETTER_AUTH_SECRET: "synthetic-only-security-unit-test-secret" });
const user: StaffSecurity = { userId: "user", accountId: "account", email: "test@example.invalid", roles: ["super_admin"], status: "active", securityRevision: 3, twoFactorEnabled: true, totpVerified: true, emailVerified: false };
const session: StaffSession = { id: "session", userId: "user", securityRevision: 3, mfaVerifiedAt: new Date(), createdAt: new Date() };
describe("Staff session assurance", () => {
  it("keeps verification tokens out of development request logs without suppressing other requests", () => {
    const logging = nextConfig.logging;
    const incoming = logging && logging.incomingRequests;
    const ignored = incoming && typeof incoming === "object" ? incoming.ignore ?? [] : [];
    expect(ignored.some(rule => rule.test("/api/auth/verify-email?token=synthetic"))).toBe(true);
    expect(ignored.some(rule => rule.test("/api/health"))).toBe(false);
  });
  it("requires every persisted MFA and Identity condition for super admin", () => {
    expect(fullStaffSession(user, session)).toBe(true);
    for (const change of [{ twoFactorEnabled: false }, { totpVerified: false }, { status: "disabled" }, { roles: [] }]) expect(fullStaffSession({ ...user, ...change }, session)).toBe(false);
    expect(fullStaffSession(user, { ...session, mfaVerifiedAt: null })).toBe(false);
    expect(fullStaffSession(user, { ...session, securityRevision: 2 })).toBe(false);
    expect(fullStaffSession(user, null)).toBe(false);
    expect(fullStaffSession({ ...user, roles: ["writer"], twoFactorEnabled: false }, { ...session, mfaVerifiedAt: null })).toBe(true);
    expect(fullStaffSession({ ...user, roles: ["writer", "super_admin"] }, { ...session, mfaVerifiedAt: null })).toBe(false);
  });
  it.each(["writer", "admin", "super_admin"])("exempts active %s from email verification without changing the stored fact", role => {
    const staff = { ...user, roles: [role] };
    expect(hasRequiredEmailVerification(staff)).toBe(true);
    expect(fullStaffSession(staff, session)).toBe(true);
    expect(staff.emailVerified).toBe(false);
    expect(hasRequiredEmailVerification({ ...staff, status: "disabled" })).toBe(false);
  });
  it("keeps email verification required by default for ordinary, unknown and missing identities", () => {
    for (const roles of [[], ["reader"], ["unknown"]]) {
      expect(hasRequiredEmailVerification({ ...user, roles })).toBe(false);
      expect(hasRequiredEmailVerification({ ...user, roles, emailVerified: true })).toBe(true);
      // Verification alone never grants access to the current staff-only surface.
      expect(fullStaffSession({ ...user, roles, emailVerified: true }, session)).toBe(false);
    }
    expect(hasRequiredEmailVerification(null)).toBe(false);
  });
  it("rejects unsafe origins, missing secrets and unapproved forwarding headers", () => {
    expect(() => getAuthConfig({})).toThrow();
    for (const AUTH_URL of ["http://staging.tuttoseriea.com", "https://user:password@example.com", "https://example.com/path"]) expect(() => getAuthConfig({ AUTH_URL, BETTER_AUTH_SECRET: config.secret })).toThrow();
    expect(() => getAuthConfig({ AUTH_TRUSTED_IP_HEADER: "x-forwarded-for", BETTER_AUTH_SECRET: config.secret })).toThrow();
    expect(validStaffPassword("a".repeat(15))).toBe(true); expect(validStaffPassword(" ")).toBe(false); expect(validStaffPassword("a".repeat(129))).toBe(false);
  });
});
describe("HTTP allowlist and origin", () => {
  const connect = vi.fn(); const pool = { connect } as unknown as Pool;
  it.each(["/sign-up/email", "/change-password", "/set-password", "/request-password-reset", "/reset-password", "/change-email", "/two-factor/disable", "/sign-in/magic-link", "/callback/nodemailer"])("blocks %s before database access", async path => {
    const response = await handleStaffAuth(new Request(`${config.origin}/api/auth${path}`, { method: "POST" }), pool, config);
    expect(response.status).toBe(404); expect((await response.json()).error.requestId).toBeTruthy(); expect(connect).not.toHaveBeenCalled();
  });
  it.each(["role", "roles", "emailVerified", "emailVerifiedFlag"])("rejects client-supplied %s before Identity lookup", async field => {
    const response = await handleStaffAuth(new Request(`${config.origin}/api/auth/sign-in/email`, {
      method: "POST", headers: { origin: config.origin, "content-type": "application/json" },
      body: JSON.stringify({ email: user.email, password: "synthetic staff password", [field]: ["super_admin"] }),
    }), pool, config);
    expect(response.status).toBe(400); expect(connect).not.toHaveBeenCalled();
  });
  it("fails closed on CSRF, trust-device bypass, extra server fields and write freeze", async () => {
    for (const [origin, body] of [["https://evil.invalid", {}], [config.origin, { trustDevice: true }], [config.origin, { mfaVerifiedAt: new Date() }]] as const) {
      const result = await handleStaffAuth(new Request(`${config.origin}/api/auth/two-factor/verify-totp`, { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify(body) }), pool, config);
      expect([400, 403]).toContain(result.status);
    }
    const frozen = await handleStaffAuth(new Request(`${config.origin}/api/auth/verify-email?token=synthetic`), pool, { ...config, writesEnabled: false });
    expect(frozen.status).toBe(503); expect(connect).not.toHaveBeenCalled();
  });
});
describe("Resend HTTPS boundary with fake transport", () => {
  const env = { AUTH_URL: config.origin, EMAIL_DELIVERY_MODE: "resend", RESEND_API_KEY: "synthetic-test-only", RESEND_FROM: "TuttoSerieA <no-reply@tuttoseriea.com>", EMAIL_ALLOWED_RECIPIENTS: user.email };
  const mail = { to: user.email, subject: "Test", text: "Synthetic", deliveryId: "test-operation" };
  it("passes an abort signal and stable idempotency key; retries only bounded failures", async () => {
    const send = vi.fn().mockRejectedValueOnce(new Error("fake timeout")).mockResolvedValue(undefined);
    await createAuthEmailSender(env, send)(mail);
    expect(send).toHaveBeenCalledTimes(2); expect(send.mock.calls[0][1]).toEqual(send.mock.calls[1][1]); expect(send.mock.calls[0][2]).toBeInstanceOf(AbortSignal);
  });
  it("enforces sender and staging recipient restrictions before transport", async () => {
    const send = vi.fn();
    for (const change of [{ EMAIL_ALLOWED_RECIPIENTS: "" }, { RESEND_FROM: "someone@gmail.com" }, { EMAIL_DELIVERY_MODE: "disabled" }, { EMAIL_ALLOWED_RECIPIENTS: "other@example.invalid" }]) await expect(createAuthEmailSender({ ...env, ...change }, send)(mail)).rejects.toBeInstanceOf(EmailDeliveryError);
    expect(send).not.toHaveBeenCalled();
  });
  it("does not reveal raw provider failure details", async () => {
    const send = vi.fn().mockRejectedValue(new Error("sensitive upstream body"));
    await expect(createAuthEmailSender(env, send)(mail)).rejects.toThrow("Email delivery unavailable"); expect(send).toHaveBeenCalledTimes(2);
  });
});
