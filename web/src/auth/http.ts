import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import { hashPassword, verifyPassword } from "better-auth/crypto";
import { APIError } from "better-auth/api";
import * as schema from "../db/schema";
import { getAuthConfig, validStaffPassword, type AuthConfig } from "./config";
import { AuthSecurityError, AuthSecurityStore, fullStaffSession } from "./security-store";
import { createStaffAuth, newAuthRequestState, STAFF_AUTH_GET_PATHS, STAFF_AUTH_POST_PATHS } from "./foundation";
import { createAuthEmailSender, type AuthEmailSender } from "../email/resend";

const passwordPaths = new Set(["/password-change/start", "/password-change/confirm"]);
const fields: Record<string, string[]> = {
  "/sign-in/email": ["email", "password", "rememberMe"], "/sign-out": [],
  "/two-factor/enable": ["password"], "/two-factor/verify-totp": ["code", "trustDevice"],
  "/two-factor/verify-backup-code": ["code", "trustDevice"],
  "/two-factor/generate-backup-codes": ["password"],
  "/send-verification-email": ["email", "callbackURL"],
  "/password-change/start": ["currentPassword", "newPassword"],
  "/password-change/confirm": ["operationId", "code"],
};
export function authError(code: string, status: number): Response {
  const requestId = randomUUID();
  return Response.json({ error: { code, message: "Не удалось выполнить операцию авторизации.", requestId } },
    { status, headers: { "Cache-Control": "no-store", "X-Request-ID": requestId } });
}

