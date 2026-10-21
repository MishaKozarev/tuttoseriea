import "server-only";
import { ApplicationError } from "../api/errors";
function reject(code: string, status: number, message: string): never {
  throw new ApplicationError({ code, status, message });
}
// Shared CSRF/body boundary. Callers must independently authorize every operation first.
export async function readAdminMutationJson(request: Request): Promise<unknown> {
  const trusted = process.env.AUTH_URL;
  if (!trusted && process.env.NODE_ENV === "production") reject("INTERNAL_SERVER_ERROR", 500, "Admin origin is not configured");
  if (request.headers.get("origin") !== new URL(trusted ?? request.url).origin || request.headers.get("sec-fetch-site") === "cross-site") {
    reject("FORBIDDEN", 403, "Same-origin Admin request required");
  }
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get("content-type") ?? "")) reject("BAD_REQUEST", 415, "JSON request required");
  const reader = request.body?.getReader();
  if (!reader) reject("BAD_REQUEST", 400, "JSON body required");
  const chunks: Uint8Array[] = []; let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      length += value.byteLength;
      if (length > 4096) { await reader.cancel(); reject("BAD_REQUEST", 413, "Admin request is too large"); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { reject("BAD_REQUEST", 400, "Invalid JSON body"); }
}
