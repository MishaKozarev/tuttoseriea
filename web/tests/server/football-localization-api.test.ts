import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ session: vi.fn(), list: vi.fn(), get: vi.fn(), edit: vi.fn(), pool: vi.fn(), log: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/src/identity/session", () => ({ getCurrentIdentityAccess: mocks.session }));
vi.mock("@/src/db", () => ({ getDbPool: mocks.pool }));
vi.mock("@/src/football/localization-repository", () => ({ FootballLocalizationRepository: class { list = mocks.list; get = mocks.get; edit = mocks.edit; } }));
vi.mock("@/src/logging/logger", () => ({ logger: { info: mocks.log, error: vi.fn() } }));

import { GET as LIST } from "@/app/api/admin/football/localization/route";
import { GET, PATCH } from "@/app/api/admin/football/localization/[kind]/[id]/route";
import { FootballLocalizationError } from "@/src/football/localization-management";
import { localizationFixture } from "../fixtures/football-localization";

const origin = "https://staging.example.invalid";
const entity = localizationFixture();
const url = `${origin}/api/admin/football/localization/clubs/${entity.id}`;
const context = { params: Promise.resolve({ kind: "clubs", id: entity.id }) };
const edit = { action: "save", nameRu: "Русское имя", expectedRevision: 0 };
function request(body: unknown = edit, headers: Record<string, string> = {}) {
  return new Request(url, { method: "PATCH", headers: { origin, "content-type": "application/json", "X-Request-ID": "localization-test", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body) });
}
beforeEach(() => {
  vi.resetAllMocks(); vi.stubEnv("AUTH_URL", origin);
  mocks.session.mockResolvedValue({ authenticated: true, mfaRequired: false, identityAccess: { accountId: "authorized-actor", authUserId: "user", email: null, roles: ["super_admin"] } });
  mocks.list.mockResolvedValue({ items: [entity], total: 1, page: 1, pageSize: 20, totalPages: 1 });
  mocks.get.mockResolvedValue(entity);
  mocks.edit.mockResolvedValue({ ...entity, nameRu: edit.nameRu, nameRuReviewStatus: "unreviewed", localizationRevision: 1 });
});
afterEach(() => vi.unstubAllEnvs());

