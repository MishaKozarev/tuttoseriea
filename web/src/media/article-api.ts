import "server-only";
import { createApiErrorResponse, resolveRequestId, REQUEST_ID_HEADER } from "../api/errors";
import { assertAdminMutationOrigin } from "../admin/mutation";
import { requireArticleDraftAccess } from "../articles/access";
import { ArticleError } from "../articles/contract";
import { getAuthConfig } from "../auth/config";
import { AuthSecurityError, AuthSecurityStore } from "../auth/security-store";
import { getDbPool } from "../db";
import { readMediaUpload } from "./api";
import { normalizeArticleImage } from "./image";
import { mediaError, preventMediaCaching } from "./errors";
import { MEDIA_ID_PATTERN, mediaRoot, saveArticleImageFile } from "./storage";
import { attachArticleDraftImage } from "./repository";

function uploadInput(request: Request) {
  assertAdminMutationOrigin(request);
  if (new URL(request.url).search) throw mediaError("VALIDATION_ERROR", 400, "Unexpected query parameters");
  const revision = request.headers.get("x-article-revision") ?? "";
  const operationId = request.headers.get("x-operation-id") ?? "";
  if (!/^(0|[1-9][0-9]{0,9})$/.test(revision) || Number(revision) >= 2_147_483_647 || !MEDIA_ID_PATTERN.test(operationId)) {
    throw mediaError("VALIDATION_ERROR", 400, "An Article revision and operation ID are required");
  }
  const mime = request.headers.get("content-type")?.toLowerCase() ?? "";
  if (!["image/jpeg", "image/png", "image/webp"].includes(mime)) throw mediaError("MEDIA_INVALID_IMAGE", 415, "Use JPEG, PNG or WebP");
  return { expectedRevision: Number(revision), operationId, mime };
}

export async function uploadArticleDraftImage(request: Request, articleId: string): Promise<Response> {
  const requestId = resolveRequestId(request);
  let response: Response;
  try {
    const actor = await requireArticleDraftAccess(articleId);
    const input = uploadInput(request);
    await new AuthSecurityStore(getDbPool(), getAuthConfig().secret).rateLimit("media/article-image", actor.accountId, 10, 60);
    const root = await mediaRoot();
    const image = await normalizeArticleImage(await readMediaUpload(request), input.mime);
    const asset = await saveArticleImageFile(root, image, actor.accountId);
    const result = await attachArticleDraftImage({ articleId, expectedRevision: input.expectedRevision, operationId: input.operationId, asset });
    response = Response.json({ image: result.result, revision: result.revision }, { status: 200 });
  } catch (error) {
    const safeError = error instanceof AuthSecurityError ? mediaError(error.code, error.status, "Upload is temporarily unavailable") :
      error instanceof ArticleError ? mediaError(error.code, error.status, error.message) : error;
    response = createApiErrorResponse(safeError, requestId);
  }
  response.headers.set(REQUEST_ID_HEADER, requestId);
  return preventMediaCaching(response);
}
