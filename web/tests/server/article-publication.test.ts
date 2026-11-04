import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";

const mocks = vi.hoisted(() => ({ actor: vi.fn(), revalidate: vi.fn(), query: vi.fn(), release: vi.fn(),
  lockDraft: vi.fn(), receipt: vi.fn(), insertReceipt: vi.fn(), readDraft: vi.fn(), publication: vi.fn(), tags: vi.fn(), category: vi.fn(), assignSlug: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/src/db", () => ({ getDbPool: () => ({ connect: async () => ({ query: mocks.query, release: mocks.release }) }) }));
vi.mock("@/src/articles/access", () => ({ requireArticleActor: mocks.actor, revalidateArticleActor: mocks.revalidate,
  articleNotFound: () => { throw Object.assign(new Error("Missing"), { code: "ARTICLE_NOT_FOUND", status: 404 }); } }));
vi.mock("@/src/articles/repository", () => ({ lockArticleDraft: mocks.lockDraft, readArticleReceipt: mocks.receipt,
  insertArticleReceipt: mocks.insertReceipt, readArticleDraft: mocks.readDraft, readArticlePublication: mocks.publication, assignArticleDraftSlug: mocks.assignSlug }));
vi.mock("@/src/categories/repository", () => ({ ArticleCategoryRepository: class { get = mocks.category; } }));
vi.mock("@/src/taxonomy/football-tags-repository", () => ({ getFootballTagsByIds: mocks.tags }));

import { publishArticleDraft } from "@/src/articles/service";
import { parseArticlePublication } from "@/src/articles/contract";
const id = "5e03d92b-cf69-4288-8e43-6a02e9340497";
const image = "2a1972ab-cd11-4a45-922d-6d3c55cf7fe0";
const unusedImage = "3a1972ab-cd11-4a45-922d-6d3c55cf7fe0";
const actor = { accountId: "writer", authUserId: "user", sessionToken: "synthetic", manageAll: false, publishOwn: true, publishAll: false };
const input = { action: "publish", operationId: "d5c45c78-e5cb-4862-b563-741b2a62bea1", expectedRevision: 3, expectedPublicationRevision: 0 } as const;
const content = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Содержательный текст" }] },
  { type: "articleImage", attrs: { assetId: image, alt: "Подпись", caption: "Описание" } }] };
const publication = { revision: 1, sourceRevision: 2, slug: "stable-slug", firstPublishedAt: "2026-11-01T12:00:00Z", updatedAt: "2026-11-01T12:00:00Z" };
beforeEach(() => {
  vi.resetAllMocks(); mocks.actor.mockResolvedValue(actor); mocks.revalidate.mockResolvedValue(actor);
  mocks.lockDraft.mockResolvedValue({ id, revision: 3 }); mocks.receipt.mockResolvedValue(null);
  mocks.query.mockResolvedValue({ rows: [{ revision: 2 }] }); mocks.tags.mockResolvedValue([]);
  mocks.assignSlug.mockImplementation(async (_db, _id, base) => base);
  mocks.readDraft.mockResolvedValue({ id, authorAccountId: "writer", revision: 3, formatVersion: 1, content, h1: "Заголовок", seoTitle: "", metaDescription: "", slug: "stable-slug",
    categoryIds: [], tagIds: [], images: [{ id: image }, { id: unusedImage }], publication: null, canPublish: true, slugMode: "manual" });
});
const sql = () => mocks.query.mock.calls.map(([query]) => String(query));

describe("Explicit Article publication", () => {
  it("copies only the saved aggregate and body-used images without updating the draft", async () => {
    await publishArticleDraft(id, input);
    expect(sql().some(query => query.startsWith("update article.drafts"))).toBe(false);
    expect(sql().some(query => query.startsWith("update article.articles"))).toBe(false);
    const snapshot = mocks.query.mock.calls.find(([query]) => query.startsWith("insert into article.publications"));
    expect(snapshot?.[1]).toEqual([id, 3, 1, JSON.stringify(content), "Заголовок", "", "", "stable-slug"]);
    expect(mocks.query.mock.calls.find(([query]) => query.startsWith("insert into article.publication_images"))?.[1]).toEqual([id, [image]]);
    expect(mocks.insertReceipt).toHaveBeenCalledWith(expect.anything(), input.operationId, expect.objectContaining({ action: "publish", result: { revision: 1, result: { sourceRevision: 3 } } }));
    expect(sql().at(-1)).toBe("commit");
  });
  it("denies a revoked publication grant after fresh transaction revalidation", async () => {
    mocks.revalidate.mockResolvedValue({ ...actor, publishOwn: false });
    await expect(publishArticleDraft(id, input)).rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });
    expect(sql()).toContain("rollback"); expect(mocks.readDraft).not.toHaveBeenCalled(); expect(mocks.insertReceipt).not.toHaveBeenCalled();
  });
  it("does not allow a grant holder to publish another Writer's draft", async () => {
    mocks.lockDraft.mockResolvedValue(null);
    await expect(publishArticleDraft(id, input)).rejects.toMatchObject({ code: "ARTICLE_NOT_FOUND" });
    expect(mocks.readDraft).not.toHaveBeenCalled();
  });
  it("lets Super Admin publish while preserving the saved author", async () => {
    mocks.revalidate.mockResolvedValue({ ...actor, accountId: "super-admin", manageAll: true, publishOwn: false, publishAll: true });
    await publishArticleDraft(id, input);
    const audit = mocks.query.mock.calls.find(([query]) => query.includes("'article_published'"));
    expect(audit?.[1][3]).toBe("writer");
    expect(sql().some(query => query.startsWith("update article.articles"))).toBe(false);
  });
  it.each([
    { expectedRevision: 2 }, { expectedPublicationRevision: 1, action: "update" },
  ])("rejects stale saved/publication revision before changing the snapshot: %j", async override => {
    await expect(publishArticleDraft(id, { ...input, ...override })).rejects.toMatchObject({ code: "ARTICLE_CONFLICT", status: 409 });
    expect(sql().some(query => query.startsWith("insert into article.publications"))).toBe(false);
  });
  it.each([
    { h1: "" }, { content: { type: "doc", content: [{ type: "paragraph" }] } },
  ])("keeps incomplete drafts private: %j", async override => {
    mocks.readDraft.mockResolvedValue({ ...await mocks.readDraft(), ...override });
    await expect(publishArticleDraft(id, input)).rejects.toMatchObject({ code: "ARTICLE_NOT_READY" });
    expect(mocks.insertReceipt).not.toHaveBeenCalled();
  });
  it("prepares an empty legacy automatic address from the saved title, not SEO title", async () => {
    mocks.readDraft.mockResolvedValueOnce({ ...await mocks.readDraft(), h1: "Победа спустя три десятилетия", seoTitle: "Другой SEO Title", slug: "", slugMode: "auto" });
    await publishArticleDraft(id, input);
    expect(mocks.assignSlug).toHaveBeenCalledWith(expect.anything(), id, "pobeda-spustya-tri-desyatiletiya", "auto");
    const snapshot = mocks.query.mock.calls.find(([query]) => query.startsWith("insert into article.publications"));
    expect(snapshot?.[1].at(-1)).toBe("pobeda-spustya-tri-desyatiletiya");
    expect(snapshot?.[1][1]).toBe(3);
  });
  it("rejects a body image not attached to this saved draft", async () => {
    mocks.readDraft.mockResolvedValue({ ...await mocks.readDraft(), images: [{ id: unusedImage }] });
    await expect(publishArticleDraft(id, input)).rejects.toMatchObject({ code: "ARTICLE_IMAGE_NOT_ATTACHED" });
    expect(sql()).toContain("rollback");
  });
  it("updates the published revision with CAS and retains slug and first publication time", async () => {
    mocks.readDraft.mockResolvedValue({ ...await mocks.readDraft(), publication });
    await publishArticleDraft(id, { ...input, action: "update", expectedPublicationRevision: 1 });
    const update = mocks.query.mock.calls.find(([query]) => query.startsWith("update article.publications"));
    expect(update?.[0]).toContain("where article_id=$1 and revision=$9");
    expect(update?.[0]).not.toMatch(/set[^;]*\bslug\s*=/);
    expect(update?.[0]).not.toContain("first_published_at=");
    expect(update?.[1].at(-1)).toBe(1);
  });
  it("rolls back the complete snapshot and all relations if a reference write fails", async () => {
    mocks.query.mockImplementation(async (query: string) => {
      if (query.startsWith("insert into article.publication_images")) throw { code: "23503" };
      return { rows: [] };
    });
    await expect(publishArticleDraft(id, input)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(sql()).toContain("rollback"); expect(sql()).not.toContain("commit"); expect(mocks.insertReceipt).not.toHaveBeenCalled();
  });
  it("reauthorizes an exact retry but never reapplies its old snapshot", async () => {
    const fingerprint = createHash("sha256").update(JSON.stringify({ ...input, operationId: undefined })).digest("hex");
    mocks.receipt.mockResolvedValue({ actorAccountId: actor.accountId, articleId: id, action: "publish", fingerprint, result: { revision: 1 } });
    await publishArticleDraft(id, input);
    expect(sql().some(query => query.startsWith("insert into article.publications"))).toBe(false);
    expect(mocks.insertReceipt).not.toHaveBeenCalled();
    mocks.revalidate.mockResolvedValue({ ...actor, publishOwn: false });
    await expect(publishArticleDraft(id, input)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it.each([{ ...input, content }, { ...input, action: "save" }, { ...input, expectedPublicationRevision: 1 }])("rejects mutation data outside the explicit command: %j", value => {
    expect(() => parseArticlePublication(value)).toThrow();
  });
});
