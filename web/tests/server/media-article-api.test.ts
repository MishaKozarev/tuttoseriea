import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ access: vi.fn(), attach: vi.fn(), root: vi.fn(), save: vi.fn(), normalize: vi.fn(), query: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/src/articles/access", () => ({ requireArticleDraftAccess: mocks.access, requireArticleActor: vi.fn() }));
vi.mock("@/src/media/storage", async importOriginal => ({ ...await importOriginal<typeof import("@/src/media/storage")>(), mediaRoot: mocks.root, saveArticleImageFile: mocks.save }));
vi.mock("@/src/media/image", async importOriginal => ({ ...await importOriginal<typeof import("@/src/media/image")>(), normalizeArticleImage: mocks.normalize }));
vi.mock("@/src/media/repository", () => ({ attachArticleDraftImage: mocks.attach, findLinkedAvatar: vi.fn(), findArticleDraftImage: vi.fn() }));
vi.mock("@/src/db", () => ({ getDbPool: () => ({ query: mocks.query }) }));
vi.mock("@/src/auth/config", () => ({ getAuthConfig: () => ({ secret: "synthetic-media-article-secret-not-used-for-requests" }) }));

import { ApplicationError } from "@/src/api/errors";
import { ArticleError } from "@/src/articles/contract";
import { PRIVATE_MEDIA_CACHE } from "@/src/media/errors";
import { POST, GET, OPTIONS } from "@/app/api/admin/articles/[articleId]/images/route";

const articleId = "bd996433-5bfa-41a7-883f-f55f4d9e9803";
const imageId = "be996433-5bfa-41a7-883f-f55f4d9e9803";
const origin = "https://fixture.invalid";
const asset = { id: imageId, kind: "article_image", storageKey: `${imageId}.webp`, mimeType: "image/webp", byteSize: 3, width: 2048, height: 1024, sha256: "a".repeat(64), uploaderAccountId: "writer" };
const image = { id: imageId, url: `/media/private/${imageId}.webp`, width: 2048, height: 1024, byteSize: 3 };
const context = { params: Promise.resolve({ articleId }) };
function upload(headers: Record<string, string> = {}, body: BodyInit = new Uint8Array([1, 2, 3]), suffix = "") {
  return new Request(`${origin}/api/admin/articles/${articleId}/images${suffix}`, { method: "POST", headers: {
    origin, "content-type": "image/png", "x-article-revision": "1", "x-operation-id": articleId, ...headers,
  }, body });
}
beforeEach(() => {
  vi.resetAllMocks(); vi.stubEnv("AUTH_URL", origin);
  mocks.access.mockResolvedValue({ accountId: "writer", authUserId: "auth", sessionToken: "trusted", manageAll: false });
  mocks.query.mockResolvedValue({ rows: [{ count: 1 }] });
  mocks.root.mockResolvedValue("validated-root"); mocks.normalize.mockResolvedValue({ bytes: Buffer.from([1, 2, 3]) });
  mocks.save.mockResolvedValue(asset); mocks.attach.mockResolvedValue({ result: image, revision: 2 });
});

