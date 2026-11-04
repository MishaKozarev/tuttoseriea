// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ArticleError, EMPTY_ARTICLE_DOCUMENT } from "@/src/articles/document";
import type { ArticleDraftDTO } from "@/src/articles/contract";

const mocks = vi.hoisted(() => ({ access: vi.fn(), list: vi.fn(), draft: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/src/articles/access", () => ({ getArticlesAccess: mocks.access }));
vi.mock("@/src/articles/service", () => ({ listArticleDrafts: mocks.list, getArticleDraft: mocks.draft }));
vi.mock("@/src/logging/logger", () => ({ logger: { error: vi.fn() } }));
vi.mock("@/components/articles/editor", () => ({ ArticleEditor: ({ initial }: { initial: ArticleDraftDTO }) => <div data-testid="editor">{initial.h1}</div> }));
vi.mock("@/components/articles/create-draft", () => ({ CreateArticleDraft: () => <button>Создать черновик</button> }));
vi.mock("next/navigation", () => ({ redirect: (path: string) => { throw Error(`REDIRECT:${path}`); }, forbidden: () => { throw Error("FORBIDDEN"); }, notFound: () => { throw Error("NOT_FOUND"); } }));
import ArticlesPage from "@/app/admin/articles/page";
import NewArticlePage from "@/app/admin/articles/new/page";
import ArticleEditorPage from "@/app/admin/articles/[articleId]/page";
import ArticlePreviewPage from "@/app/admin/articles/[articleId]/preview/page";

const id = "11111111-2222-4333-8444-555555555555";
const draft: ArticleDraftDTO = { id, authorAccountId: id, authorName: "Автор", h1: "Частный черновик", seoTitle: "", metaDescription: "", slug: "",
  revision: 0, createdAt: "2026-11-02T10:00:00Z", updatedAt: "2026-11-02T10:00:00Z", formatVersion: 1,
  content: EMPTY_ARTICLE_DOCUMENT, categoryIds: [], tagIds: [], categories: [], tags: [], images: [], publication: null, canPublish: false };
const params = () => ({ params: Promise.resolve({ articleId: id }) });
beforeEach(() => {
  vi.resetAllMocks(); mocks.access.mockResolvedValue({ type: "allowed", actor: { manageAll: false, sessionToken: "DO_NOT_SERIALIZE_SESSION" } });
  mocks.draft.mockResolvedValue(draft); mocks.list.mockResolvedValue({ items: [], page: 1, total: 0, totalPages: 0 });
});
afterEach(cleanup);

describe("Article server pages", () => {
  it("redirects before list/editor/preview reads or a create surface", async () => {
    mocks.access.mockResolvedValue({ type: "redirect", location: "/admin/login?returnTo=articles" });
    await expect(ArticlesPage({ searchParams: Promise.resolve({}) })).rejects.toThrow("REDIRECT");
    await expect(NewArticlePage()).rejects.toThrow("REDIRECT");
    await expect(ArticleEditorPage(params())).rejects.toThrow("REDIRECT");
    await expect(ArticlePreviewPage(params())).rejects.toThrow("REDIRECT");
    expect(mocks.list).not.toHaveBeenCalled(); expect(mocks.draft).not.toHaveBeenCalled();
  });
  it("denies forbidden accounts before any protected read", async () => {
    mocks.access.mockResolvedValue({ type: "forbidden" });
    await expect(ArticlesPage({ searchParams: Promise.resolve({}) })).rejects.toThrow("FORBIDDEN");
    await expect(ArticleEditorPage(params())).rejects.toThrow("FORBIDDEN");
    await expect(ArticlePreviewPage(params())).rejects.toThrow("FORBIDDEN");
    expect(mocks.list).not.toHaveBeenCalled(); expect(mocks.draft).not.toHaveBeenCalled();
  });
  it("rejects own-only actors requesting all drafts before the service read", async () => {
    await expect(ArticlesPage({ searchParams: Promise.resolve({ scope: "all" }) })).rejects.toThrow("FORBIDDEN");
    expect(mocks.list).not.toHaveBeenCalled();
  });
  it("keeps unavailable and foreign draft editor/preview pages not found", async () => {
    mocks.draft.mockRejectedValue(new ArticleError("ARTICLE_NOT_FOUND", 404, "Unavailable"));
    await expect(ArticleEditorPage(params())).rejects.toThrow("NOT_FOUND");
    await expect(ArticlePreviewPage(params())).rejects.toThrow("NOT_FOUND");
  });
  it("renders authorized saved content and never passes actor/session data to UI", async () => {
    render(await ArticlePreviewPage(params()));
    expect(screen.getByRole("heading", { name: "Частный черновик" })).toBeTruthy();
    expect(document.body.textContent).not.toContain("DO_NOT_SERIALIZE_SESSION");
    expect(mocks.access).toHaveBeenCalledWith(`/admin/articles/${id}/preview`);
    expect(mocks.draft).toHaveBeenCalledWith(id);
  });
  it("shows safe read failures without a partial editing form or diagnostics", async () => {
    mocks.draft.mockRejectedValue(new Error("private SQL details"));
    render(await ArticleEditorPage(params()));
    expect(screen.getByRole("alert").textContent).toContain("Не удалось");
    expect(screen.queryByTestId("editor")).toBeNull();
    expect(document.body.textContent).not.toContain("private SQL details");
  });
});
