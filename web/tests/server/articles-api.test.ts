import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ actor: vi.fn(), draftAccess: vi.fn(), list: vi.fn(), create: vi.fn(), get: vi.fn(), save: vi.fn(), categories: vi.fn(), tags: vi.fn(), publish: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/src/articles/access", () => ({ requireArticleActor: mocks.actor, requireArticleDraftAccess: mocks.draftAccess, requireArticlePublicationAccess: mocks.draftAccess }));
vi.mock("@/src/articles/service", () => ({ listArticleDrafts: mocks.list, createArticleDraft: mocks.create,
  getArticleDraft: mocks.get, saveArticleDraft: mocks.save, lookupArticleCategories: mocks.categories, lookupArticleTags: mocks.tags, publishArticleDraft: mocks.publish }));

import { GET as list, POST as create } from "@/app/api/admin/articles/route";
import { GET as get, PATCH as save } from "@/app/api/admin/articles/[articleId]/route";
import { GET as categories } from "@/app/api/admin/articles/options/categories/route";
import { GET as tags } from "@/app/api/admin/articles/options/tags/route";
import { POST as publish } from "@/app/api/admin/articles/[articleId]/publication/route";
import { ApplicationError } from "@/src/api/errors";
import { ArticleError, ARTICLE_MAX_BODY_BYTES } from "@/src/articles/contract";

const origin = "https://articles-fixture.invalid";
const id = "5e03d92b-cf69-4288-8e43-6a02e9340497";
const context = { params: Promise.resolve({ articleId: id }) };
const request = (method: string, body: unknown, headers: Record<string, string> = {}, query = "") => new Request(`${origin}/api/admin/articles${query}`, {
  method, headers: { origin, "content-type": "application/json", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body),
});
beforeEach(() => {
  vi.resetAllMocks(); vi.stubEnv("AUTH_URL", origin);
  mocks.actor.mockResolvedValue({ accountId: "writer", authUserId: "writer-user", sessionToken: "synthetic", manageAll: false });
  mocks.draftAccess.mockResolvedValue({ accountId: "writer", manageAll: false });
  mocks.list.mockResolvedValue({ items: [], page: 1, total: 0, totalPages: 0 });
  mocks.create.mockResolvedValue({ id, revision: 0 }); mocks.get.mockResolvedValue({ id, revision: 2 }); mocks.save.mockResolvedValue({ id, revision: 3 });
  mocks.categories.mockResolvedValue({ items: [], total: 0, page: 1, totalPages: 0 }); mocks.tags.mockResolvedValue({ items: [], total: 0, page: 1, totalPages: 0 });
});

