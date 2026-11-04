import { describe, expect, it } from "vitest";
import { buildArticleJsonLd, buildArticleMetadata, buildArticlesMetadata, buildRootMetadata, buildSitemap, isArticleIndexingEnabled, serializeArticleJsonLd } from "@/src/seo/site";
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
    const urls = buildSitemap(env, ["milan"], [], [], [{ slug: article.slug, updatedAt: article.updatedAt }]).map(entry => entry.url);
    expect(urls.some(url => url.includes("/articles"))).toBe(false);
    expect(urls).toContain(`${AUTH_URL}/clubs/milan`);
    expect(buildRootMetadata(env).robots).toEqual({ index: true, follow: true });
  });
  it("consolidates the first page and keeps later pages noindex with their own canonical", () => {
    expect(buildArticlesMetadata(1, production).alternates).toEqual({ canonical: "/articles" });
    expect(buildArticlesMetadata(2, production).alternates).toEqual({ canonical: "/articles?page=2" });
    expect(buildArticlesMetadata(2, production).robots).toMatchObject({ index: false });
    const entries = buildSitemap(production, [], [], [], [{ slug: article.slug, updatedAt: article.updatedAt }]);
    const urls = entries.map(entry => entry.url);
    expect(urls).toContain("https://tuttoseriea.com/articles");
    expect(urls).toContain("https://tuttoseriea.com/articles/analysis-of-match");
    expect(urls.some(url => url.includes("?page="))).toBe(false);
    expect(entries.find(entry => entry.url.endsWith(`/articles/${article.slug}`))?.lastModified).toBe(article.updatedAt);
  });
  it.each(["page=0", "page=-1", "page=01", "page=1&page=2", "page=1000000", "page=NaN"])("rejects ambiguous or invalid pagination %s", query => {
    expect(parsePublicArticlePage(new URLSearchParams(query))).toBeNull();
  });

  it("creates Article structured data from the published title/profile/media/timestamps", () => {
    const imageId = "11111111-2222-4333-8444-555555555555";
    const payload = { ...article, author: { nickname: "Публичный ник", avatarUrl: `/media/public/${imageId}.webp`, socialLinks: [{ label: "Канал", url: "https://example.com/author" }] },
      images: [{ id: imageId, url: "/media/private/ignored.webp", width: 1000, height: 600, byteSize: 1000 }] };
    const result = buildArticleJsonLd(payload, production);
    expect(result).toMatchObject({ "@context": "https://schema.org", "@type": "Article", headline: article.h1,
      url: "https://tuttoseriea.com/articles/analysis-of-match", mainEntityOfPage: { "@id": "https://tuttoseriea.com/articles/analysis-of-match" },
      datePublished: article.firstPublishedAt, dateModified: article.updatedAt, description: article.metaDescription,
      author: { "@type": "Person", name: "Публичный ник", image: `https://tuttoseriea.com/media/public/${imageId}.webp`, sameAs: ["https://example.com/author"] },
      image: [`https://tuttoseriea.com/media/public/${imageId}.webp`] });
    expect(JSON.stringify(result)).not.toContain(article.seoTitle);
    expect(JSON.stringify(result)).not.toContain("/media/private/");
  });

  it("omits empty descriptions/images and excludes nonpublic author avatars from JSON-LD", () => {
    const result = buildArticleJsonLd({ ...article, metaDescription: "", author: { nickname: "Автор", avatarUrl: "/media/private/private.webp", socialLinks: [] }, images: [] }, production);
    expect(result).not.toHaveProperty("description"); expect(result).not.toHaveProperty("image");
    expect(result.author).not.toHaveProperty("image"); expect(result.author).not.toHaveProperty("sameAs");
  });

  it("escapes script delimiters in every structured-data string while preserving JSON values", () => {
    const attack = '</script><script src="https://unsafe.invalid/x.js"></script><img src=x onerror=alert(1)>';
    const payload = { ...article, h1: attack, metaDescription: attack, author: { nickname: attack, avatarUrl: null, socialLinks: [] }, images: [] };
    const serialized = serializeArticleJsonLd(payload, production);
    expect(serialized).not.toContain("<");
    expect(serialized).not.toMatch(/<\/script/i);
    expect(JSON.parse(serialized)).toMatchObject({ headline: attack, description: attack, author: { name: attack } });
  });
});
