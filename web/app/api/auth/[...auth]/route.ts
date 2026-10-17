import { getDbPool } from "@/src/db/client";
import { handleStaffAuth, authError } from "@/src/auth/http";
import { logger } from "@/src/logging/logger";

export const runtime = "nodejs";
async function handle(request: Request) {
  let response: Response;
  try { response = await handleStaffAuth(request, getDbPool()); }
  catch { response = authError("AUTH_UNAVAILABLE", 503); }
  if (response.status >= 400) {
    const body = await response.clone().json();
    const log = response.status >= 500 ? logger.error : logger.warn;
    log("staff_auth_request_rejected", { requestId: body.error.requestId, context: { code: body.error.code, status: response.status } });
  }
  return response;
}
export const GET = handle;
export const POST = handle;
