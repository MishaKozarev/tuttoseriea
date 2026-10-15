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
async function readEdit(request: Request): Promise<unknown> {
  const trusted = process.env.AUTH_URL;
  if (!trusted && process.env.NODE_ENV === "production") reject("INTERNAL_SERVER_ERROR", 500, "Admin origin is not configured");
  if (request.headers.get("origin") !== new URL(trusted ?? request.url).origin || request.headers.get("sec-fetch-site") === "cross-site") {
    reject("FORBIDDEN", 403, "Same-origin Admin request required");
  }
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get("content-type") ?? "")) reject("BAD_REQUEST", 415, "JSON request required");
  const reader = request.body?.getReader();
  if (!reader) reject("BAD_REQUEST", 400, "JSON body required");
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > 4096) { await reader.cancel(); reject("BAD_REQUEST", 413, "Localization request is too large"); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { reject("BAD_REQUEST", 400, "Invalid JSON body"); }
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