describe("Article HTTP boundaries", () => {
  it("protects publication ownership, Origin and no-store error envelopes", async () => {
    mocks.draftAccess.mockRejectedValueOnce(new ApplicationError({ code: "ARTICLE_NOT_FOUND", status: 404, message: "Missing" }));
    const req = request("POST", "not JSON"), read = vi.spyOn(req.body!, "getReader");
    expect((await publish(req, context)).status).toBe(404); expect(read).not.toHaveBeenCalled();
    expect((await publish(request("POST", {}, { origin: "https://foreign.invalid" }), context)).status).toBe(403);
    expect(mocks.publish).not.toHaveBeenCalled();
    const input = { action: "publish", operationId: id, expectedRevision: 1, expectedPublicationRevision: 0 };
    mocks.publish.mockResolvedValue({ id, revision: 1, publication: { revision: 1 } });
    const response = await publish(request("POST", input), context);
    expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("no-store");
    expect(mocks.publish).toHaveBeenCalledWith(id, input);
    mocks.publish.mockRejectedValue(new ArticleError("ARTICLE_CONFLICT", 409, "Conflict"));
    const conflict = await publish(request("POST", input), context);
    expect(conflict.status).toBe(409); expect((await conflict.json()).error).toMatchObject({ code: "ARTICLE_CONFLICT", requestId: expect.any(String) });
  });
  it("denies a Writer without publication permission before reading malformed publication JSON", async () => {
    mocks.draftAccess.mockRejectedValue(new ApplicationError({ code: "FORBIDDEN", status: 403, message: "Denied" }));
    const req = request("POST", "malformed JSON"), read = vi.spyOn(req.body!, "getReader");
    const response = await publish(req, context);
    expect(response.status).toBe(403); expect(read).not.toHaveBeenCalled(); expect(mocks.publish).not.toHaveBeenCalled();
  });
  it.each([401, 403])("denies collection access before reading a body (%i)", async status => {
    mocks.actor.mockRejectedValue(new ApplicationError({ code: status === 401 ? "UNAUTHORIZED" : "FORBIDDEN", status, message: "Denied" }));
    const req = request("POST", "not JSON"), read = vi.spyOn(req.body!, "getReader");
    const response = await create(req);
    expect(response.status).toBe(status); expect(response.headers.get("cache-control")).toBe("no-store");
    expect((await response.json()).error.requestId).toBeTruthy(); expect(read).not.toHaveBeenCalled(); expect(mocks.create).not.toHaveBeenCalled();
    expect((await list(new Request(`${origin}/api/admin/articles`))).status).toBe(status); expect(mocks.list).not.toHaveBeenCalled();
  });
  it("denies a foreign/missing draft before reading or saving its content", async () => {
    mocks.draftAccess.mockRejectedValue(new ApplicationError({ code: "ARTICLE_NOT_FOUND", status: 404, message: "Missing" }));
    const req = request("PATCH", "not JSON"), read = vi.spyOn(req.body!, "getReader");
    expect((await save(req, context)).status).toBe(404); expect(read).not.toHaveBeenCalled(); expect(mocks.save).not.toHaveBeenCalled();
    expect((await get(new Request(`${origin}/api/admin/articles/${id}`), context)).status).toBe(404); expect(mocks.get).not.toHaveBeenCalled();
  });
  it.each<Record<string, string>>([{ origin: "https://foreign.invalid" }, { "sec-fetch-site": "cross-site" }, { "content-type": "text/plain" }])("rejects unsafe mutation headers %j", async headers => {
    expect((await create(request("POST", { operationId: id }, headers))).status).toBe("content-type" in headers ? 415 : 403);
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it("measures actual bytes and does not trust a small Content-Length", async () => {
    const response = await create(request("POST", "x".repeat(ARTICLE_MAX_BODY_BYTES + 1), { "content-length": "1" }));
    expect(response.status).toBe(413); expect((await response.json()).error.code).toBe("ARTICLE_TOO_LARGE"); expect(mocks.create).not.toHaveBeenCalled();
  });
  it("rejects malformed UTF-8 rather than storing replacement characters", async () => {
    const req = new Request(`${origin}/api/admin/articles`, { method: "POST", headers: { origin, "content-type": "application/json" }, body: new Uint8Array([0x22, 0xc0, 0xaf, 0x22]) });
    expect((await create(req)).status).toBe(400); expect(mocks.create).not.toHaveBeenCalled();
  });
  it("rejects malformed JSON and query injection before mutation", async () => {
    expect((await create(request("POST", "{"))).status).toBe(400);
    const req = request("PATCH", "not JSON", {}, "?authorAccountId=forged"), read = vi.spyOn(req.body!, "getReader");
    expect((await save(req, context)).status).toBe(400); expect(read).not.toHaveBeenCalled(); expect(mocks.save).not.toHaveBeenCalled();
  });
  it("validates duplicate/unknown list parameters and forwards explicit own scope", async () => {
    for (const query of ["page=1&page=2", "scope=foreign", "author=forged", "page=0"]) expect((await list(new Request(`${origin}/api/admin/articles?${query}`))).status).toBe(400);
    expect(mocks.list).not.toHaveBeenCalled();
    const response = await list(new Request(`${origin}/api/admin/articles?page=2&scope=own`));
    expect(response.status).toBe(200); expect(mocks.list).toHaveBeenCalledWith({ page: 2, scope: "own" });
  });
  it("returns the shared DTO envelopes and uncached reads/writes", async () => {
    const created = await create(request("POST", { operationId: id }));
    expect(created.status).toBe(201); expect(await created.json()).toEqual({ draft: { id, revision: 0 } });
    expect(await (await get(new Request(`${origin}/api/admin/articles/${id}`), context)).json()).toEqual({ draft: { id, revision: 2 } });
    const saved = await save(request("PATCH", { expectedRevision: 2 }), context);
    expect(await saved.json()).toEqual({ draft: { id, revision: 3 } }); expect(mocks.save).toHaveBeenCalledWith(id, { expectedRevision: 2 });
    for (const response of [created, saved]) { expect(response.headers.get("cache-control")).toBe("no-store"); expect(response.headers.get("x-request-id")).toBeTruthy(); }
  });
  it("protects narrow lookups independently and never calls management APIs", async () => {
    expect((await categories(new Request(`${origin}/api/admin/articles/options/categories?query=one&page=2`))).status).toBe(200);
    expect(mocks.categories.mock.calls[0][0].get("query")).toBe("one");
    expect((await tags(new Request(`${origin}/api/admin/articles/options/tags?kind=coaches`))).status).toBe(200);
    expect(mocks.tags.mock.calls[0][0].get("kind")).toBe("coaches");
    mocks.actor.mockRejectedValue(new ApplicationError({ code: "FORBIDDEN", status: 403, message: "Denied" }));
    expect((await tags(new Request(`${origin}/api/admin/articles/options/tags`))).status).toBe(403); expect(mocks.tags).toHaveBeenCalledTimes(1);
  });
  it("preserves domain conflict codes and hides unexpected private details", async () => {
    mocks.save.mockRejectedValue(new ArticleError("ARTICLE_CONFLICT", 409, "Reload"));
    const conflict = await save(request("PATCH", {}), context);
    expect(conflict.status).toBe(409); expect((await conflict.json()).error.code).toBe("ARTICLE_CONFLICT");
    mocks.create.mockRejectedValue(new Error("private DB canary"));
    const response = await create(request("POST", { operationId: id }));
    expect(response.status).toBe(500); expect(await response.text()).not.toContain("private DB canary");
  });
});
