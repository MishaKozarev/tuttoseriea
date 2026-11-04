import "server-only";
import type { Pool, PoolClient } from "pg";

import { getFootballTagsByIds } from "../taxonomy/football-tags-repository";
import type { ArticleImageDTO } from "./contract";
import { ARTICLE_FORMAT_VERSION, articleImageIds, parseArticleDocument, type ArticleDocument, type ArticleNode } from "./document";
import { PUBLIC_ARTICLES_PAGE_SIZE, type PublicArticleAuthor, type PublicArticleDetail, type PublicArticlePage, type PublicArticleSummary } from "./public-contract";

type Queryable = Pick<Pool | PoolClient, "query">;
type ReadPool = Pick<Pool, "connect">;
type PublishedRow = {
  id: string; slug: string; h1: string; seoTitle: string; metaDescription: string;
  formatVersion: number; content: unknown; firstPublishedAt: Date | string; updatedAt: Date | string;
  nickname: string | null; avatarId: string | null; socialLinks: unknown;
};
type ImageRow = Omit<ArticleImageDTO, "url"> & { publicationId: string };
const publicationProjection = `p.article_id as id,p.slug,p.h1,p.seo_title as "seoTitle",p.meta_description as "metaDescription",
  p.format_version as "formatVersion",p.content,p.first_published_at as "firstPublishedAt",p.updated_at as "updatedAt",
  w.nickname,avatar.id as "avatarId",w.social_links as "socialLinks"`;
const publicationFrom = `article.publications p join article.articles a on a.id=p.article_id
  left join identity.writer_profiles w on w.account_id=a.author_account_id
  left join media.assets avatar on avatar.id=w.avatar_media_id and avatar.kind='avatar'`;
const validSlug = (slug: string) => slug.length <= 160 && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug);
const validPage = (page: number) => Number.isSafeInteger(page) && page >= 1 && page <= 999999;
const iso = (date: Date | string) => new Date(date).toISOString();

async function snapshot<T>(pool: ReadPool, work: (db: PoolClient) => Promise<T>): Promise<T> {
  const db = await pool.connect();
  try {
    await db.query("begin isolation level repeatable read read only");
    const result = await work(db);
    await db.query("commit");
    return result;
  } catch (error) {
    await db.query("rollback");
    throw error;
  } finally { db.release(); }
}

function author(row: PublishedRow): PublicArticleAuthor {
  const socialLinks: PublicArticleAuthor["socialLinks"] = [];
  // Profiles are current public data. Never fall back to account login/email,
  // and never turn malformed stored social data into an executable URL.
  if (Array.isArray(row.socialLinks)) for (const item of row.socialLinks.slice(0, 10)) {
    if (!item || typeof item !== "object" || typeof item.label !== "string" || !item.label.trim() ||
      item.label.length > 60 || typeof item.url !== "string" || item.url.length > 2048 || /[\p{Cc}\p{Cf}]/u.test(item.label + item.url)) continue;
    try {
      const url = new URL(item.url);
      if (["http:", "https:"].includes(url.protocol) && url.hostname && !url.username && !url.password) socialLinks.push({ label: item.label, url: url.href });
    } catch { /* Omit malformed profile links while retaining the article. */ }
  }
  return { nickname: row.nickname?.trim() || "Автор", avatarUrl: row.avatarId ? `/media/public/${row.avatarId}.webp` : null, socialLinks };
}

async function readImages(db: Queryable, ids: string[]): Promise<Map<string, ArticleImageDTO[]>> {
  const images = new Map<string, ArticleImageDTO[]>();
  if (!ids.length) return images;
  const rows = (await db.query<ImageRow>(`select pi.publication_id as "publicationId",m.id,m.width,m.height,m.byte_size as "byteSize"
    from article.publication_images pi join media.assets m on m.id=pi.media_id
    where pi.publication_id=any($1::text[]) and m.kind='article_image' order by pi.publication_id,m.id`, [ids])).rows;
  for (const { publicationId, ...image } of rows) {
    const list = images.get(publicationId) ?? [];
    list.push({ ...image, url: `/media/public/${image.id}.webp` });
    images.set(publicationId, list);
  }
  return images;
}

