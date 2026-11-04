import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ actor: vi.fn(), revalidate: vi.fn(), query: vi.fn(), release: vi.fn(),
  lock: vi.fn(), receipt: vi.fn(), insertReceipt: vi.fn(), read: vi.fn(), publication: vi.fn(), assign: vi.fn(), tags: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/src/db", () => ({ getDbPool: () => ({ connect: async () => ({ query: mocks.query, release: mocks.release }) }) }));
vi.mock("@/src/articles/access", () => ({ requireArticleActor: mocks.actor, revalidateArticleActor: mocks.revalidate,
  articleNotFound: () => { throw new Error("Missing fixture draft"); } }));
vi.mock("@/src/articles/repository", () => ({ lockArticleDraft: mocks.lock, readArticleReceipt: mocks.receipt,
  insertArticleReceipt: mocks.insertReceipt, readArticleDraft: mocks.read, readArticlePublication: mocks.publication, assignArticleDraftSlug: mocks.assign }));
vi.mock("@/src/taxonomy/football-tags-repository", () => ({ getFootballTagsByIds: mocks.tags }));

import { saveArticleDraft } from "@/src/articles/service";
const id = "5e03d92b-cf69-4288-8e43-6a02e9340497";
const actor = { accountId: "fixture-writer", authUserId: "fixture-user", sessionToken: "synthetic", manageAll: false };
const saved = { id, revision: 2, h1: "Победа спустя три десятилетия", slug: "", slugMode: "auto", publication: null };
const input = { operationId: "d5c45c78-e5cb-4862-b563-741b2a62bea1", expectedRevision: 2, formatVersion: 1,
  content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Текст" }] }] },
  h1: saved.h1, seoTitle: "Совсем другой SEO Title", metaDescription: "", categoryIds: [], tagIds: [] };
beforeEach(() => {
  vi.resetAllMocks(); mocks.actor.mockResolvedValue(actor); mocks.revalidate.mockResolvedValue(actor);
  mocks.lock.mockResolvedValue({ id, revision: 2 }); mocks.query.mockResolvedValue({ rows: [{ revision: 3 }] });
  mocks.receipt.mockResolvedValue(null); mocks.publication.mockResolvedValue(null); mocks.read.mockResolvedValue(saved);
  mocks.tags.mockResolvedValue([]); mocks.assign.mockImplementation(async (_db, _id, slug) => slug);
});

describe("Draft auto/manual address lifecycle", () => {
  it("saves without slug and prepares it only from the article name, leaving independent metadata untouched", async () => {
    await saveArticleDraft(id, input);
    expect(mocks.assign).toHaveBeenCalledWith(expect.anything(), id, "pobeda-spustya-tri-desyatiletiya", "auto");
    const write = mocks.query.mock.calls.find(([sql]) => sql.includes("set format_version="));
    expect(write?.[1]).toContain("Совсем другой SEO Title"); expect(write?.[1]).toContain("");
    expect(mocks.query.mock.calls.some(([sql]) => sql.includes("article.publications"))).toBe(false);
  });
  it("keeps a previously allocated automatic suffix when only SEO Title changes", async () => {
    mocks.read.mockResolvedValue({ ...saved, slug: "pobeda-spustya-tri-desyatiletiya-2" });
    await saveArticleDraft(id, { ...input, slugMode: "auto" });
    expect(mocks.assign).toHaveBeenCalledWith(expect.anything(), id, "pobeda-spustya-tri-desyatiletiya-2", "auto");
  });
  it("regenerates an unpublished automatic address after changing the name", async () => {
    mocks.read.mockResolvedValue({ ...saved, slug: "pobeda-spustya-tri-desyatiletiya-2" });
    await saveArticleDraft(id, { ...input, h1: "Новый матч", slugMode: "auto" });
    expect(mocks.assign).toHaveBeenCalledWith(expect.anything(), id, "novyy-match", "auto");
  });
  it("preserves a legacy/manual correction when its name changes and address fields are omitted", async () => {
    mocks.read.mockResolvedValue({ ...saved, slug: "custom-address", slugMode: "manual" });
    await saveArticleDraft(id, { ...input, h1: "Другое название" });
    expect(mocks.assign).toHaveBeenCalledWith(expect.anything(), id, "custom-address", "manual");
  });
  it("accepts an explicit manual correction and supports an explicit return to automatic mode", async () => {
    await saveArticleDraft(id, { ...input, slugMode: "manual", slug: "my-address" });
    expect(mocks.assign).toHaveBeenCalledWith(expect.anything(), id, "my-address", "manual");
    mocks.read.mockResolvedValue({ ...saved, slug: "my-address", slugMode: "manual" });
    await saveArticleDraft(id, { ...input, slugMode: "auto" });
    expect(mocks.assign).toHaveBeenLastCalledWith(expect.anything(), id, "pobeda-spustya-tri-desyatiletiya", "auto");
  });
  it("keeps incomplete drafts saveable and uses a stable fallback for a nonempty unsupported name", async () => {
    await saveArticleDraft(id, { ...input, h1: "", slugMode: "auto" });
    expect(mocks.assign).toHaveBeenLastCalledWith(expect.anything(), id, "", "auto");
    await saveArticleDraft(id, { ...input, h1: "⚽", slugMode: "auto" });
    expect(mocks.assign).toHaveBeenLastCalledWith(expect.anything(), id, `article-${id}`, "auto");
  });
  it("retains the exact published address on name/metadata changes and rejects any address mutation", async () => {
    mocks.publication.mockResolvedValue({ slug: "fixed-address", revision: 1 });
    await saveArticleDraft(id, { ...input, h1: "Другое название", slugMode: "auto" });
    expect(mocks.assign).not.toHaveBeenCalled();
    await expect(saveArticleDraft(id, { ...input, slugMode: "manual", slug: "changed-address" })).rejects.toMatchObject({ code: "ARTICLE_SLUG_IMMUTABLE", status: 409 });
  });
});
