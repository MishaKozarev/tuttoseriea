// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PublicArticleDetail, PublicArticlePage } from "@/src/articles/public-contract";

const mocks = vi.hoisted(() => ({ detail: vi.fn(), list: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/src/db", () => ({ getDbPool: () => ({}) }));
vi.mock("@/src/articles/public-repository", () => ({ getPublicArticleBySlug: mocks.detail, listPublicArticles: mocks.list }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NOT_FOUND"); } }));
import ArticlePage, { generateMetadata as detailMetadata, dynamic as detailDynamic } from "@/app/(public)/articles/[slug]/page";
import ArticlesPage, { generateMetadata as listMetadata, dynamic as listDynamic } from "@/app/(public)/articles/page";
import { PublicShell } from "@/components/layout/public-shell";

const id = "11111111-2222-4333-8444-555555555555";
const imageId = "22222222-2222-4333-8444-555555555555";
const article: PublicArticleDetail = {
  id, slug: "published-slug", h1: "Видимый заголовок", seoTitle: "Только SEO title", metaDescription: "",
  firstPublishedAt: "2026-11-04T10:00:00.000Z", updatedAt: "2026-11-04T11:00:00.000Z", formatVersion: 1,
  author: { nickname: "Авторский ник", avatarUrl: null, socialLinks: [{ label: "Канал автора", url: "https://example.com/writer" }] },
  content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Опубликованный текст" }] }, { type: "articleImage", attrs: { assetId: imageId, alt: "Иллюстрация", caption: "Подпись автора" } }] },
  images: [{ id: imageId, url: `/media/public/${imageId}.webp`, width: 1000, height: 600, byteSize: 1000 }], cover: null,
  categories: [{ id: "category", name: "Аналитика" }], tags: [],
};
const listing: PublicArticlePage = { items: [article], total: 21, page: 1, totalPages: 2 };
const detailProps = () => ({ params: Promise.resolve({ slug: article.slug }) });

beforeEach(() => {
  vi.resetAllMocks(); vi.stubEnv("AUTH_URL", "https://tuttoseriea.com");
  mocks.detail.mockResolvedValue(article); mocks.list.mockResolvedValue(listing);
});
afterEach(() => { cleanup(); vi.unstubAllEnvs(); });

describe("Public Article server pages", () => {
  it("renders H1, author, public body media and category labels without visible SEO title", async () => {
    const { container } = render(await ArticlePage(detailProps()));
    expect(screen.getByRole("heading", { name: article.h1, level: 1 })).toBeTruthy();
    expect(screen.queryByText(article.seoTitle)).toBeNull();
    expect(screen.getByText(article.author.nickname)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Канал автора" }).getAttribute("rel")).toContain("noopener");
    expect(screen.getByRole("img", { name: "Иллюстрация" }).getAttribute("src")).toBe(`/media/public/${imageId}.webp`);
    expect(screen.getByText("Опубликованный текст")).toBeTruthy();
    expect(await detailMetadata(detailProps())).toMatchObject({ title: article.seoTitle, description: null });
    const scripts = container.querySelectorAll('script[type="application/ld+json"]');
    expect(scripts).toHaveLength(1);
    expect(JSON.parse(scripts[0].textContent ?? "")).toMatchObject({ "@type": "Article", headline: article.h1,
      url: "https://tuttoseriea.com/articles/published-slug", datePublished: article.firstPublishedAt, dateModified: article.updatedAt });
    expect(detailDynamic).toBe("force-dynamic");
  });
  it("returns not found for both page content and metadata when no publication exists", async () => {
    mocks.detail.mockResolvedValue(null);
    await expect(ArticlePage(detailProps())).rejects.toThrow("NOT_FOUND");
    await expect(detailMetadata(detailProps())).rejects.toThrow("NOT_FOUND");
  });
  it("lists H1-only cards and normalizes page-one canonical", async () => {
    render(await ArticlesPage({ searchParams: Promise.resolve({ page: "1" }) }));
    expect(screen.getByRole("heading", { name: "Статьи", level: 1 })).toBeTruthy();
    expect(screen.getByRole("link", { name: article.h1 })).toBeTruthy();
    expect(screen.getByRole("img", { name: "Изображение статьи отсутствует" })).toBeTruthy();
    expect(screen.getByText("Без изображения")).toBeTruthy();
    expect(screen.queryByText(article.seoTitle)).toBeNull();
    expect(screen.getByRole("link", { name: "Следующая страница" }).getAttribute("href")).toBe("/articles?page=2");
    expect((await listMetadata({ searchParams: Promise.resolve({ page: "1" }) })).alternates).toEqual({ canonical: "/articles" });
    expect(listDynamic).toBe("force-dynamic");
  });
  it("rejects invalid/empty later pages while preserving a valid empty first page", async () => {
    await expect(ArticlesPage({ searchParams: Promise.resolve({ page: ["1", "2"] }) })).rejects.toThrow("NOT_FOUND");
    mocks.list.mockResolvedValue({ items: [], page: 3, total: 0, totalPages: 0 });
    await expect(ArticlesPage({ searchParams: Promise.resolve({ page: "3" }) })).rejects.toThrow("NOT_FOUND");
    mocks.list.mockResolvedValue({ items: [], page: 1, total: 0, totalPages: 0 });
    render(await ArticlesPage({ searchParams: Promise.resolve({}) }));
    expect(screen.getByText("Опубликованных статей пока нет.")).toBeTruthy();
  });
  it("renders a real published cover instead of the neutral placeholder when available", async () => {
    mocks.list.mockResolvedValue({ ...listing, items: [{ ...article, cover: { ...article.images[0], alt: "Обложка из первой иллюстрации" } }] });
    render(await ArticlesPage({ searchParams: Promise.resolve({}) }));
    expect(screen.getByRole("img", { name: "Обложка из первой иллюстрации" }).getAttribute("src")).toBe(`/media/public/${imageId}.webp`);
    expect(screen.queryByRole("img", { name: "Изображение статьи отсутствует" })).toBeNull();
  });
  it("adds Articles to public navigation", () => {
    render(<PublicShell><p>Content</p></PublicShell>);
    expect(screen.getByRole("link", { name: "Статьи" }).getAttribute("href")).toBe("/articles");
  });
  it("renders JSON-LD injection text without creating executable nodes", async () => {
    const attack = '</script><script id="injected-script">alert(1)</script><img id="injected-image" src=x onerror=alert(1)>';
    mocks.detail.mockResolvedValue({ ...article, h1: attack, metaDescription: attack, author: { ...article.author, nickname: attack } });
    const { container } = render(await ArticlePage(detailProps()));
    const script = container.querySelector('script[type="application/ld+json"]');
    expect(container.querySelectorAll("script")).toHaveLength(1);
    expect(container.querySelector("#injected-script")).toBeNull(); expect(container.querySelector("#injected-image")).toBeNull();
    expect(script?.textContent).not.toContain("<");
    expect(JSON.parse(script?.textContent ?? "").headline).toBe(attack);
    expect(screen.getByRole("heading", { name: attack, level: 1 })).toBeTruthy();
  });
});
