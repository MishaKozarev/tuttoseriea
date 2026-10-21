import "server-only";
import { ApplicationError, createApiErrorResponse, resolveRequestId, REQUEST_ID_HEADER } from "../api/errors";
import { requireFootballAdminAccess } from "../identity/football-admin-access";
import { getDbPool } from "../db";
import { FootballTagError, parseTagQuery } from "../taxonomy/football-tags";
import { listFootballTags } from "../taxonomy/football-tags-repository";
export async function listAdminFootballTags(request: Request) {
  const requestId = resolveRequestId(request); let response: Response;
  try {
    await requireFootballAdminAccess();
    response = Response.json(await listFootballTags(getDbPool(), parseTagQuery(new URL(request.url).searchParams)));
  } catch (error) {
    response = createApiErrorResponse(error instanceof FootballTagError ? new ApplicationError({ code: error.code, status: error.status, message: error.message }) : error, requestId);
  }
  response.headers.set(REQUEST_ID_HEADER, requestId); response.headers.set("Cache-Control", "no-store"); return response;
}
