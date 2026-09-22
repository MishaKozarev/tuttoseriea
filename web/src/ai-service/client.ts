import "server-only";

import {
  API_ERROR_CODES,
  ApplicationError,
  REQUEST_ID_HEADER,
  normalizeRequestId,
  resolveRequestId,
} from "@/src/api/errors";
import { getAiServiceRuntimeConfig } from "@/src/config/runtime";
import type { paths } from "@/src/generated/ai-service-openapi";

const INTERNAL_API_KEY_HEADER = "X-Internal-API-Key";
const DEFAULT_AI_SERVICE_TIMEOUT_MS = 5_000;

export type AiServiceInternalHealthResponse =
  paths["/internal/health"]["get"]["responses"][200]["content"]["application/json"];

export type AiServiceRequestContext = {
  headers?: Headers | Request;
  requestId?: string;
  timeoutMs?: number;
};

export function buildAiServiceUrl(pathname: string): URL {
  const { aiServiceUrl } = getAiServiceRuntimeConfig();

  return new URL(pathname, aiServiceUrl);
}

function getAiServiceRequestId(context: AiServiceRequestContext): string {
  return (
    normalizeRequestId(context.requestId) ??
    (context.headers ? resolveRequestId(context.headers) : resolveRequestId())
  );
}

async function fetchAiService(
  url: URL,
  requestId: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  let didTimeout = false;
  const timeout = setTimeout(() => {
    didTimeout = true;
    controller.abort();
  }, timeoutMs);

  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
    });
  } catch (error) {
    if (didTimeout) {
      throw new ApplicationError({
        cause: error,
        code: API_ERROR_CODES.aiServiceTimeout,
        message: "AI service request timed out",
        requestId,
        status: 504,
      });
    }

    throw new ApplicationError({
      cause: error,
      code: API_ERROR_CODES.aiServiceNetworkError,
      message: "AI service is unavailable",
      requestId,
      status: 502,
    });
  } finally {
    clearTimeout(timeout);
  }
}

function mappedAiService4xxStatus(status: number): number | undefined {
  if (status === 400 || status === 404 || status === 409 || status === 422) {
    return status;
  }

  return undefined;
}

function throwAiServiceStatusError(response: Response, requestId: string): never {
  const mappedStatus = mappedAiService4xxStatus(response.status);

  if (mappedStatus) {
    throw new ApplicationError({
      code: API_ERROR_CODES.aiServiceRequestRejected,
      message: "AI service rejected the request",
      requestId,
      status: mappedStatus,
    });
  }

  if (response.status >= 500) {
    throw new ApplicationError({
      code: API_ERROR_CODES.aiServiceUnavailable,
      message: "AI service is unavailable",
      requestId,
      status: 502,
    });
  }

  throw new ApplicationError({
    code: API_ERROR_CODES.aiServiceBadResponse,
    message: "AI service returned an unexpected response",
    requestId,
    status: 502,
  });
}

async function readAiServiceJson(response: Response, requestId: string): Promise<unknown> {
  try {
    return await response.json();
  } catch (error) {
    throw new ApplicationError({
      cause: error,
      code: API_ERROR_CODES.aiServiceBadResponse,
      message: "AI service returned an invalid response",
      requestId,
      status: 502,
    });
  }
}

function parseInternalHealthResponse(
  body: unknown,
  requestId: string,
): AiServiceInternalHealthResponse {
  if (!body || typeof body !== "object" || !("status" in body)) {
    throw new ApplicationError({
      code: API_ERROR_CODES.aiServiceBadResponse,
      message: "AI service returned an unexpected response",
      requestId,
      status: 502,
    });
  }

  const statusValue = (body as { status: unknown }).status;

  if (statusValue !== "ok") {
    throw new ApplicationError({
      code: API_ERROR_CODES.aiServiceBadResponse,
      message: "AI service returned an unexpected response",
      requestId,
      status: 502,
    });
  }

  return { status: statusValue };
}

export async function getAiServiceInternalHealth(
  context: AiServiceRequestContext = {},
): Promise<AiServiceInternalHealthResponse> {
  const { aiServiceInternalApiKey } = getAiServiceRuntimeConfig();
  const url = buildAiServiceUrl("/internal/health");
  const requestId = getAiServiceRequestId(context);

  const response = await fetchAiService(url, requestId, {
    cache: "no-store",
    headers: {
      [INTERNAL_API_KEY_HEADER]: aiServiceInternalApiKey,
      [REQUEST_ID_HEADER]: requestId,
    },
  }, context.timeoutMs ?? DEFAULT_AI_SERVICE_TIMEOUT_MS);

  if (!response.ok) {
    throwAiServiceStatusError(response, requestId);
  }

  return parseInternalHealthResponse(await readAiServiceJson(response, requestId), requestId);
}
