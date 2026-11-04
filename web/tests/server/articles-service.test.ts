import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ actor: vi.fn(), revalidate: vi.fn(), query: vi.fn(), release: vi.fn(),
  lockDraft: vi.fn(), receipt: vi.fn(), insertReceipt: vi.fn(), readDraft: vi.fn(), list: vi.fn(), insertDraft: vi.fn(), publication: vi.fn(), assignSlug: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/src/db", () => ({ getDbPool: () => ({ connect: async () => ({ query: mocks.query, release: mocks.release }) }) }));
vi.mock("@/src/articles/access", () => ({ requireArticleActor: mocks.actor, revalidateArticleActor: mocks.revalidate,
  articleNotFound: () => { throw Object.assign(new Error("Missing"), { code: "ARTICLE_NOT_FOUND", status: 404 }); } }));
vi.mock("@/src/articles/repository", () => ({ lockArticleDraft: mocks.lockDraft, readArticleReceipt: mocks.receipt,
  insertArticleReceipt: mocks.insertReceipt, readArticleDraft: mocks.readDraft, readArticleList: mocks.list, insertArticleDraft: mocks.insertDraft, readArticlePublication: mocks.publication, assignArticleDraftSlug: mocks.assignSlug }));

import { createArticleDraft, listArticleDrafts, saveArticleDraft, withArticleDraftWrite } from "@/src/articles/service";
const id = "5e03d92b-cf69-4288-8e43-6a02e9340497";
const operationId = "d5c45c78-e5cb-4862-b563-741b2a62bea1";
const operation = { operationId, fingerprint: "a".repeat(64) };
const actor = { accountId: "writer", authUserId: "user", sessionToken: "synthetic", manageAll: false };
beforeEach(() => {
  vi.resetAllMocks(); mocks.actor.mockResolvedValue(actor); mocks.revalidate.mockResolvedValue(actor);
  mocks.query.mockResolvedValue({ rows: [{ revision: 2 }] }); mocks.lockDraft.mockResolvedValue({ id, revision: 1 });
  mocks.receipt.mockResolvedValue(null); mocks.insertDraft.mockResolvedValue(id); mocks.readDraft.mockResolvedValue({ id, revision: 0 });
  mocks.publication.mockResolvedValue(null);
});

