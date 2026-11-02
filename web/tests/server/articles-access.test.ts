import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StaffSecurity, StaffSession } from "@/src/auth/security-store";

const mocks = vi.hoisted(() => ({ actor: vi.fn(), identity: vi.fn(), current: vi.fn(), user: vi.fn(), lock: vi.fn(), query: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/src/auth/session", () => ({ getStaffMutationActor: mocks.actor }));
vi.mock("@/src/identity/session", () => ({ getCurrentIdentityAccess: mocks.current }));
vi.mock("@/src/identity/repository", () => ({ getIdentityAccessByAuthUserId: mocks.identity }));
vi.mock("@/src/auth/config", () => ({ getAuthConfig: () => ({ secret: "synthetic-unit-fixture" }) }));
vi.mock("@/src/db", () => ({ getDbPool: () => ({ query: mocks.query }) }));
vi.mock("@/src/auth/security-store", async importOriginal => ({
  ...await importOriginal<typeof import("@/src/auth/security-store")>(),
  AuthSecurityStore: class { lock = mocks.lock; user = mocks.user; },
}));

import { getArticlesAccess, requireArticleActor, requireArticleDraftAccess, revalidateArticleActor, type ArticleActor } from "@/src/articles/access";
const id = "5e03d92b-cf69-4288-8e43-6a02e9340497";
const actor: ArticleActor = { sessionToken: "synthetic", accountId: "writer", authUserId: "user", manageAll: false };
const identity = { accountId: "writer", authUserId: "user", status: "active", roles: ["writer"] };
let user: StaffSecurity;
let session: StaffSession;
beforeEach(() => {
  vi.resetAllMocks();
  user = { userId: "user", accountId: "writer", email: "writer@example.invalid", status: "active", roles: ["writer"],
    securityRevision: 2, twoFactorEnabled: false, totpVerified: false, emailVerified: false };
  session = { id: "session", userId: "user", securityRevision: 2, mfaVerifiedAt: null, createdAt: new Date() };
  mocks.actor.mockResolvedValue(actor); mocks.identity.mockResolvedValue(identity);
  mocks.current.mockResolvedValue({ authenticated: true, identityAccess: identity, mfaRequired: false });
  mocks.user.mockImplementation(async () => user); mocks.query.mockImplementation(async () => ({ rows: [session] }));
});

describe("Article access uses current Identity permissions", () => {
  it.each([{ roles: ["writer"] }, { roles: ["writer", "admin"] }, { roles: ["super_admin"] }])("allows drafts independently of publish-own for %j", async ({ roles }) => {
    mocks.identity.mockResolvedValue({ ...identity, roles });
    expect(await requireArticleActor()).toMatchObject({ accountId: "writer", manageAll: roles.includes("super_admin") });
  });
  it.each([{ roles: [] }, { roles: ["admin"] }])("denies accounts without Article permission for %j", async ({ roles }) => {
    mocks.identity.mockResolvedValue({ ...identity, roles });
    await expect(requireArticleActor()).rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });
  });
  it("fails closed for missing full session and disabled current Identity", async () => {
    mocks.actor.mockResolvedValue(null);
    await expect(requireArticleActor()).rejects.toMatchObject({ code: "UNAUTHORIZED", status: 401 });
    mocks.actor.mockResolvedValue(actor); mocks.identity.mockResolvedValue({ ...identity, status: "disabled" });
    await expect(requireArticleActor()).rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });
  });
  it("returns page redirect/forbidden decisions without exposing a draft", async () => {
    mocks.current.mockResolvedValue({ authenticated: false, identityAccess: null });
    expect(await getArticlesAccess()).toMatchObject({ type: "redirect" });
    mocks.current.mockResolvedValue({ authenticated: true, identityAccess: { ...identity, roles: ["admin"] }, mfaRequired: false });
    expect(await getArticlesAccess()).toEqual({ type: "forbidden" });
    mocks.current.mockResolvedValue({ authenticated: true, identityAccess: { ...identity, roles: ["super_admin"] }, mfaRequired: true });
    expect(await getArticlesAccess()).toMatchObject({ type: "redirect", location: expect.stringContaining("/admin/login/two-factor") });
  });
  it("checks ownership before a body is accepted, returning the same missing response", async () => {
    mocks.query.mockResolvedValue({ rows: [] });
    await expect(requireArticleDraftAccess(id)).rejects.toMatchObject({ code: "ARTICLE_NOT_FOUND", status: 404 });
    expect(mocks.query.mock.calls[0][1]).toEqual([id, false, "writer"]);
  });
});

describe("Article transaction revalidation", () => {
  it("waits on the shared canonical user lock before reading fresh authority", async () => {
    const order: string[] = [];
    mocks.lock.mockImplementation(async () => { order.push("lock"); user.roles = ["admin"]; });
    mocks.user.mockImplementation(async () => { order.push("user"); return user; });
    await expect(revalidateArticleActor({ query: mocks.query }, actor)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(order).toEqual(["lock", "user"]); expect(mocks.lock).toHaveBeenCalledWith("user");
    expect(mocks.query.mock.calls[0][0]).toContain("expires_at>clock_timestamp()");
  });
  it.each(["session-revoked", "security-revision", "disabled", "identity-mismatch"])("rejects stale authority after lock waiting: %s", async reason => {
    if (reason === "session-revoked") mocks.query.mockResolvedValue({ rows: [] });
    if (reason === "security-revision") user.securityRevision++;
    if (reason === "disabled") user.status = "disabled";
    if (reason === "identity-mismatch") user.accountId = "foreign";
    await expect(revalidateArticleActor({ query: mocks.query }, actor)).rejects.toMatchObject({ code: "UNAUTHORIZED", status: 401 });
  });
  it("requires persisted MFA for combined Super Admin/Writer roles", async () => {
    user.roles = ["writer", "super_admin"]; user.twoFactorEnabled = true; user.totpVerified = true;
    await expect(revalidateArticleActor({ query: mocks.query }, actor)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    session.mfaVerifiedAt = new Date();
    expect(await revalidateArticleActor({ query: mocks.query }, actor)).toMatchObject({ manageAll: true });
    user.totpVerified = false;
    await expect(revalidateArticleActor({ query: mocks.query }, actor)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
  it("does not trust a stale manageAll flag from before transaction entry", async () => {
    expect(await revalidateArticleActor({ query: mocks.query }, { ...actor, manageAll: true })).toMatchObject({ manageAll: false });
  });
});
