import "server-only";

import { ApplicationError, createApiErrorResponse, resolveRequestId, REQUEST_ID_HEADER } from "@/src/api/errors";
import { requireFootballAdminAccess } from "@/src/identity/football-admin-access";
import { AdminJobRepository } from "@/src/jobs/admin-repository";
import { AdminJobRequestError, CANONICAL_UUID, parseAdminJobCommand } from "@/src/jobs/admin-contract";
import { getJobRunnerConfig } from "@/src/jobs/config";

function error(code: string, status: number, message: string) {
  return new ApplicationError({ code, status, message });
}

export function assertFootballAdminMutationOrigin(request: Request): void {
  const configured = process.env.AUTH_URL;
  if (!configured && process.env.NODE_ENV === "production") {
    throw error("INTERNAL_SERVER_ERROR", 500, "Admin origin is not configured");
  }
  const expected = new URL(configured ?? request.url).origin;
  if (request.headers.get("origin") !== expected || request.headers.get("sec-fetch-site") === "cross-site") {
    throw error("FORBIDDEN", 403, "Same-origin Admin request required");
  }
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get("content-type") ?? "")) {
    throw error("BAD_REQUEST", 415, "JSON request required");
  }
}

async function readCommandBody(request: Request): Promise<unknown> {
  const reader = request.body?.getReader();
  if (!reader) throw error("BAD_REQUEST", 400, "JSON body required");
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > 4096) {
        await reader.cancel();
        throw error("BAD_REQUEST", 413, "Admin request body is too large");
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch {
    throw error("BAD_REQUEST", 400, "Invalid JSON body");
  }
}

async function handle(request: Request, operation: (
  repository: AdminJobRepository, actorAccountId: string, correlationId: string,
) => Promise<Response>): Promise<Response> {
  const requestId = resolveRequestId(request);
  let repository: AdminJobRepository | undefined;
  try {
    const identity = await requireFootballAdminAccess();
    repository = new AdminJobRepository(getJobRunnerConfig());
    const response = await operation(repository, identity.accountId, requestId);
    response.headers.set(REQUEST_ID_HEADER, requestId);
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch (caught) {
    const failure = caught instanceof AdminJobRequestError
      ? error(caught.code, caught.status, caught.message) : caught;
    const response = createApiErrorResponse(failure, requestId);
    response.headers.set("Cache-Control", "no-store");
    return response;
  } finally { await repository?.close(); }
}

export function createFootballAdminJob(request: Request): Promise<Response> {
  return handle(request, async (repository, actorAccountId, correlationId) => {
    assertFootballAdminMutationOrigin(request);
    const command = parseAdminJobCommand(await readCommandBody(request));
    const result = await repository.admit(actorAccountId, command, correlationId, getJobRunnerConfig().maxAttempts);
    return Response.json(result, { status: result.deduplicated ? 200 : 202 });
  });
}

export function listFootballAdminJobs(request: Request): Promise<Response> {
  return handle(request, async (repository) => {
    const params = new URL(request.url).searchParams;
    if ([...params.keys()].some((key) => key !== "limit") || params.getAll("limit").length > 1) {
      throw error("VALIDATION_ERROR", 400, "Only a bounded history limit is supported");
    }
    const raw = params.get("limit");
    if (raw !== null && !/^[1-9][0-9]?$/.test(raw)) throw error("VALIDATION_ERROR", 400, "Invalid history limit");
    return Response.json({ requests: await repository.history(raw === null ? 20 : Number(raw)) });
  });
}

export function getFootballAdminJob(request: Request, requestId: string): Promise<Response> {
  return handle(request, async (repository) => {
    if (!CANONICAL_UUID.test(requestId)) throw error("VALIDATION_ERROR", 400, "Invalid Admin request ID");
    const result = await repository.get(requestId);
    if (!result) throw error("NOT_FOUND", 404, "Admin request not found");
    return Response.json({ request: result });
  });
}