export async function handleStaffAuth(request: Request, pool: Pool,
  config: AuthConfig = getAuthConfig(), sendEmail: AuthEmailSender = createAuthEmailSender(), onInternalError?: (error: unknown) => void): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.slice("/api/auth".length);
  const write = request.method === "POST" || path === "/verify-email";
  if (!(request.method === "GET" && STAFF_AUTH_GET_PATHS.has(path)) &&
      !(request.method === "POST" && (STAFF_AUTH_POST_PATHS.has(path) || passwordPaths.has(path)))) return authError("AUTH_OPERATION_DISABLED", 404);
  if (write && !config.writesEnabled) return authError("AUTH_WRITES_DISABLED", 503);
  if (!config.writesEnabled && path === "/get-session") return Response.json(null, { headers: { "Cache-Control": "no-store" } });
  let body: Record<string, unknown> = {};
  if (request.method === "POST") {
    if (request.headers.get("origin") !== config.origin || request.headers.get("sec-fetch-site") === "cross-site") return authError("AUTH_ORIGIN_REJECTED", 403);
    if (!request.headers.get("content-type")?.startsWith("application/json")) return authError("INVALID_REQUEST", 400);
    const reader = request.body?.getReader();
    if (!reader) return authError("INVALID_REQUEST", 400);
    const chunks: Uint8Array[] = [];
    let length = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        length += value.byteLength;
        if (length > 4096) { await reader.cancel(); return authError("INVALID_REQUEST", 413); }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    const raw = Buffer.concat(chunks).toString("utf8");
    try { body = JSON.parse(raw); } catch { return authError("INVALID_REQUEST", 400); }
    if (!body || typeof body !== "object" || Array.isArray(body) ||
      Object.keys(body).some(key => !fields[path]?.includes(key))) return authError("INVALID_REQUEST", 400);
    if (body.trustDevice === true) return authError("AUTH_OPERATION_DISABLED", 403);
    if (body.callbackURL && body.callbackURL !== "/admin/login") return authError("INVALID_REQUEST", 400);
  }
  if (path === "/verify-email") {
    const callback = url.searchParams.get("callbackURL");
    if (callback && callback !== "/admin/login" && callback !== `${config.origin}/admin/login`) return authError("INVALID_REQUEST", 400);
  }
  if (path === "/get-session") {
    url.searchParams.set("disableRefresh", "true");
    url.searchParams.set("disableCookieCache", "true");
  }
  const headers = new Headers(request.headers);
  // Persistent trusted-device cookies are not an allowed MFA factor for staff.
  headers.set("cookie", (headers.get("cookie") ?? "").split(";").filter(part => !part.split("=")[0].trim().endsWith(".trust_device")).join(";"));
  const forwarded = new Request(url, { method: request.method, headers,
    ...(request.method === "POST" ? { body: JSON.stringify(body) } : {}) });
  const client = await pool.connect();
  const state = newAuthRequestState();
  let response: Response;
  try {
    response = await drizzle(client, { schema }).transaction(async tx => {
      const store = new AuthSecurityStore(client, config.secret);
      const auth = createStaffAuth(tx, store, config, state);
      try {
        if (passwordPaths.has(path)) {
          const current = await auth.api.getSession({ headers, query: { disableCookieCache: true, disableRefresh: true } });
          if (!current) throw new AuthSecurityError("UNAUTHORIZED", 401);
          await store.lock(current.user.id);
          const user = await store.user(current.user.id);
          const session = await store.session(current.session.token);
          if (!fullStaffSession(user, session) || !user?.roles.includes("super_admin") || !session) throw new AuthSecurityError("FORBIDDEN");
          await store.rateLimit(path, user.userId);
          if (path.endsWith("/start")) {
            const stored = await store.passwordHash(user.userId);
            if (!validStaffPassword(body.newPassword) || typeof body.currentPassword !== "string" || body.currentPassword.length > 128) throw new AuthSecurityError("INVALID_PASSWORD", 400);
            if (!stored || !await verifyPassword({ hash: stored, password: body.currentPassword })) throw new AuthSecurityError("INVALID_PASSWORD", 403);
            const operationId = await store.startPasswordChange(user, session, await hashPassword(body.newPassword as string));
            return Response.json({ operationId }, { headers: { "Cache-Control": "no-store" } });
          }
          if (typeof body.operationId !== "string" || !/^[0-9a-f-]{36}$/i.test(body.operationId) || typeof body.code !== "string" || !/^\d{6}$/.test(body.code)) throw new AuthSecurityError("INVALID_REQUEST", 400);
          if (!await store.passwordOperation(body.operationId, user, session)) throw new AuthSecurityError("PASSWORD_OPERATION_INVALID", 409);
          // Native verification is server-side and remains inside this user's transaction lock.
          await auth.api.verifyTOTP({ headers, body: { code: body.code, trustDevice: false } });
          await store.consumeTotp(user.userId, body.code);
          await store.finishPasswordChange(body.operationId, user, session);
          return Response.json({ status: true, signedOut: true }, { headers: { "Cache-Control": "no-store" } });
        }
        const result = await auth.handler(forwarded);
        if (result.status >= 500) throw new Error("AUTH_TRANSACTION_FAILED");
        if (result.ok && path === "/two-factor/verify-totp" && state.user && typeof body.code === "string") {
          await store.consumeTotp(state.user.userId, body.code);
        }
        return result;
      } catch (error) {
        // Expected denials commit rate-limit / failed MFA counters, never partial successful writes.
        if (error instanceof AuthSecurityError) {
          if (error.code === "TOTP_REPLAY") throw error; // Roll back any session/challenge changes as well.
          return authError(error.code, error.status);
        }
        if (error instanceof APIError) return authError(error.body?.code ?? "AUTH_REJECTED", typeof error.statusCode === "number" ? error.statusCode : 400);
        throw error;
      }
    });
  } catch (error) {
    if (!(error instanceof AuthSecurityError)) onInternalError?.(error);
    return error instanceof AuthSecurityError ? authError(error.code, error.status) : authError("AUTH_UNAVAILABLE", 503);
  }
  finally { client.release(); }
  try { for (const message of state.afterCommit) await sendEmail(message); }
  catch { return authError("EMAIL_DELIVERY_UNAVAILABLE", 503); }
  const resultHeaders = new Headers(response.headers);
  resultHeaders.set("Cache-Control", "no-store");
  resultHeaders.set("Referrer-Policy", "no-referrer");
  resultHeaders.delete("Content-Length");
  if (response.headers.get("content-type")?.includes("application/json")) {
    const raw = await response.text();
    if (!raw && response.status >= 300 && response.status < 400) return new Response(null, { status: response.status, headers: resultHeaders });
    const value = raw ? JSON.parse(raw) : null;
    if (!response.ok) {
      const code = value?.error?.code ?? (typeof value?.code === "string" ? value.code : response.status === 429 ? "AUTH_RATE_LIMITED" : "AUTH_REJECTED");
      const failure = authError(code, response.status);
      const retry = resultHeaders.get("retry-after") ?? resultHeaders.get("x-retry-after");
      if (retry) failure.headers.set("Retry-After", retry);
      for (const cookie of resultHeaders.getSetCookie()) failure.headers.append("set-cookie", cookie);
      return failure;
    }
    if (value && typeof value === "object") {
      delete value.token;
      if (value.session) delete value.session.token;
    }
    return Response.json(value, { status: response.status, headers: resultHeaders });
  }
  return new Response(response.body, { status: response.status, headers: resultHeaders });
}
