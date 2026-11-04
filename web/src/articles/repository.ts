import { randomUUID } from "node:crypto";
import type { PoolClient, QueryResultRow } from "pg";
import type { ArticleActor } from "./access";
import type { ArticleDraftDTO, ArticleListDTO, ArticleSummaryDTO, ArticlePublicationDTO } from "./contract";
import type { ArticleDocument } from "./document";
import { getFootballTagsByIds } from "../taxonomy/football-tags-repository";
import { articleSlugCandidate, type ArticleSlugMode } from "./slug";

type Db = Pick<PoolClient, "query">;
type DraftRow = QueryResultRow & {
  id: string; authorAccountId: string; authorName: string; createdAt: Date | string;
  updatedAt: Date | string; revision: number; formatVersion: 1; content: ArticleDocument;
  h1: string; seoTitle: string; metaDescription: string; slug: string; slugMode: ArticleSlugMode;
};
const draftProjection = `a.id,a.author_account_id as "authorAccountId",coalesce(nullif(p.nickname,''),'Автор') as "authorName",
  a.created_at as "createdAt",d.updated_at as "updatedAt",d.revision,d.format_version as "formatVersion",d.content,
  d.h1,d.seo_title as "seoTitle",d.meta_description as "metaDescription",d.slug,d.slug_mode as "slugMode"`;
const draftFrom = `article.articles a join article.drafts d on d.article_id=a.id
  left join identity.writer_profiles p on p.account_id=a.author_account_id`;
const iso = (date: Date | string) => new Date(date).toISOString();

export async function readArticlePublication(db: Db, id: string): Promise<ArticlePublicationDTO | null> {
  const row = (await db.query<ArticlePublicationDTO>(`select revision,source_revision as "sourceRevision",slug,
    first_published_at as "firstPublishedAt",updated_at as "updatedAt" from article.publications where article_id=$1`, [id])).rows[0];
  return row ? { ...row, firstPublishedAt: iso(row.firstPublishedAt), updatedAt: iso(row.updatedAt) } : null;
}

export async function readArticleDraft(db: Db, id: string, canPublish = false): Promise<ArticleDraftDTO | null> {
  const row = (await db.query<DraftRow>(`select ${draftProjection} from ${draftFrom} where a.id=$1`, [id])).rows[0];
  if (!row) return null;
  const categories = (await db.query<{ id: string; name: string }>(`select c.id,c.name from article.draft_categories dc
    join article.categories c on c.id=dc.category_id where dc.draft_id=$1 order by lower(c.name),c.id`, [id])).rows;
  const tagIds = (await db.query<{ id: string }>(`select tag_id as id from article.draft_tags where draft_id=$1 order by tag_id`, [id])).rows.map(r => r.id);
  const tags = await getFootballTagsByIds(db, tagIds);
  const images = (await db.query<{ id: string; width: number; height: number; byteSize: number }>(`select m.id,m.width,m.height,m.byte_size as "byteSize"
    from article.draft_images di join media.assets m on m.id=di.media_id
    where di.draft_id=$1 and m.kind='article_image' order by di.created_at,m.id`, [id])).rows.map(image => ({ ...image, url: `/media/private/${image.id}.webp` }));
  return { ...row, createdAt: iso(row.createdAt), updatedAt: iso(row.updatedAt), categories,
    categoryIds: categories.map(c => c.id), tagIds, tags, images, canPublish, publication: await readArticlePublication(db, id) };
}

export async function readArticleList(db: Db, actor: ArticleActor, page: number, scope: "own" | "all"): Promise<ArticleListDTO> {
  const result = (await db.query<{ total: number; items: ArticleSummaryDTO[] }>(`with filtered as materialized (
    select a.id,a.author_account_id as "authorAccountId",coalesce(nullif(p.nickname,''),'Автор') as "authorName",
      a.created_at as "createdAt",d.updated_at as "updatedAt",d.revision,d.h1,
      case when pub.article_id is null then null else jsonb_build_object('revision',pub.revision,
        'sourceRevision',pub.source_revision,'slug',pub.slug,'firstPublishedAt',pub.first_published_at,'updatedAt',pub.updated_at) end as publication
      from ${draftFrom} left join article.publications pub on pub.article_id=a.id
    where ($1::boolean or a.author_account_id=$2)
  ), page as (select * from filtered order by "updatedAt" desc,id limit 20 offset $3)
  select (select count(*)::int from filtered) as total,
    coalesce((select jsonb_agg(p order by p."updatedAt" desc,p.id) from page p),'[]'::jsonb) as items`,
  [scope === "all" && actor.manageAll, actor.accountId, (page - 1) * 20])).rows[0];
  return { total: result.total, page, totalPages: Math.ceil(result.total / 20),
    items: result.items.map(row => ({ ...row, createdAt: iso(row.createdAt), updatedAt: iso(row.updatedAt),
      publication: row.publication ? { ...row.publication, firstPublishedAt: iso(row.publication.firstPublishedAt), updatedAt: iso(row.publication.updatedAt) } : null })) };
}