function publication(row: PublishedRow, assets: ArticleImageDTO[]): { summary: PublicArticleSummary; content: ArticleDocument; images: ArticleImageDTO[] } {
  if (row.formatVersion !== ARTICLE_FORMAT_VERSION) throw new Error("Unsupported published article format");
  const content = parseArticleDocument(row.content);
  const imageIds = articleImageIds(content);
  const available = new Map(assets.map(image => [image.id, image]));
  const images = imageIds.map(id => {
    const image = available.get(id);
    if (!image) throw new Error("Published article image relation is missing");
    return image;
  });
  let firstImage: ArticleNode | null = null;
  const visit = (node: ArticleNode) => {
    if (firstImage) return;
    if (node.type === "articleImage") firstImage = node;
    else node.content?.forEach(visit);
  };
  visit(content);
  const first = firstImage as ArticleNode | null;
  return { content, images, summary: {
    id: row.id, slug: row.slug, h1: row.h1, firstPublishedAt: iso(row.firstPublishedAt), updatedAt: iso(row.updatedAt), author: author(row),
    cover: first && images[0] ? { ...images[0], alt: first.attrs?.alt ?? "" } : null,
  } };
}

export async function listPublicArticles(pool: ReadPool, page = 1): Promise<PublicArticlePage> {
  if (!validPage(page)) throw new Error("Invalid public article page");
  return snapshot(pool, async db => {
    const total = (await db.query<{ total: number }>("select count(*)::int as total from article.publications")).rows[0].total;
    const rows = (await db.query<PublishedRow>(`select ${publicationProjection} from ${publicationFrom}
      order by p.first_published_at desc,p.article_id limit $1 offset $2`, [PUBLIC_ARTICLES_PAGE_SIZE, (page - 1) * PUBLIC_ARTICLES_PAGE_SIZE])).rows;
    const assets = await readImages(db, rows.map(row => row.id));
    return { items: rows.map(row => publication(row, assets.get(row.id) ?? []).summary), page, total, totalPages: Math.ceil(total / PUBLIC_ARTICLES_PAGE_SIZE) };
  });
}

export async function getPublicArticleBySlug(pool: ReadPool, slug: string): Promise<PublicArticleDetail | null> {
  if (!validSlug(slug)) return null;
  return snapshot(pool, async db => {
    const row = (await db.query<PublishedRow>(`select ${publicationProjection} from ${publicationFrom} where p.slug=$1`, [slug])).rows[0];
    if (!row) return null;
    const assets = await readImages(db, [row.id]);
    const projected = publication(row, assets.get(row.id) ?? []);
    const categories = (await db.query<{ id: string; name: string }>(`select c.id,c.name from article.publication_categories pc
      join article.categories c on c.id=pc.category_id where pc.publication_id=$1 order by lower(c.name),c.id`, [row.id])).rows;
    const tagIds = (await db.query<{ id: string }>("select tag_id as id from article.publication_tags where publication_id=$1 order by tag_id", [row.id])).rows.map(tag => tag.id);
    const tags = await getFootballTagsByIds(db, tagIds);
    return { ...projected.summary, content: projected.content, images: projected.images, categories, tags,
      formatVersion: ARTICLE_FORMAT_VERSION, seoTitle: row.seoTitle, metaDescription: row.metaDescription };
  });
}

export async function publicArticleSlugExists(db: Queryable, slug: string): Promise<boolean> {
  if (!validSlug(slug)) return false;
  return (await db.query<{ exists: boolean }>("select exists(select 1 from article.publications where slug=$1) as exists", [slug])).rows[0].exists;
}

export async function publicArticlePageExists(db: Queryable, page: number): Promise<boolean> {
  if (!validPage(page)) return false;
  if (page === 1) return true;
  return (await db.query<{ exists: boolean }>(`select exists(select 1 from article.publications
    order by first_published_at desc,article_id offset $1 limit 1) as exists`, [(page - 1) * PUBLIC_ARTICLES_PAGE_SIZE])).rows[0].exists;
}

export async function listPublishedArticleSlugs(db: Queryable): Promise<string[]> {
  return (await db.query<{ slug: string }>("select slug from article.publications order by slug")).rows.map(row => row.slug);
}
