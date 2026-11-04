import type { Pool, PoolClient } from "pg";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ArticleDocument } from "@/src/articles/document";

vi.mock("server-only", () => ({}));
const tags = vi.hoisted(() => vi.fn());
vi.mock("@/src/taxonomy/football-tags-repository", () => ({ getFootballTagsByIds: tags }));
import { getPublicArticleBySlug, listPublicArticles, listPublishedArticleSitemapEntries, publicArticlePageExists, publicArticleSlugExists } from "@/src/articles/public-repository";

const articleId = "11111111-2222-4333-8444-555555555555";
const firstId = "bbbbbbbb-2222-4333-8444-555555555555";
const secondId = "aaaaaaaa-2222-4333-8444-555555555555";
const unusedId = "cccccccc-2222-4333-8444-555555555555";
const content: ArticleDocument = { type: "doc", content: [
  { type: "paragraph", content: [{ type: "text", text: "Опубликованный текст" }] },
  { type: "articleImage", attrs: { assetId: firstId, alt: "Первая иллюстрация", caption: "" } },
  { type: "articleImage", attrs: { assetId: secondId, alt: "Вторая иллюстрация", caption: "" } },
] };
const row = () => ({ id: articleId, slug: "stable-slug", h1: "Опубликованный H1", seoTitle: "SEO", metaDescription: "", formatVersion: 1, content,
  firstPublishedAt: new Date("2026-11-04T10:00:00Z"), updatedAt: new Date("2026-11-04T11:00:00Z"), nickname: "Текущий никнейм", avatarId: unusedId,
  socialLinks: [{ label: "Канал", url: "https://example.com/author" }, { label: "Unsafe", url: "javascript:alert(1)" }, { label: "Credentials", url: "https://user:pass@example.com" }],
  email: "DO_NOT_EXPOSE_LOGIN@example.com", accountStatus: "disabled" });

function fixture(options: { absent?: boolean; missingImage?: boolean; fail?: boolean } = {}) {
  const release = vi.fn();
  const query = vi.fn(async (sql: string) => {
    if (sql.startsWith("begin") || sql === "commit" || sql === "rollback") return { rows: [] };
    if (options.fail) throw new Error("fixture database failure");
    if (sql.includes("count(*)")) return { rows: [{ total: 21 }] };
    if (sql.includes("select exists")) return { rows: [{ exists: !options.absent }] };
    if (sql.includes("select slug")) return { rows: [{ slug: "stable-slug", updatedAt: new Date("2026-11-04T11:00:00Z") }] };
    if (sql.includes("from article.publication_images")) return { rows: (options.missingImage ? [secondId] : [secondId, firstId, unusedId]).map(id => ({ id, publicationId: articleId, width: 1200, height: 800, byteSize: 1000 })) };
    if (sql.includes("from article.publication_categories")) return { rows: [{ id: "category", name: "Аналитика" }] };
    if (sql.includes("from article.publication_tags")) return { rows: [{ id: "tag-one" }] };
    if (sql.includes("from article.publications p")) return { rows: options.absent ? [] : [row()] };
    throw new Error("Unexpected fixture query");
  });
  const db = { query, release } as unknown as PoolClient;
  const pool = { connect: vi.fn(async () => db) } as unknown as Pick<Pool, "connect">;
  return { db, pool, query, release };
}
beforeEach(() => { tags.mockReset(); tags.mockResolvedValue([]); });

describe("Public Article read model", () => {
  it("reads only the current published aggregate and current public author in one read-only snapshot", async () => {
    const f = fixture();
    const result = await getPublicArticleBySlug(f.pool, "stable-slug");
    expect(result?.content).toEqual(content);
    expect(result?.author).toEqual({ nickname: "Текущий никнейм", avatarUrl: `/media/public/${unusedId}.webp`, socialLinks: [{ label: "Канал", url: "https://example.com/author" }] });
    expect(result?.images.map(image => image.id)).toEqual([firstId, secondId]);
    expect(result?.images.every(image => image.url.startsWith("/media/public/"))).toBe(true);
    expect(result?.cover?.id).toBe(firstId);
    expect(result?.cover?.alt).toBe("Первая иллюстрация");
    expect(result?.categories).toEqual([{ id: "category", name: "Аналитика" }]);
    expect(tags).toHaveBeenCalledWith(f.db, ["tag-one"]);
    expect(JSON.stringify(result)).not.toContain("DO_NOT_EXPOSE_LOGIN");
    const sql = f.query.mock.calls.map(call => call[0]).join("\n");
    expect(sql).not.toMatch(/article\.draft|auth\.|account_roles|status\s*=/);
    expect(f.query.mock.calls[0][0]).toBe("begin isolation level repeatable read read only");
    expect(f.query.mock.calls.at(-1)?.[0]).toBe("commit"); expect(f.release).toHaveBeenCalledOnce();
  });
  it("lists only published summaries and chooses cover by JSON order rather than attachment order", async () => {
    const f = fixture(); const result = await listPublicArticles(f.pool, 2);
    expect(result).toMatchObject({ page: 2, total: 21, totalPages: 2 });
    expect(result.items[0]).toMatchObject({ h1: "Опубликованный H1", cover: { id: firstId } });
    expect(result.items[0]).not.toHaveProperty("seoTitle");
    expect(result.items[0]).not.toHaveProperty("content");
    const pageQuery = f.query.mock.calls.find(call => call[0].includes("order by p.first_published_at"));
    expect(pageQuery).toBeTruthy();
  });
  it("returns no publication for absent or malformed slugs without a draft fallback", async () => {
    const f = fixture({ absent: true });
    expect(await getPublicArticleBySlug(f.pool, "draft-only")).toBeNull();
    const untouched = fixture();
    expect(await getPublicArticleBySlug(untouched.pool, "../admin")).toBeNull();
    expect(untouched.query).not.toHaveBeenCalled();
    expect(await publicArticleSlugExists(untouched.db, "Bad-Slug")).toBe(false);
    expect(untouched.query).not.toHaveBeenCalled();
  });
  it("fails closed on an inconsistent publication image relation and releases the snapshot", async () => {
    const f = fixture({ missingImage: true });
    await expect(getPublicArticleBySlug(f.pool, "stable-slug")).rejects.toThrow("image relation");
    expect(f.query.mock.calls.at(-1)?.[0]).toBe("rollback"); expect(f.release).toHaveBeenCalledOnce();
  });
  it("uses lightweight published-only existence/sitemap reads", async () => {
    const f = fixture();
    expect(await publicArticleSlugExists(f.db, "stable-slug")).toBe(true);
    expect(await publicArticlePageExists(f.db, 1)).toBe(true);
    expect(await publicArticlePageExists(f.db, 2)).toBe(true);
    expect(await listPublishedArticleSitemapEntries(f.db)).toEqual([{ slug: "stable-slug", updatedAt: "2026-11-04T11:00:00.000Z" }]);
    expect(f.query.mock.calls.find(call => call[0].startsWith("select slug"))?.[0]).toContain("updated_at");
    expect(f.query.mock.calls.every(call => call[0].includes("article.publications"))).toBe(true);
  });
});
