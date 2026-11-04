import type { FootballTag } from "../taxonomy/football-tags";
import { ARTICLE_FORMAT_VERSION, articleError, articleFields, articleMediaId, articleRecord, parseArticleDocument, type ArticleDocument } from "./document";
import type { ArticleSlugMode } from "./slug";
export { ArticleError, articleError } from "./document";
export const ARTICLE_MAX_BODY_BYTES = 1024 * 1024;
export type ArticleImageDTO = { id: string; url: string; width: number; height: number; byteSize: number };
export type ArticlePublicationDTO = { revision: number; sourceRevision: number; slug: string; firstPublishedAt: string; updatedAt: string };
export type ArticleSummaryDTO = { id: string; authorAccountId: string; authorName: string; h1: string; revision: number; createdAt: string; updatedAt: string; publication: ArticlePublicationDTO | null };
export type ArticleListDTO = { items: ArticleSummaryDTO[]; page: number; total: number; totalPages: number };
export type ArticleDraftDTO = ArticleSummaryDTO & {
  formatVersion: typeof ARTICLE_FORMAT_VERSION; content: ArticleDocument;
  seoTitle: string; metaDescription: string; slug: string; slugMode: ArticleSlugMode; canPublish: boolean;
  categoryIds: string[]; tagIds: string[];
  categories: { id: string; name: string }[]; tags: FootballTag[]; images: ArticleImageDTO[];
};
export type ArticleListQuery = { page: number; scope?: "own" | "all" };
export type ArticleCreateInput = { operationId: string };
export type ArticlePublicationInput = {
  action: "publish" | "update"; operationId: string; expectedRevision: number; expectedPublicationRevision: number;
};
export type ArticleSaveInput = {
  operationId: string; expectedRevision: number; formatVersion: typeof ARTICLE_FORMAT_VERSION;
  content: ArticleDocument; h1: string; seoTitle: string; metaDescription: string; slug?: string; slugMode?: ArticleSlugMode;
  categoryIds: string[]; tagIds: string[];
};
export const articleId = articleMediaId;
export const articleOperationId = articleMediaId;
export function articleRevision(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0 || Number(value) >= 2_147_483_647) articleError();
  return Number(value);
}
function field(value: unknown, max: number): string {
  if (typeof value !== "string" || [...value].length > max || /[\p{Cc}\p{Cf}]/u.test(value)) articleError();
  return value.trim();
}
function ids(value: unknown, max: number): string[] {
  if (!Array.isArray(value) || value.length > max) articleError();
  const values = value.map(id => {
    if (typeof id !== "string" || !id || id.length > 128 || /[\p{Cc}\p{Cf}/\\]/u.test(id) || id !== id.trim()) articleError();
    return id;
  });
  if (new Set(values).size !== values.length) articleError();
  return values;
}
export function parseArticleCreate(value: unknown): ArticleCreateInput {
  const input = articleRecord(value); articleFields(input, ["operationId"]);
  return { operationId: articleOperationId(input.operationId) };
}
export function parseArticlePublication(value: unknown): ArticlePublicationInput {
  const input = articleRecord(value);
  articleFields(input, ["action", "operationId", "expectedRevision", "expectedPublicationRevision"]);
  if (input.action !== "publish" && input.action !== "update") articleError();
  const expectedPublicationRevision = articleRevision(input.expectedPublicationRevision);
  if (input.action === "publish" && expectedPublicationRevision !== 0 || input.action === "update" && expectedPublicationRevision === 0) articleError();
  return { action: input.action, operationId: articleOperationId(input.operationId), expectedRevision: articleRevision(input.expectedRevision), expectedPublicationRevision };
}
export function parseArticleSave(value: unknown): ArticleSaveInput {
  const input = articleRecord(value);
  articleFields(input, ["operationId", "expectedRevision", "formatVersion", "content", "h1", "seoTitle", "metaDescription", "slug", "slugMode", "categoryIds", "tagIds"]);
  if (input.formatVersion !== ARTICLE_FORMAT_VERSION) articleError("ARTICLE_FORMAT_UNSUPPORTED", 400, "Версия формата статьи не поддерживается.");
  const slug = input.slug === undefined ? undefined : field(input.slug, 160);
  if (input.slugMode !== undefined && input.slugMode !== "auto" && input.slugMode !== "manual") articleError();
  if (slug && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) articleError("ARTICLE_SLUG_INVALID", 400, "Slug: латинские строчные буквы, цифры и дефисы между словами.");
  return { operationId: articleOperationId(input.operationId), expectedRevision: articleRevision(input.expectedRevision),
    formatVersion: ARTICLE_FORMAT_VERSION, content: parseArticleDocument(input.content),
    h1: field(input.h1, 300), seoTitle: field(input.seoTitle, 300), metaDescription: field(input.metaDescription, 500), slug, slugMode: input.slugMode,
    categoryIds: ids(input.categoryIds, 20), tagIds: ids(input.tagIds, 50) };
}
export function parseArticleListQuery(params: URLSearchParams): ArticleListQuery {
  if ([...params.keys()].some(key => !["page", "scope"].includes(key) || params.getAll(key).length !== 1)) articleError();
  const page = params.get("page") ?? "1", scope = params.get("scope");
  if (!/^[1-9][0-9]{0,5}$/.test(page) || scope !== null && scope !== "own" && scope !== "all") articleError();
  return { page: Number(page), ...(scope ? { scope: scope as "own" | "all" } : {}) };
}
export const parseCreateArticle = parseArticleCreate;
export const parseSaveArticle = parseArticleSave;
