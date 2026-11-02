import "server-only";
import { createHash, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { getDbPool } from "../db";
import { createForbiddenError } from "../api/access";
import { ArticleCategoryRepository } from "../categories/repository";
import { parseCategoryQuery } from "../categories/management";
import { listFootballTags, getFootballTagsByIds } from "../taxonomy/football-tags-repository";
import { parseTagQuery } from "../taxonomy/football-tags";
import { articleNotFound, requireArticleActor, revalidateArticleActor, type ArticleActor } from "./access";
import { articleError, articleId, articleOperationId, articleRevision, parseArticleCreate, parseArticleSave,
  type ArticleDraftDTO, type ArticleListQuery } from "./contract";
import { articleImageIds, EMPTY_ARTICLE_DOCUMENT } from "./document";
import { insertArticleDraft, insertArticleReceipt, lockArticleDraft, readArticleDraft, readArticleList,
  readArticleReceipt, type ArticleReceipt } from "./repository";

type Operation = { operationId: string; fingerprint: string };
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
function conflict(): never { articleError("ARTICLE_CONFLICT", 409, "Черновик изменился. Загрузите актуальную версию перед сохранением."); }
function operationConflict(): never { articleError("ARTICLE_OPERATION_CONFLICT", 409, "Идентификатор операции уже использован для другого запроса."); }
function mapDatabaseError(error: unknown): never {
  const db = error as { code?: string; constraint?: string };
  if (db?.code === "40P01" || db?.code === "40001") conflict();
  if (db?.code === "23505" && db.constraint === "article_drafts_slug_unique") articleError("ARTICLE_SLUG_CONFLICT", 409, "Этот slug уже используется другой статьёй.");
  if (db?.code === "23503" || db?.code === "23514") articleError("VALIDATION_ERROR", 400, "Связанные данные статьи изменились. Обновите справочники.");
  throw error;
}

async function transaction<T>(actor: ArticleActor, work: (client: PoolClient, current: ArticleActor) => Promise<T>, operationId?: string): Promise<T> {
  const client = await getDbPool().connect();
  try {
    await client.query("begin");
    // Order is operation -> canonical auth user -> draft row, for every mutation.
    if (operationId) await client.query("select pg_advisory_xact_lock(910230210,hashtext($1))", [operationId]);
    const current = await revalidateArticleActor(client, actor);
    const result = await work(client, current);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback");
    mapDatabaseError(error);
  } finally { client.release(); }
}

function matchReceipt(receipt: ArticleReceipt, actor: ArticleActor, id: string | null, action: string, fingerprint: string) {
  if (receipt.actorAccountId !== actor.accountId || id !== null && receipt.articleId !== id || receipt.action !== action || receipt.fingerprint !== fingerprint) operationConflict();
}
async function audit(client: PoolClient, actor: ArticleActor, id: string, action: string, revision: number, operationId: string) {
  await client.query(`insert into auth.security_audit(id,operation_id,event_type,operator,target_account_id,details)
    values($1,$2,'article_draft_changed',$3,$4,$5::jsonb)`, [randomUUID(), operationId, `account:${actor.accountId}`, actor.accountId,
    JSON.stringify({ articleId: id, action, revision })]);
}

export async function listArticleDrafts(query: ArticleListQuery) {
  const actor = await requireArticleActor();
  if (!Number.isSafeInteger(query.page) || query.page < 1 || query.page > 999999 || query.scope !== undefined && !["own", "all"].includes(query.scope)) articleError();
  return transaction(actor, async (client, current) => {
    const scope = query.scope ?? (current.manageAll ? "all" : "own");
    if (scope === "all" && !current.manageAll) throw createForbiddenError();
    return readArticleList(client, current, query.page, scope);
  });
}

export async function getArticleDraft(value: string): Promise<ArticleDraftDTO> {
  const actor = await requireArticleActor(), id = articleId(value);
  return transaction(actor, async (client, current) => {
    if (!await lockArticleDraft(client, id, current, "read")) articleNotFound();
    return (await readArticleDraft(client, id))!;
  });
}

export async function createArticleDraft(value: unknown): Promise<ArticleDraftDTO> {
  const actor = await requireArticleActor(), input = parseArticleCreate(value), fingerprint = digest({ action: "create" });
  return transaction(actor, async (client, current) => {
    const receipt = await readArticleReceipt(client, input.operationId);
    if (receipt) {
      matchReceipt(receipt, current, null, "create", fingerprint);
      if (!await lockArticleDraft(client, receipt.articleId, current, "read")) articleNotFound();
      return (await readArticleDraft(client, receipt.articleId))!;
    }
    const id = await insertArticleDraft(client, current.accountId, EMPTY_ARTICLE_DOCUMENT);
    await insertArticleReceipt(client, input.operationId, { actorAccountId: current.accountId, articleId: id, action: "create", fingerprint, result: { revision: 0 } });
    await audit(client, current, id, "create", 0, input.operationId);
    return (await readArticleDraft(client, id))!;
  }, input.operationId);
}

async function executeDraftWrite<T>(id: string, expectedRevision: number, work: (client: PoolClient, actor: ArticleActor, nextRevision: number) => Promise<T>, operation: Operation | undefined, action: "save" | "image") {
  const actor = await requireArticleActor();
  articleId(id); articleRevision(expectedRevision);
  if (operation) {
    articleOperationId(operation.operationId);
    if (!/^[0-9a-f]{64}$/.test(operation.fingerprint)) articleError();
  }
  return transaction(actor, async (client, current) => {
    const draft = await lockArticleDraft(client, id, current, "write");
    if (!draft) articleNotFound();
    if (operation) {
      const receipt = await readArticleReceipt(client, operation.operationId);
      if (receipt) {
        matchReceipt(receipt, current, id, action, operation.fingerprint);
        return { result: receipt.result.result as T, revision: receipt.result.revision };
      }
    }
    if (draft.revision !== expectedRevision) conflict();
    const nextRevision = draft.revision + 1;
    // Increment before the callback so its DTO observes the new revision. Any
    // callback/reference/receipt failure rolls the entire aggregate back.
    const updated = await client.query(`update article.drafts set revision=revision+1,updated_at=clock_timestamp()
      where article_id=$1 and revision=$2 returning revision`, [id, expectedRevision]);
    if (!updated.rows.length) conflict();
    const result = await work(client, current, nextRevision);
    if (operation) {
      await insertArticleReceipt(client, operation.operationId, { actorAccountId: current.accountId, articleId: id, action,
        fingerprint: operation.fingerprint, result: { revision: nextRevision, ...(action === "image" ? { result } : {}) } });
      await audit(client, current, id, action, nextRevision, operation.operationId);
    }
    return { result, revision: nextRevision };
  }, operation?.operationId);
}

// Media writes file bytes before entering this transaction. This helper owns the
// auth/ownership/row locks, CAS and the single revision increment, never the file.
export function withArticleDraftWrite<T>(id: string, expectedRevision: number,
  work: (client: PoolClient, actor: ArticleActor, nextRevision: number) => Promise<T>, operation?: Operation): Promise<{ result: T; revision: number }> {
  return executeDraftWrite(id, expectedRevision, work, operation, "image");
}

export async function saveArticleDraft(id: string, value: unknown): Promise<ArticleDraftDTO> {
  const input = parseArticleSave(value);
  const categoryIds = [...input.categoryIds].sort(), tagIds = [...input.tagIds].sort();
  const fingerprint = digest({ ...input, operationId: undefined, categoryIds, tagIds });
  const saved = await executeDraftWrite(id, input.expectedRevision, async (client) => {
    const categories = new ArticleCategoryRepository(client);
    for (const categoryId of categoryIds) if (!await categories.get(categoryId)) articleError("VALIDATION_ERROR", 400, "Категория не найдена.");
    const tags = await getFootballTagsByIds(client, tagIds);
    if (tags.length !== tagIds.length) articleError("VALIDATION_ERROR", 400, "Football Tag не найден.");
    const imageIds = articleImageIds(input.content);
    if (imageIds.length) {
      const attached = await client.query(`select di.media_id from article.draft_images di join media.assets m on m.id=di.media_id
        where di.draft_id=$1 and di.media_id=any($2::text[]) and m.kind='article_image'`, [id, imageIds]);
      if (attached.rows.length !== imageIds.length) articleError("ARTICLE_IMAGE_NOT_ATTACHED", 400, "Изображение не принадлежит этому черновику.");
    }
    await client.query(`update article.drafts set format_version=$2,content=$3::jsonb,h1=$4,seo_title=$5,meta_description=$6,slug=$7 where article_id=$1`,
    [id, input.formatVersion, JSON.stringify(input.content), input.h1, input.seoTitle, input.metaDescription, input.slug]);
    await client.query("delete from article.draft_categories where draft_id=$1", [id]);
    if (categoryIds.length) await client.query(`insert into article.draft_categories(draft_id,category_id) select $1,unnest($2::text[])`, [id, categoryIds]);
    await client.query("delete from article.draft_tags where draft_id=$1", [id]);
    if (tagIds.length) await client.query(`insert into article.draft_tags(draft_id,tag_id) select $1,unnest($2::text[])`, [id, tagIds]);
    return (await readArticleDraft(client, id))!;
  }, { operationId: input.operationId, fingerprint }, "save");
  // A retry never reapplies a stale payload; return the current canonical draft.
  return saved.result ?? getArticleDraft(id);
}

export async function lookupArticleCategories(params: URLSearchParams) {
  const actor = await requireArticleActor(), query = parseCategoryQuery(params);
  return transaction(actor, (client) => new ArticleCategoryRepository(client).list(query));
}
export async function lookupArticleTags(params: URLSearchParams) {
  const actor = await requireArticleActor(), query = parseTagQuery(params);
  return transaction(actor, (client) => listFootballTags(client, query));
}
