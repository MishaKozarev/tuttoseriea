import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ actor: vi.fn(), attach: vi.fn(), root: vi.fn(), save: vi.fn(), read: vi.fn(), find: vi.fn(), normalize: vi.fn(), query: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/src/identity/writer-service", () => ({ requireOwnWriterAccess: mocks.actor, attachOwnAvatar: mocks.attach }));
vi.mock("@/src/media/storage", async importOriginal => ({ ...await importOriginal<typeof import("@/src/media/storage")>(), mediaRoot: mocks.root, saveAvatarFile: mocks.save, readAvatarFile: mocks.read }));
vi.mock("@/src/media/image", async importOriginal => ({ ...await importOriginal<typeof import("@/src/media/image")>(), normalizeAvatar: mocks.normalize }));
vi.mock("@/src/media/repository", () => ({ findLinkedAvatar: mocks.find }));
vi.mock("@/src/db", () => ({ getDbPool: () => ({ query: mocks.query }) }));
vi.mock("@/src/auth/config", () => ({ getAuthConfig: () => ({ secret: "synthetic-media-test-secret-not-used-for-requests" }) }));
import { ApplicationError } from "@/src/api/errors";
import { PRIVATE_MEDIA_CACHE, PUBLIC_MEDIA_CACHE } from "@/src/media/errors";
import { POST } from "@/app/api/admin/profile/avatar/route";
import { GET as publicGet, HEAD as publicHead, POST as publicPost } from "@/app/media/public/[filename]/route";
import { GET as privateGet } from "@/app/media/private/[filename]/route";

const id = "bd996433-5bfa-41a7-883f-f55f4d9e9803";
const origin = "https://fixture.invalid";
const asset = { id, storageKey: `${id}.webp`, mimeType: "image/webp", byteSize: 3, width: 1, height: 1, sha256: "a".repeat(64), uploaderAccountId: "writer" };
const context = { params: Promise.resolve({ filename: `${id}.webp` }) };
function upload(headers: Record<string, string> = {}, body: BodyInit = new Uint8Array([1,2,3])) {
  return new Request(`${origin}/api/admin/profile/avatar`, { method: "POST", headers: { origin, "content-type": "image/png", "x-profile-revision": "1", "x-operation-id": id, ...headers }, body });
}
beforeEach(() => {
  vi.resetAllMocks(); vi.stubEnv("AUTH_URL", origin);
  mocks.actor.mockResolvedValue({ accountId: "writer", authUserId: "auth", sessionToken: "trusted" });
  mocks.query.mockResolvedValue({ rows: [{ count: 1 }] });
  mocks.root.mockResolvedValue("validated-root"); mocks.normalize.mockResolvedValue({ bytes: Buffer.from([1,2,3]) }); mocks.save.mockResolvedValue(asset);
  mocks.attach.mockResolvedValue({ accountId: "writer", avatarMediaId: id, revision: 2 });
  mocks.find.mockResolvedValue(asset); mocks.read.mockResolvedValue(Buffer.from([1,2,3]));
});

describe("Avatar upload boundary", () => {
  it("authorizes before reading body, accessing storage or inserting metadata", async () => {
    mocks.actor.mockRejectedValue(new ApplicationError({ code: "UNAUTHORIZED", status: 401, message: "Login required" }));
    const request = upload(); const body = vi.spyOn(request, "body", "get");
    const result = await POST(request);
    expect(result.status).toBe(401); expect(body).not.toHaveBeenCalled(); expect(mocks.root).not.toHaveBeenCalled(); expect(mocks.query).not.toHaveBeenCalled();
  });
  it.each([{ origin: "https://evil.invalid" }, { "sec-fetch-site": "cross-site" }, { "content-type": "image/svg+xml" }, { "x-profile-revision": "-1" }, { "x-operation-id": "not-uuid" }] as Record<string, string>[])("rejects unsafe headers before body %j", async headers => {
    const request = upload(headers); const body = vi.spyOn(request, "body", "get");
    expect((await POST(request)).status).toBeGreaterThanOrEqual(400); expect(body).not.toHaveBeenCalled(); expect(mocks.save).not.toHaveBeenCalled();
  });
  it("checks streamed bytes even when Content-Length lies", async () => {
    const response = await POST(upload({ "content-length": "1" }, new Uint8Array(5 * 1024 * 1024 + 1)));
    expect(response.status).toBe(413); expect((await response.json()).error.code).toBe("MEDIA_TOO_LARGE"); expect(mocks.normalize).not.toHaveBeenCalled();
  });
  it("checks atomic shared upload rate limit before reading body", async () => {
    mocks.query.mockResolvedValue({ rows: [] });
    const request = upload(); const body = vi.spyOn(request, "body", "get");
    expect((await POST(request)).status).toBe(429); expect(body).not.toHaveBeenCalled();
  });
  it("saves bytes before transactional metadata and CAS binding", async () => {
    const order: string[] = [];
    mocks.save.mockImplementation(async () => { order.push("durable-file"); return asset; });
    mocks.attach.mockImplementation(async input => { order.push("metadata-and-link"); expect(input).toMatchObject({ actor: { accountId: "writer" }, asset, expectedRevision: 1, operationId: id }); return { revision: 2 }; });
    const response = await POST(upload());
    expect(response.status).toBe(200); expect(await response.json()).toEqual({ profile: { revision: 2 } }); expect(order).toEqual(["durable-file", "metadata-and-link"]);
    expect(response.headers.get("cache-control")).toBe(PRIVATE_MEDIA_CACHE);
  });
  it("does not create DB metadata on file failure or delete an orphan on DB conflict", async () => {
    mocks.save.mockRejectedValueOnce(new ApplicationError({ code: "MEDIA_STORAGE_UNAVAILABLE", status: 503, message: "Unavailable" }));
    expect((await POST(upload())).status).toBe(503); expect(mocks.attach).not.toHaveBeenCalled();
    mocks.attach.mockRejectedValueOnce(new ApplicationError({ code: "WRITER_CONFLICT", status: 409, message: "Reload" }));
    expect((await POST(upload())).status).toBe(409); expect(mocks.save).toHaveBeenCalledTimes(2);
  });
});

