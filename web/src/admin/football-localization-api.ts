import { readAdminMutationJson as readEdit } from "./mutation";
import "server-only";

import { ApplicationError, createApiErrorResponse, resolveRequestId, REQUEST_ID_HEADER } from "../api/errors";
import { getDbPool } from "../db";
import { requireFootballAdminAccess } from "../identity/football-admin-access";
import { FootballLocalizationRepository } from "../football/localization-repository";
import { FootballLocalizationError, localizationId, localizationKind, parseLocalizationEdit, parseLocalizationQuery } from "../football/localization-management";
import { logger } from "../logging/logger";

async function handle(request: Request, operation: (repository: FootballLocalizationRepository, actorId: string, requestId: string) => Promise<Response>) {
  const requestId = resolveRequestId(request);
  try {
    const identity = await requireFootballAdminAccess();
    const response = await operation(new FootballLocalizationRepository(getDbPool()), identity.accountId, requestId);
    response.headers.set(REQUEST_ID_HEADER, requestId);
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch (caught) {
    const error = caught instanceof FootballLocalizationError
      ? new ApplicationError({ code: caught.code, status: caught.status, message: caught.message }) : caught;
    const response = createApiErrorResponse(error, requestId);
    response.headers.set("Cache-Control", "no-store");
    return response;
  }
}

function reject(code: string, status: number, message: string): never {
  throw new ApplicationError({ code, status, message });
}
function noQuery(request: Request) {
  if (new URL(request.url).search) reject("VALIDATION_ERROR", 400, "No entity query parameters are supported");
}
export function listFootballLocalizations(request: Request) {
  return handle(request, async (repository) => Response.json(await repository.list(parseLocalizationQuery(new URL(request.url).searchParams))));
}
export function getFootballLocalization(request: Request, kind: string, id: string) {
  return handle(request, async (repository) => {
    noQuery(request);
    const entity = await repository.get(localizationKind(kind), localizationId(id));
    if (!entity) reject("NOT_FOUND", 404, "Football entity not found");
    return Response.json({ entity });
  });
}
export function editFootballLocalization(request: Request, kind: string, id: string) {
  return handle(request, async (repository, actorId, requestId) => {
    noQuery(request);
    const entityKind = localizationKind(kind);
    const entityId = localizationId(id);
    const edit = parseLocalizationEdit(await readEdit(request));
    const entity = await repository.edit(entityKind, entityId, edit);
    logger.info("Football localization edited", { requestId, context: {
      actorAccountId: actorId, entityKind, entityId, action: edit.action, localizationRevision: entity.localizationRevision,
    } });
    return Response.json({ entity });
  });
}
