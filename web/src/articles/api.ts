import "server-only";
import { ApplicationError, createApiErrorResponse, resolveRequestId, REQUEST_ID_HEADER } from "../api/errors";
import { assertAdminMutationOrigin } from "../admin/mutation";
import { CategoryError } from "../categories/management";
import { FootballTagError } from "../taxonomy/football-tags";
import { requireArticleActor, requireArticleDraftAccess, requireArticlePublicationAccess } from "./access";
import { ARTICLE_MAX_BODY_BYTES, ArticleError, articleError, parseArticleListQuery } from "./contract";
import { createArticleDraft, getArticleDraft, listArticleDrafts, lookupArticleCategories, lookupArticleTags, saveArticleDraft, publishArticleDraft } from "./service";

export async function readArticleMutationJson(request: Request): Promise<unknown> {
  assertAdminMutationOrigin(request);
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get("content-type") ?? "")) articleError("BAD_REQUEST", 415, "Ожидается JSON.");
  const reader = request.body?.getReader();
  if (!reader) articleError("BAD_REQUEST", 400, "Необходимо тело запроса.");
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > ARTICLE_MAX_BODY_BYTES) { await reader.cancel(); articleError("ARTICLE_TOO_LARGE", 413, "Статья превышает допустимый размер."); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks))); }
  catch { articleError("BAD_REQUEST", 400, "Некорректный JSON."); }
}

async function boundary(request: Request, work: () => Promise<Response>): Promise<Response> {
  const requestId = resolveRequestId(request); let response: Response;
  try { response = await work(); }
  catch (error) {
    const known = error instanceof ArticleError || error instanceof CategoryError || error instanceof FootballTagError;
    response = createApiErrorResponse(known ? new ApplicationError({ code: error.code, status: error.status, message: error.message }) : error, requestId);
  }
  response.headers.set(REQUEST_ID_HEADER, requestId);
  response.headers.set("Cache-Control", "no-store");
  return response;
}
function noQuery(request: Request) { if (new URL(request.url).searchParams.size) articleError(); }

export function articlesCollectionApi(request: Request) {
  return boundary(request, async () => {
    await requireArticleActor();
    if (request.method === "GET") return Response.json(await listArticleDrafts(parseArticleListQuery(new URL(request.url).searchParams)));
    noQuery(request);
    const draft = await createArticleDraft(await readArticleMutationJson(request));
    return Response.json({ draft }, { status: 201 });
  });
}
export function articleDraftApi(request: Request, articleId: string) {
  return boundary(request, async () => {
    await requireArticleDraftAccess(articleId);
    noQuery(request);
    if (request.method === "GET") return Response.json({ draft: await getArticleDraft(articleId) });
    return Response.json({ draft: await saveArticleDraft(articleId, await readArticleMutationJson(request)) });
  });
}
export function articleOptionsApi(request: Request, kind: "categories" | "tags") {
  return boundary(request, async () => {
    await requireArticleActor();
    const params = new URL(request.url).searchParams;
    return Response.json(kind === "categories" ? await lookupArticleCategories(params) : await lookupArticleTags(params));
  });
}
export function articlePublicationApi(request: Request, articleId: string) {
  return boundary(request, async () => {
    await requireArticlePublicationAccess(articleId);
    noQuery(request);
    return Response.json({ draft: await publishArticleDraft(articleId, await readArticleMutationJson(request)) });
  });
}