describe("Draft image upload boundary", () => {
  it.each([["UNAUTHORIZED", 401], ["ARTICLE_NOT_FOUND", 404]] as const)("checks session and exact Article access before touching body (%s)", async (code, status) => {
    mocks.access.mockRejectedValue(new ApplicationError({ code, status, message: "Unavailable" }));
    const request = upload(); const body = vi.spyOn(request, "body", "get");
    const response = await POST(request, context);
    expect(response.status).toBe(status); expect(mocks.access).toHaveBeenCalledWith(articleId);
    expect(body).not.toHaveBeenCalled(); expect(mocks.root).not.toHaveBeenCalled(); expect(mocks.query).not.toHaveBeenCalled();
    expect(response.headers.get("cache-control")).toBe(PRIVATE_MEDIA_CACHE);
  });
  it.each([{ origin: "https://evil.invalid" }, { "sec-fetch-site": "cross-site" }, { "content-type": "image/svg+xml" }, { "x-article-revision": "-1" }, { "x-operation-id": "invalid" }] as Record<string, string>[])("rejects unsafe headers before reading body %j", async headers => {
    const request = upload(headers); const body = vi.spyOn(request, "body", "get");
    expect((await POST(request, context)).status).toBeGreaterThanOrEqual(400);
    expect(body).not.toHaveBeenCalled(); expect(mocks.save).not.toHaveBeenCalled();
  });
  it("does not accept query aliases or trust Content-Length to bound streamed bytes", async () => {
    expect((await POST(upload({}, undefined, "?x=1"), context)).status).toBe(400);
    const response = await POST(upload({ "content-length": "1" }, new Uint8Array(5 * 1024 * 1024 + 1)), context);
    expect(response.status).toBe(413); expect((await response.json()).error.code).toBe("MEDIA_TOO_LARGE");
    expect(mocks.normalize).not.toHaveBeenCalled(); expect(mocks.save).not.toHaveBeenCalled();
  });
  it("checks shared rate limit and storage before reading the body", async () => {
    mocks.query.mockResolvedValueOnce({ rows: [] });
    const limited = upload(); const limitedBody = vi.spyOn(limited, "body", "get");
    expect((await POST(limited, context)).status).toBe(429); expect(limitedBody).not.toHaveBeenCalled();
    mocks.root.mockRejectedValueOnce(new ApplicationError({ code: "MEDIA_STORAGE_UNAVAILABLE", status: 503, message: "Unavailable" }));
    const unmounted = upload(); const unmountedBody = vi.spyOn(unmounted, "body", "get");
    expect((await POST(unmounted, context)).status).toBe(503); expect(unmountedBody).not.toHaveBeenCalled();
  });
  it("saves an immutable file before the revalidated Article transaction and returns only its image plus revision", async () => {
    const order: string[] = [];
    mocks.save.mockImplementationOnce(async () => { order.push("durable-file"); return asset; });
    mocks.attach.mockImplementationOnce(async input => {
      order.push("metadata-and-link");
      expect(input).toEqual({ articleId, expectedRevision: 1, operationId: articleId, asset });
      return { result: image, revision: 2 };
    });
    const response = await POST(upload(), context);
    expect(response.status).toBe(200); expect(await response.json()).toEqual({ image, revision: 2 });
    expect(order).toEqual(["durable-file", "metadata-and-link"]);
    expect(response.headers.get("cache-control")).toBe(PRIVATE_MEDIA_CACHE);
    expect(response.headers.get("cloudflare-cdn-cache-control")).toBe("no-store");
  });
  it("does not insert metadata after file failure, and returns conflict safely after a saved orphan", async () => {
    mocks.save.mockRejectedValueOnce(new ApplicationError({ code: "MEDIA_STORAGE_UNAVAILABLE", status: 503, message: "Unavailable" }));
    expect((await POST(upload(), context)).status).toBe(503); expect(mocks.attach).not.toHaveBeenCalled();
    mocks.attach.mockRejectedValueOnce(new ArticleError("ARTICLE_CONFLICT", 409, "Reload"));
    const response = await POST(upload(), context);
    expect(response.status).toBe(409); expect((await response.json()).error.code).toBe("ARTICLE_CONFLICT");
    expect(response.headers.get("cloudflare-cdn-cache-control")).toBe("no-store"); expect(mocks.save).toHaveBeenCalledTimes(2);
  });
  it("rejects unsupported methods with explicit no-store", async () => {
    for (const method of [GET, OPTIONS]) {
      const response = method(new Request(`${origin}/api/admin/articles/${articleId}/images`));
      expect(response.status).toBe(405); expect(response.headers.get("cloudflare-cdn-cache-control")).toBe("no-store");
    }
    expect(mocks.access).not.toHaveBeenCalled();
  });
});
