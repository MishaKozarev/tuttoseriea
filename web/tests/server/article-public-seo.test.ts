import { describe, expect, it } from "vitest";
import { buildArticleMetadata, buildArticlesMetadata, buildRootMetadata, buildSitemap, isArticleIndexingEnabled } from "@/src/seo/site";
import { parsePublicArticlePage } from "@/src/articles/public-contract";

const article = { slug: "analysis-of-match", h1: "Заголовок для читателя", seoTitle: "Отдельный SEO title", metaDescription: "Ручное описание",
  firstPublishedAt: "2026-11-04T10:00:00.000Z", updatedAt: "2026-11-04T11:00:00.000Z" };
const production = { AUTH_URL: "https://tuttoseriea.com", NODE_ENV: "production" };

describe("Published Articles SEO", () => {
  it("uses the stable published slug and manual head metadata independently of H1", () => {
    const result = buildArticleMetadata(article, production);
    expect(result.title).toBe(article.seoTitle);
    expect(result.description).toBe(article.metaDescription);
    expect(result.alternates).toEqual({ canonical: "/articles/analysis-of-match" });
    expect(result.robots).toMatchObject({ index: true, follow: true });
    expect(result.openGraph).toMatchObject({ type: "article", title: article.seoTitle, url: "https://tuttoseriea.com/articles/analysis-of-match" });
  });
  it("falls back to H1 for an empty SEO title and removes inherited descriptions", () => {
    const metadata = buildArticleMetadata({ ...article, seoTitle: "", metaDescription: "" }, production);
    expect(metadata.title).toBe(article.h1);
    expect(metadata.description).toBeNull();
    expect(metadata.openGraph).not.toHaveProperty("description");
    expect(metadata.twitter).not.toHaveProperty("description");
    expect(buildRootMetadata(production).description).toBeTruthy();
  });
  it.each(["https://staging.tuttoseriea.com", "http://localhost:3000", "https://www.tuttoseriea.com", "http://tuttoseriea.com", "https://tuttoseriea.com:8443"])("keeps Articles outside search indexing on %s", AUTH_URL => {
    const env = { AUTH_URL, NODE_ENV: "production" };
    expect(isArticleIndexingEnabled(env)).toBe(false);
    expect(buildArticleMetadata(article, env).robots).toMatchObject({ index: false, follow: false });
    expect(buildArticlesMetadata(1, env).robots).toMatchObject({ index: false, follow: false });
    const urls = buildSitemap(env, ["milan"], [], [], [article.slug]).map(entry => entry.url);
    expect(urls.some(url => url.includes("/articles"))).toBe(false);
    expect(urls).toContain(`${AUTH_URL}/clubs/milan`);
    expect(buildRootMetadata(env).robots).toEqual({ index: true, follow: true });
  });
  it("consolidates the first page and keeps later pages noindex with their own canonical", () => {
    expect(buildArticlesMetadata(1, production).alternates).toEqual({ canonical: "/articles" });
    expect(buildArticlesMetadata(2, production).alternates).toEqual({ canonical: "/articles?page=2" });
    expect(buildArticlesMetadata(2, production).robots).toMatchObject({ index: false });
    const urls = buildSitemap(production, [], [], [], [article.slug]).map(entry => entry.url);
    expect(urls).toContain("https://tuttoseriea.com/articles");
    expect(urls).toContain("https://tuttoseriea.com/articles/analysis-of-match");
    expect(urls.some(url => url.includes("?page="))).toBe(false);
  });
  it.each(["page=0", "page=-1", "page=01", "page=1&page=2", "page=1000000", "page=NaN"])("rejects ambiguous or invalid pagination %s", query => {
    expect(parsePublicArticlePage(new URLSearchParams(query))).toBeNull();
  });
});