export async function lockArticleDraft(db: Db, id: string, actor: ArticleActor, mode: "read" | "write") {
  return (await db.query<{ id: string; revision: number }>(`select a.id,d.revision from article.articles a
    join article.drafts d on d.article_id=a.id where a.id=$1 and ($2::boolean or a.author_account_id=$3)
    for ${mode === "write" ? "update" : "share"} of d`, [id, actor.manageAll, actor.accountId])).rows[0] ?? null;
}

export async function insertArticleDraft(db: Db, accountId: string, content: ArticleDocument): Promise<string> {
  const id = randomUUID();
  await db.query(`insert into article.articles(id,author_account_id) values($1,$2)`, [id, accountId]);
  await db.query(`insert into article.drafts(article_id,content) values($1,$2::jsonb)`, [id, JSON.stringify(content)]);
  return id;
}

/** Reserve a final address in the same transaction as save/first publication. */
export async function assignArticleDraftSlug(db: Db, id: string, base: string, mode: ArticleSlugMode): Promise<string> {
  // All application allocators share this lock, including overlapping suffix
  // families such as "name" -> "name-2" and a manual base of "name-2".
  await db.query("select pg_advisory_xact_lock(910230212,1)");
  if (!base) {
    await db.query("update article.drafts set slug='',slug_mode=$2 where article_id=$1", [id, mode]);
    return "";
  }
  for (let start = 0; Number.isSafeInteger(start); start += 128) {
    const candidates = Array.from({ length: 128 }, (_, index) => articleSlugCandidate(base, start + index));
    const occupied = new Set((await db.query<{ slug: string }>(`select slug from article.drafts where article_id<>$1 and slug=any($2::text[])
      union select slug from article.publications where article_id<>$1 and slug=any($2::text[])`, [id, candidates])).rows.map(row => row.slug));
    for (const slug of candidates) {
      if (occupied.has(slug)) continue;
      await db.query("savepoint article_slug_candidate");
      try {
        await db.query("update article.drafts set slug=$2,slug_mode=$3 where article_id=$1", [id, slug, mode]);
        await db.query("release savepoint article_slug_candidate");
        return slug;
      } catch (error) {
        await db.query("rollback to savepoint article_slug_candidate");
        await db.query("release savepoint article_slug_candidate");
        const failure = error as { code?: string; constraint?: string };
        if (failure.code !== "23505" || failure.constraint !== "article_drafts_slug_unique") throw error;
        // A writer outside the application lock still cannot defeat the unique
        // index. Try the next candidate, rather than asking the author for one.
      }
    }
  }
  throw new Error("Article address allocation exhausted");
}

export type ArticleReceipt = { actorAccountId: string; articleId: string; action: string; fingerprint: string; result: { revision: number; result?: unknown } };
export async function readArticleReceipt(db: Db, operationId: string): Promise<ArticleReceipt | null> {
  return (await db.query<ArticleReceipt>(`select actor_account_id as "actorAccountId",article_id as "articleId",action,fingerprint,result
    from article.operation_receipts where operation_id=$1`, [operationId])).rows[0] ?? null;
}
export async function insertArticleReceipt(db: Db, operationId: string, receipt: ArticleReceipt) {
  await db.query(`insert into article.operation_receipts(operation_id,actor_account_id,article_id,action,fingerprint,result)
    values($1,$2,$3,$4,$5,$6::jsonb)`, [operationId, receipt.actorAccountId, receipt.articleId, receipt.action, receipt.fingerprint, JSON.stringify(receipt.result)]);
}