describe("Football localization server boundary", () => {
  it.each([null, [], ["writer"], ["admin"], ["writer", "admin"]])("authorizes every read and write before repository access: %s", async (roles) => {
    mocks.session.mockResolvedValue(roles === null ? { authenticated: false, identityAccess: null }
      : { authenticated: true, mfaRequired: false, identityAccess: { accountId: "actor", roles } });
    const results = await Promise.all([LIST(new Request(`${origin}/api/admin/football/localization`)), GET(new Request(url), context), PATCH(request(), context)]);
    for (const result of results) {
      expect(result.status).toBe(roles === null ? 401 : 403);
      expect(result.headers.get("cache-control")).toBe("no-store");
      expect((await result.json()).error).toMatchObject({ code: roles === null ? "UNAUTHORIZED" : "FORBIDDEN", requestId: expect.any(String) });
    }
    expect(mocks.pool).not.toHaveBeenCalled(); expect(mocks.edit).not.toHaveBeenCalled();
  });
  it("uses validated filters and returns a bounded list", async () => {
    const result = await LIST(new Request(`${origin}/api/admin/football/localization?kind=players&query=Иван&status=missing&page=2`));
    expect(result.status).toBe(200);
    expect(mocks.list).toHaveBeenCalledWith({ kind: "players", query: "Иван", status: "missing", page: 2 });
  });
  it("saves unreviewed data with safe correlation and server Identity attribution", async () => {
    const response = await PATCH(request({ ...edit, nameRu: "  Русское имя  " }), context);
    expect(response.status).toBe(200); expect(response.headers.get("X-Request-ID")).toBe("localization-test");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(mocks.edit).toHaveBeenCalledWith("clubs", entity.id, edit);
    expect(mocks.log).toHaveBeenCalledWith("Football localization edited", expect.objectContaining({ context: expect.objectContaining({ actorAccountId: "authorized-actor" }) }));
  });
  it("reviews only after explicit confirmation", async () => {
    expect((await PATCH(request({ ...edit, action: "review" }), context)).status).toBe(400);
    expect(mocks.edit).not.toHaveBeenCalled();
    expect((await PATCH(request({ ...edit, action: "review", confirmed: true }), context)).status).toBe(200);
    expect(mocks.edit).toHaveBeenCalledWith("clubs", entity.id, expect.objectContaining({ action: "review", confirmed: true }));
  });
  it.each<Record<string, string>>([{ origin: "https://evil.invalid" }, { origin: "" }, { origin: "null" }, { "sec-fetch-site": "cross-site" }, { "content-type": "text/plain" }])("rejects unsafe mutation headers %s", async (headers) => {
    const response = await PATCH(request(edit, headers), context);
    expect(response.status).toBe("content-type" in headers ? 415 : 403); expect(mocks.edit).not.toHaveBeenCalled();
  });
  it.each(["{", "x".repeat(4097), { ...edit, nameRu: "   " }, { ...edit, slug: "new" }, { ...edit, provider_name: "new" }, { ...edit, actorAccountId: "spoof" }])("rejects malformed, oversized or overbroad input %#", async (body) => {
    const response = await PATCH(request(body), context);
    expect(response.status).toBe(typeof body === "string" && body.length > 4096 ? 413 : 400);
    expect(mocks.edit).not.toHaveBeenCalled();
  });
  it("returns a standard 409 instead of overwriting a newer revision", async () => {
    mocks.edit.mockRejectedValue(new FootballLocalizationError("LOCALIZATION_CONFLICT", 409, "Reload localization"));
    const response = await PATCH(request(), context);
    expect(response.status).toBe(409);
    expect((await response.json()).error).toMatchObject({ code: "LOCALIZATION_CONFLICT", requestId: "localization-test" });
  });
  it("fails closed when production has no trusted Admin origin", async () => {
    vi.stubEnv("NODE_ENV", "production"); vi.stubEnv("AUTH_URL", "");
    expect((await PATCH(request(), context)).status).toBe(500);
    expect(mocks.edit).not.toHaveBeenCalled();
  });
  it("rejects an oversized chunked body even with a false Content-Length", async () => {
    const response = await PATCH(request("x".repeat(4097), { "content-length": "1" }), context);
    expect(response.status).toBe(413); expect(mocks.edit).not.toHaveBeenCalled();
  });
  it("reads a single entity through the guarded GET boundary", async () => {
    const response = await GET(new Request(url), context);
    expect(response.status).toBe(200); expect(await response.json()).toEqual({ entity });
    expect(mocks.get).toHaveBeenCalledWith("clubs", entity.id); expect(mocks.edit).not.toHaveBeenCalled();
  });
  it("returns safe 404 and unexpected-error responses", async () => {
    mocks.get.mockResolvedValue(null);
    expect((await GET(new Request(url), context)).status).toBe(404);
    mocks.edit.mockRejectedValue(new Error("PRIVATE SQL DETAIL"));
    const response = await PATCH(request(), context);
    expect(response.status).toBe(500); expect(JSON.stringify(await response.json())).not.toContain("PRIVATE");
  });
  it.each(["page=0", "kind=seasons", "query=a&query=b", "limit=2000"])("rejects invalid list query %s", async (query) => {
    expect((await LIST(new Request(`${origin}/api/admin/football/localization?${query}`))).status).toBe(400);
    expect(mocks.list).not.toHaveBeenCalled();
  });
  it("rejects unsupported kinds and detail query parameters", async () => {
    expect((await GET(new Request(url), { params: Promise.resolve({ kind: "accounts", id: entity.id }) })).status).toBe(400);
    expect((await GET(new Request(url + "?revision=0"), context)).status).toBe(400);
    expect(mocks.get).not.toHaveBeenCalled();
  });
});