describe("Avatar delivery authorization and cache", () => {
  it("uses only public links for public GET, independently of cookies or disabled login state", async () => {
    mocks.actor.mockRejectedValue(new Error("Must not use session"));
    const response = await publicGet(new Request(`${origin}/media/public/${id}.webp`, { headers: { cookie: "synthetic=ignored" } }), context);
    expect(response.status).toBe(200); expect(mocks.actor).not.toHaveBeenCalled(); expect(mocks.find).toHaveBeenCalledWith(id, undefined);
    expect(response.headers.get("cache-control")).toBe(PUBLIC_MEDIA_CACHE);
    expect(response.headers.get("cloudflare-cdn-cache-control")).toBe("public, max-age=3600, must-revalidate");
    expect(response.headers.get("content-type")).toBe("image/webp"); expect(response.headers.get("set-cookie")).toBeNull();
  });
  it("requires own current link for private GET and keeps it out of shared cache", async () => {
    const response = await privateGet(new Request(`${origin}/media/private/${id}.webp`), context);
    expect(response.status).toBe(200); expect(mocks.actor).toHaveBeenCalled(); expect(mocks.find).toHaveBeenCalledWith(id, "writer");
    expect(response.headers.get("cache-control")).toBe(PRIVATE_MEDIA_CACHE); expect(response.headers.get("cloudflare-cdn-cache-control")).toBe("no-store");
  });
  it("HEAD enforces the same link and storage checks without a body", async () => {
    const response = await publicHead(new Request(`${origin}/media/public/${id}.webp`, { method: "HEAD" }), context);
    expect(response.status).toBe(200); expect(response.headers.get("content-length")).toBe("3"); expect(await response.text()).toBe(""); expect(mocks.read).toHaveBeenCalled();
  });
  it("rejects all unlinked files before reading disk, even with a valid private cookie", async () => {
    mocks.find.mockResolvedValue(null);
    for (const [get, scope] of [[publicGet, "public"], [privateGet, "private"]] as const) {
      const response = await get(new Request(`${origin}/media/${scope}/${id}.webp`), context);
      expect(response.status).toBe(404); expect(response.headers.get("cloudflare-cdn-cache-control")).toBe("no-store");
    }
    expect(mocks.read).not.toHaveBeenCalled();
  });
  it.each([`/media/public/${id}.webp?version=1`, `/media/public/${id.toUpperCase()}.webp`, `/media/public/%62d996433-5bfa-41a7-883f-f55f4d9e9803.webp`])("does not cache noncanonical variants %s", async pathname => {
    const response = await publicGet(new Request(`${origin}${pathname}`), context);
    expect(response.status).toBe(404); expect(response.headers.get("cache-control")).toBe(PRIVATE_MEDIA_CACHE); expect(mocks.find).not.toHaveBeenCalled();
  });
  it("never gives errors, partial responses or unsupported methods public cache headers", async () => {
    const range = await publicGet(new Request(`${origin}/media/public/${id}.webp`, { headers: { range: "bytes=0-1" } }), context);
    expect(range.status).toBe(404); expect(range.headers.get("cache-control")).toBe(PRIVATE_MEDIA_CACHE);
    const post = publicPost(new Request(`${origin}/media/public/${id}.webp`, { method: "POST" }));
    expect(post.status).toBe(405); expect(post.headers.get("cloudflare-cdn-cache-control")).toBe("no-store");
    mocks.read.mockRejectedValue(new Error("private filesystem path"));
    const error = await publicGet(new Request(`${origin}/media/public/${id}.webp`), context);
    expect(error.status).toBe(500); expect(error.headers.get("cloudflare-cdn-cache-control")).toBe("no-store"); expect(await error.text()).not.toContain("private filesystem path");
  });
});
