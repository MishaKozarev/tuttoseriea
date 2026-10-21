import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ session: vi.fn(), query: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/src/identity/session", () => ({ getCurrentIdentityAccess: mocks.session }));
vi.mock("@/src/db", () => ({ getDbPool: () => ({ query: mocks.query }) }));
import { GET as articleList, POST as articleCreate } from "@/app/api/admin/articles/categories/route";
import { GET as newsList, POST as newsCreate } from "@/app/api/admin/news/categories/route";
import { PATCH, DELETE } from "@/app/api/admin/articles/categories/[id]/route";
import { GET as tagsList } from "@/app/api/admin/football/tags/route";
const origin = "https://fixture.invalid";
const row = { id: "category", name: "Category", revision: 0, created_at: "2026-10-21T00:00:00Z", updated_at: "2026-10-21T00:00:00Z" };
const request = (method: string, body: unknown, headers = {}) => new Request(`${origin}/api/admin/articles/categories`, {
  method, headers: { origin, "content-type": "application/json", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body),
});
const context = { params: Promise.resolve({ id: "category" }) };
beforeEach(() => {
  vi.resetAllMocks(); vi.stubEnv("AUTH_URL", origin);
  mocks.session.mockResolvedValue({ authenticated: true, mfaRequired: false, identityAccess: { accountId: "actor", roles: ["super_admin"] } });
  mocks.query.mockImplementation(async (sql: string) => ({ rows: sql.includes("filtered") ? [{ items: [], total: 0 }] : [row] }));
});
describe("Category and Football Tag HTTP boundaries", () => {
  it.each([null, [], ["writer"], ["admin"], ["writer", "admin"]])("denies unapproved roles before database access: %j", async roles => {
    mocks.session.mockResolvedValue(roles === null ? { authenticated: false, identityAccess: null } : { authenticated: true, mfaRequired: false, identityAccess: { accountId: "actor", roles } });
    for (const result of await Promise.all([articleList(new Request(`${origin}/api/admin/articles/categories`)), newsCreate(request("POST", { name: "Valid" })), tagsList(new Request(`${origin}/api/admin/football/tags`))])) {
      expect(result.status).toBe(roles === null ? 401 : 403);
      expect((await result.json()).error).toMatchObject({ code: roles === null ? "UNAUTHORIZED" : "FORBIDDEN", requestId: expect.any(String) });
    }
    expect(mocks.query).not.toHaveBeenCalled();
  });
  it("requires Super Admin MFA before reads and writes", async () => {
    mocks.session.mockResolvedValue({ authenticated: true, mfaRequired: true, identityAccess: { roles: ["super_admin"] } });
    expect((await articleCreate(request("POST", { name: "Valid" }))).status).toBe(401);
    expect((await tagsList(new Request(`${origin}/api/admin/football/tags`))).status).toBe(401);
    expect(mocks.query).not.toHaveBeenCalled();
  });
  it("keeps Article/News storage separate and replies uncached", async () => {
    for (const read of [articleList, newsList]) expect((await read(new Request(`${origin}/api/admin/articles/categories`))).headers.get("cache-control")).toBe("no-store");
    expect(mocks.query.mock.calls[0][0]).toContain("article.categories"); expect(mocks.query.mock.calls[1][0]).toContain("news.categories");
    expect((await articleCreate(request("POST", { name: "  Valid  " }))).status).toBe(201);
    expect(mocks.query.mock.calls.at(-1)?.[1][1]).toBe("Valid");
  });
  it.each([{ origin: "https://evil.invalid" }, { origin: "null" }, { "sec-fetch-site": "cross-site" }, { "content-type": "text/plain" }])("rejects unsafe mutation headers %j", async headers => {
    expect((await articleCreate(request("POST", { name: "Valid" }, headers))).status).toBe("content-type" in headers ? 415 : 403);
    expect(mocks.query).not.toHaveBeenCalled();
  });
  it.each(["{", "x".repeat(4097), { name: "   " }, { name: "Valid", role: "super_admin" }, { name: "Valid", id: "forged" }])("rejects malformed/oversized/overbroad input %#", async body => {
    const result = await articleCreate(request("POST", body)); expect(result.status).toBe(typeof body === "string" && body.length > 4096 ? 413 : 400);
    expect(mocks.query).not.toHaveBeenCalled();
  });
  it("requires deletion confirmation and a revision", async () => {
    expect((await DELETE(request("DELETE", { expectedRevision: 0 }), context)).status).toBe(400);
    expect((await PATCH(request("PATCH", { name: "Valid" }), context)).status).toBe(400);
    expect(mocks.query).not.toHaveBeenCalled();
    expect((await DELETE(request("DELETE", { expectedRevision: 0, confirmed: true }), context)).status).toBe(200);
  });
  it.each([["23505", "CATEGORY_NAME_CONFLICT"], ["23503", "CATEGORY_IN_USE"], ["23001", "CATEGORY_IN_USE"]])("maps PostgreSQL %s to safe 409 %s", async (code, expected) => {
    mocks.query.mockRejectedValueOnce({ code });
    const response = await DELETE(request("DELETE", { expectedRevision: 0, confirmed: true }), context);
    expect(response.status).toBe(409); expect((await response.json()).error.code).toBe(expected);
  });
  it("does not expose internal errors and rejects unsupported tag query kinds", async () => {
    mocks.query.mockRejectedValueOnce(new Error("private SQL fixture canary"));
    const response = await articleList(new Request(`${origin}/api/admin/articles/categories`));
    expect(response.status).toBe(500); expect(await response.text()).not.toContain("private SQL fixture canary");
    mocks.query.mockClear(); expect((await tagsList(new Request(`${origin}/api/admin/football/tags?kind=topic`))).status).toBe(400); expect(mocks.query).not.toHaveBeenCalled();
  });
});
