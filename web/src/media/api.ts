import "server-only";
import { createApiErrorResponse, resolveRequestId, REQUEST_ID_HEADER } from "../api/errors";
import { AuthSecurityError, AuthSecurityStore } from "../auth/security-store";
import { getAuthConfig } from "../auth/config";
import { getDbPool } from "../db";
import { assertAdminMutationOrigin } from "../admin/mutation";
import { attachOwnAvatar, requireOwnWriterAccess } from "../identity/writer-service";
import { AVATAR_MAX_BYTES, normalizeAvatar } from "./image";
import { mediaError, preventMediaCaching, PUBLIC_MEDIA_CACHE } from "./errors";
import { findLinkedAvatar } from "./repository";
import { MEDIA_ID_PATTERN, mediaRoot, readAvatarFile, saveAvatarFile } from "./storage";

function assertAvatarMutation(request: Request): { expectedRevision: number; operationId: string; mime: string } {
  const url = new URL(request.url);
  assertAdminMutationOrigin(request);
  if (url.search) throw mediaError("VALIDATION_ERROR", 400, "Unexpected query parameters");
  const revision = request.headers.get("x-profile-revision") ?? "";
  const operationId = request.headers.get("x-operation-id") ?? "";
  if (!/^(0|[1-9][0-9]{0,9})$/.test(revision) || Number(revision) >= 2_147_483_647 || !MEDIA_ID_PATTERN.test(operationId)) {
    throw mediaError("VALIDATION_ERROR", 400, "A profile revision and operation ID are required");
  }
  const mime = request.headers.get("content-type")?.toLowerCase() ?? "";
  if (!["image/jpeg", "image/png", "image/webp"].includes(mime)) throw mediaError("MEDIA_INVALID_IMAGE", 415, "Use JPEG, PNG or WebP");
  return { expectedRevision: Number(revision), operationId, mime };
}

async function readUpload(request: Request): Promise<Buffer> {
  const length = request.headers.get("content-length");
  if (length && (!/^[0-9]+$/.test(length) || Number(length) > AVATAR_MAX_BYTES)) throw mediaError("MEDIA_TOO_LARGE", 413, "Avatar exceeds 5 MiB");
  const reader = request.body?.getReader();
  if (!reader) throw mediaError("MEDIA_INVALID_IMAGE", 400, "An image is required");
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > AVATAR_MAX_BYTES) { await reader.cancel(); throw mediaError("MEDIA_TOO_LARGE", 413, "Avatar exceeds 5 MiB"); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks, size);
}

export async function uploadOwnAvatar(request: Request): Promise<Response> {
  const requestId = resolveRequestId(request);
  let response: Response;
  try {
    const actor = await requireOwnWriterAccess(); // Authorization precedes even reading the body.
    const input = assertAvatarMutation(request);
    await new AuthSecurityStore(getDbPool(), getAuthConfig().secret).rateLimit("media/avatar", actor.accountId, 10, 60);
    const root = await mediaRoot();
    const image = await normalizeAvatar(await readUpload(request), input.mime);
    const asset = await saveAvatarFile(root, image, actor.accountId);
    const profile = await attachOwnAvatar({ actor, asset, expectedRevision: input.expectedRevision, operationId: input.operationId });
    response = Response.json({ profile }, { status: 200 });
  } catch (error) {
    response = createApiErrorResponse(error instanceof AuthSecurityError ? mediaError(error.code, error.status, "Upload is temporarily unavailable") : error, requestId);
  }
  response.headers.set(REQUEST_ID_HEADER, requestId);
  return preventMediaCaching(response);
}

export async function serveAvatar(request: Request, filename: string, visibility: "public" | "private"): Promise<Response> {
  const requestId = resolveRequestId(request);
  try {
    const id = filename.slice(0, -5);
    const canonical = `/media/${visibility}/${id}.webp`;
    const url = new URL(request.url);
    if (!MEDIA_ID_PATTERN.test(id) || filename !== `${id}.webp` || url.pathname !== canonical || url.search ||
      !["GET", "HEAD"].includes(request.method) || request.headers.has("range")) throw mediaError("NOT_FOUND", 404, "Image not found");
    const actor = visibility === "private" ? await requireOwnWriterAccess() : undefined;
    const asset = await findLinkedAvatar(id, actor?.accountId);
    if (!asset) throw mediaError("NOT_FOUND", 404, "Image not found");
    const bytes = await readAvatarFile(await mediaRoot(), asset);
    const headers = new Headers({ "Content-Type": "image/webp", "Content-Length": String(bytes.length),
      "X-Content-Type-Options": "nosniff", "Content-Disposition": `inline; filename="${filename}"`, [REQUEST_ID_HEADER]: requestId });
    const response = new Response(request.method === "HEAD" ? null : new Uint8Array(bytes), { headers });
    if (visibility === "private") return preventMediaCaching(response);
    response.headers.set("Cache-Control", PUBLIC_MEDIA_CACHE);
    response.headers.set("Cloudflare-CDN-Cache-Control", "public, max-age=3600, must-revalidate");
    return response;
  } catch (error) { return preventMediaCaching(createApiErrorResponse(error, requestId)); }
}

export function rejectMediaMethod(request: Request): Response {
  return preventMediaCaching(createApiErrorResponse(mediaError("METHOD_NOT_ALLOWED", 405, "Method not allowed"), request));
}
