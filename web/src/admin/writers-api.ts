import "server-only";

import { ApplicationError, createApiErrorResponse, REQUEST_ID_HEADER, resolveRequestId } from "../api/errors";
import {
  attachWriter,
  createWriter,
  getOwnWriterProfile,
  listWriters,
  requireOwnWriterAccess,
  requireWriterManagementAccess,
  requireWriterPublicationAccess,
  setWriterPublishOwn,
  updateOwnWriterProfile,
} from "../identity/writer-service";
import { readAdminMutationJson } from "./mutation";

function invalid(message = "Invalid Writer request"): never {
  throw new ApplicationError({ code: "VALIDATION_ERROR", status: 400, message });
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid();
  return value as Record<string, unknown>;
}

function fields(value: Record<string, unknown>, expected: readonly string[]) {
  if (Object.keys(value).length !== expected.length || Object.keys(value).some(key => !expected.includes(key))) invalid();
}

function text(value: unknown): string {
  if (typeof value !== "string") invalid();
  return value;
}

function revision(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) invalid();
  return value;
}

async function reply(request: Request, action: () => Promise<Response>): Promise<Response> {
  const requestId = resolveRequestId(request);
  let response: Response;
  try { response = await action(); }
  catch (error) { response = createApiErrorResponse(error, requestId); }
  response.headers.set(REQUEST_ID_HEADER, requestId);
  response.headers.set("Cache-Control", "no-store");
  return response;
}

function noQuery(request: Request) {
  if (new URL(request.url).searchParams.size) invalid("Unexpected query parameters");
}

export function writersApi(request: Request): Promise<Response> {
  return reply(request, async () => {
    await requireWriterManagementAccess();
    if (request.method === "GET") {
      const query = new URL(request.url).searchParams;
      if ([...query.keys()].some(key => key !== "email") || query.getAll("email").length > 1) invalid();
      const email = query.has("email") ? query.get("email")! : undefined;
      if (email !== undefined && (!email.trim() || email.length > 254)) invalid();
      return Response.json({ writers: await listWriters(email) });
    }
    noQuery(request);
    const body = record(await readAdminMutationJson(request));
    if (body.action === "create") {
      fields(body, ["action", "email", "password", "operationId"]);
      const writer = await createWriter({ email: text(body.email), password: text(body.password), operationId: text(body.operationId) });
      return Response.json({ writer }, { status: 201 });
    }
    if (body.action === "attach") {
      fields(body, ["action", "accountId", "operationId"]);
      return Response.json({ writer: await attachWriter({ accountId: text(body.accountId), operationId: text(body.operationId) }) });
    }
    invalid();
  });
}

export function writerPublicationApi(request: Request, accountId: string): Promise<Response> {
  return reply(request, async () => {
    await requireWriterPublicationAccess();
    noQuery(request);
    const body = record(await readAdminMutationJson(request));
    fields(body, ["enabled", "expectedRevision", "operationId"]);
    if (typeof body.enabled !== "boolean") invalid();
    return Response.json({ profile: await setWriterPublishOwn({ accountId, enabled: body.enabled, expectedRevision: revision(body.expectedRevision), operationId: text(body.operationId) }) });
  });
}

export function ownWriterProfileApi(request: Request): Promise<Response> {
  return reply(request, async () => {
    await requireOwnWriterAccess();
    noQuery(request);
    if (request.method === "GET") return Response.json({ profile: await getOwnWriterProfile() });
    const body = record(await readAdminMutationJson(request));
    fields(body, ["nickname", "socialLinks", "expectedRevision", "operationId"]);
    if (!Array.isArray(body.socialLinks) || body.socialLinks.length > 10) invalid();
    const socialLinks = body.socialLinks.map(value => {
      const link = record(value); fields(link, ["label", "url"]);
      return { label: text(link.label), url: text(link.url) };
    });
    return Response.json({ profile: await updateOwnWriterProfile({ nickname: text(body.nickname), socialLinks, expectedRevision: revision(body.expectedRevision), operationId: text(body.operationId) }) });
  });
}