describe("Article aggregate transaction", () => {
  it("rejects a stale revision before metadata/link callback and rolls back", async () => {
    const callback = vi.fn();
    await expect(withArticleDraftWrite(id, 0, callback, operation)).rejects.toMatchObject({ code: "ARTICLE_CONFLICT", status: 409 });
    expect(callback).not.toHaveBeenCalled(); expect(mocks.insertReceipt).not.toHaveBeenCalled();
    expect(mocks.query.mock.calls.map(([sql]) => sql)).toContain("rollback"); expect(mocks.query.mock.calls.map(([sql]) => sql)).not.toContain("commit"); expect(mocks.release).toHaveBeenCalledOnce();
  });
  it("increments exactly once and records the image result in the same transaction", async () => {
    const callback = vi.fn(async (_client, current, revision) => { expect(current).toEqual(actor); expect(revision).toBe(2); return { id: "image" }; });
    expect(await withArticleDraftWrite(id, 1, callback, operation)).toEqual({ result: { id: "image" }, revision: 2 });
    expect(mocks.query.mock.calls.filter(([sql]) => sql.startsWith("update article.drafts"))).toHaveLength(1);
    expect(mocks.insertReceipt).toHaveBeenCalledWith(expect.anything(), operationId, expect.objectContaining({ articleId: id, actorAccountId: "writer", action: "image", result: { revision: 2, result: { id: "image" } } }));
    expect(mocks.query.mock.calls.at(-1)?.[0]).toBe("commit");
  });
  it("does not execute an upload callback or increment on an exact operation retry", async () => {
    mocks.receipt.mockResolvedValue({ actorAccountId: "writer", articleId: id, action: "image", fingerprint: operation.fingerprint, result: { revision: 2, result: { id: "existing-image" } } });
    mocks.lockDraft.mockResolvedValue({ id, revision: 8 });
    const callback = vi.fn();
    expect(await withArticleDraftWrite(id, 1, callback, operation)).toEqual({ result: { id: "existing-image" }, revision: 2 });
    expect(callback).not.toHaveBeenCalled(); expect(mocks.query.mock.calls.some(([sql]) => sql.startsWith("update article.drafts"))).toBe(false);
  });
  it.each(["actorAccountId", "articleId", "action", "fingerprint"])("rejects operation-ID reuse with changed %s", async key => {
    mocks.receipt.mockResolvedValue({ actorAccountId: "writer", articleId: id, action: "image", fingerprint: operation.fingerprint, result: { revision: 2 }, [key]: "different" });
    const callback = vi.fn();
    await expect(withArticleDraftWrite(id, 1, callback, operation)).rejects.toMatchObject({ code: "ARTICLE_OPERATION_CONFLICT", status: 409 });
    expect(callback).not.toHaveBeenCalled();
  });
  it("does not expose a foreign draft even when the operation receipt would match", async () => {
    mocks.lockDraft.mockResolvedValue(null);
    await expect(withArticleDraftWrite(id, 1, vi.fn(), operation)).rejects.toMatchObject({ code: "ARTICLE_NOT_FOUND" });
    expect(mocks.receipt).not.toHaveBeenCalled();
  });
  it("revalidates authority after operation-lock acquisition and before draft access", async () => {
    const order: string[] = [];
    mocks.query.mockImplementation(async (sql: string) => { if (sql.includes("advisory")) order.push("operation-lock"); return { rows: [{ revision: 2 }] }; });
    mocks.revalidate.mockImplementation(async () => { order.push("auth-lock-and-recheck"); throw Object.assign(new Error("Revoked"), { code: "UNAUTHORIZED" }); });
    await expect(withArticleDraftWrite(id, 1, vi.fn(), operation)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(order).toEqual(["operation-lock", "auth-lock-and-recheck"]); expect(mocks.lockDraft).not.toHaveBeenCalled(); expect(mocks.query.mock.calls.at(-1)?.[0]).toBe("rollback");
  });
  it("rolls back revision, metadata and receipt when callback fails", async () => {
    mocks.insertReceipt.mockRejectedValue(new Error("receipt write failed"));
    const callback = vi.fn(async () => ({ id: "new-image" }));
    await expect(withArticleDraftWrite(id, 1, callback, operation)).rejects.toThrow("receipt write failed");
    expect(callback).toHaveBeenCalledOnce(); expect(mocks.query.mock.calls.at(-1)?.[0]).toBe("rollback");
  });
  it("rejects an attached avatar asset as a body image and rolls back the draft", async () => {
    const avatarId = "f93b40ca-e103-4d84-86a5-917064bedb88";
    mocks.query.mockImplementation(async (sql: string) => {
      if (sql.includes("from article.draft_images")) {
        // The retained association points to an avatar. Only a purpose-filtered
        // lookup may treat it as unavailable for Article content.
        return { rows: sql.includes("join media.assets") && sql.includes("m.kind='article_image'") ? [] : [{ media_id: avatarId }] };
      }
      return { rows: [{ revision: 2 }] };
    });
    await expect(saveArticleDraft(id, { operationId, expectedRevision: 1, formatVersion: 1,
      content: { type: "doc", content: [{ type: "articleImage", attrs: { assetId: avatarId } }] },
      h1: "", seoTitle: "", metaDescription: "", slug: "", categoryIds: [], tagIds: [],
    })).rejects.toMatchObject({ code: "ARTICLE_IMAGE_NOT_ATTACHED", status: 400 });
    expect(mocks.insertReceipt).not.toHaveBeenCalled();
    expect(mocks.query.mock.calls.some(([sql]) => sql.includes("set format_version="))).toBe(false);
    expect(mocks.query.mock.calls.at(-1)?.[0]).toBe("rollback");
  });
  it("allows only own scope after a Super Admin permission is revoked before transaction entry", async () => {
    mocks.actor.mockResolvedValue({ ...actor, manageAll: true });
    await expect(listArticleDrafts({ page: 1, scope: "all" })).rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });
    expect(mocks.list).not.toHaveBeenCalled();
    await listArticleDrafts({ page: 1 });
    expect(mocks.list).toHaveBeenCalledWith(expect.anything(), actor, 1, "own");
  });
  it("creates one immutable identity and binds its receipt to the current account", async () => {
    const draft = await createArticleDraft({ operationId });
    expect(draft).toEqual({ id, revision: 0 });
    expect(mocks.insertDraft).toHaveBeenCalledWith(expect.anything(), "writer", expect.objectContaining({ type: "doc" }));
    expect(mocks.insertReceipt).toHaveBeenCalledWith(expect.anything(), operationId, expect.objectContaining({ articleId: id, actorAccountId: "writer", action: "create", result: { revision: 0 } }));
  });
});
