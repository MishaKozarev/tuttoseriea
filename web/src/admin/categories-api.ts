import "server-only";
import { ApplicationError, createApiErrorResponse, resolveRequestId, REQUEST_ID_HEADER } from "../api/errors";
import { getDbPool } from "../db";
import { requireCategoryAdminAccess } from "../identity/category-admin-access";
import { ArticleCategoryRepository, NewsCategoryRepository, type CategoryRepository } from "../categories/repository";
import { CategoryError, parseCategoryQuery, type CategoryKind } from "../categories/management";
import { readAdminMutationJson } from "./mutation";
import { logger } from "../logging/logger";

export async function categoriesApi(request: Request, kind: CategoryKind, id?: string): Promise<Response> {
  const requestId = resolveRequestId(request);
  let response: Response;
  try {
    const actor = await requireCategoryAdminAccess(kind);
    const repository: CategoryRepository = kind === "article" ? new ArticleCategoryRepository(getDbPool()) : new NewsCategoryRepository(getDbPool());
    const query = new URL(request.url).searchParams;
    if (id && query.size || request.method !== "GET" && query.size) throw new CategoryError("VALIDATION_ERROR", 400, "Unexpected query parameters");
    if (request.method === "GET") {
      if (id) {
        const entity = await repository.get(id);
        if (!entity) throw new CategoryError("NOT_FOUND", 404, "Category not found");
        response = Response.json({ entity });
      } else response = Response.json(await repository.list(parseCategoryQuery(query)));
    } else {
      const body = await readAdminMutationJson(request);
      let changedId = id;
      if (request.method === "POST" && !id) {
        const entity = await repository.create(body); changedId = entity.id; response = Response.json({ entity }, { status: 201 });
      }
      else if (request.method === "PATCH" && id) response = Response.json({ entity: await repository.edit(id, body) });
      else if (request.method === "DELETE" && id) { await repository.delete(id, body); response = Response.json({ deleted: true }); }
      else throw new CategoryError("METHOD_NOT_ALLOWED", 405, "Method not allowed");
      logger.info("Category changed", { requestId, context: { actorAccountId: actor.accountId, kind, action: request.method, categoryId: changedId ?? null } });
    }
  } catch (error) {
    response = createApiErrorResponse(error instanceof CategoryError ? new ApplicationError({ code: error.code, status: error.status, message: error.message }) : error, requestId);
  }
  response.headers.set(REQUEST_ID_HEADER, requestId); response.headers.set("Cache-Control", "no-store"); return response;
}
