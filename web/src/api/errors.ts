import "server-only";

import { randomUUID } from "node:crypto";

export const REQUEST_ID_HEADER = "X-Request-ID";

export const API_ERROR_CODES = {
  aiServiceBadResponse: "AI_SERVICE_BAD_RESPONSE",
  aiServiceNetworkError: "AI_SERVICE_NETWORK_ERROR",
  aiServiceRequestRejected: "AI_SERVICE_REQUEST_REJECTED",
  aiServiceTimeout: "AI_SERVICE_TIMEOUT",
  aiServiceUnavailable: "AI_SERVICE_UNAVAILABLE",
  badRequest: "BAD_REQUEST",
  conflict: "CONFLICT",
  forbidden: "FORBIDDEN",
  internalServerError: "INTERNAL_SERVER_ERROR",
  notFound: "NOT_FOUND",
  unauthorized: "UNAUTHORIZED",
  validationError: "VALIDATION_ERROR",
} as const;

export type ApiErrorCode = (typeof API_ERROR_CODES)[keyof typeof API_ERROR_CODES] | string;

export type ApiErrorBody = {
  error: {
    code: ApiErrorCode;
    message: string;
    requestId: string;
  };
};

type ApplicationErrorOptions = {
  cause?: unknown;
  code: ApiErrorCode;
  message: string;
  requestId?: string;
  status: number;
};

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;
const INTERNAL_ERROR_MESSAGE = "Internal server error";

export class ApplicationError extends Error {
  readonly code: ApiErrorCode;
  readonly requestId?: string;
  readonly status: number;

  constructor({ cause, code, message, requestId, status }: ApplicationErrorOptions) {
    super(message, { cause });
    this.name = "ApplicationError";
    this.code = code;
    this.requestId = normalizeRequestId(requestId);
    this.status = status;
  }
}

export function normalizeRequestId(value: string | null | undefined): string | undefined {
  const requestId = value?.trim();

  if (!requestId || !REQUEST_ID_PATTERN.test(requestId)) {
    return undefined;
  }

  return requestId;
}

export function createRequestId(): string {
  return randomUUID();
}

export function resolveRequestId(source?: Headers | Request | string | null): string {
  if (typeof source === "string" || source == null) {
    return normalizeRequestId(source) ?? createRequestId();
  }

  return normalizeRequestId(headersFromSource(source).get(REQUEST_ID_HEADER)) ?? createRequestId();
}

function headersFromSource(source: Headers | Request): Headers {
  return source instanceof Headers ? source : source.headers;
}

function requestIdForError(error: unknown, source?: Headers | Request | string | null): string {
  if (typeof source === "string" || source == null) {
    return (
      normalizeRequestId(source) ??
      (error instanceof ApplicationError ? normalizeRequestId(error.requestId) : undefined) ??
      createRequestId()
    );
  }

  return (
    normalizeRequestId(headersFromSource(source).get(REQUEST_ID_HEADER)) ??
    (error instanceof ApplicationError ? normalizeRequestId(error.requestId) : undefined) ??
    createRequestId()
  );
}

export function serializeApiError(
  error: unknown,
  source?: Headers | Request | string | null,
): { body: ApiErrorBody; status: number } {
  const requestId = requestIdForError(error, source);

  if (error instanceof ApplicationError) {
    return {
      body: {
        error: {
          code: error.code,
          message: error.message,
          requestId,
        },
      },
      status: error.status,
    };
  }

  return {
    body: {
      error: {
        code: API_ERROR_CODES.internalServerError,
        message: INTERNAL_ERROR_MESSAGE,
        requestId,
      },
    },
    status: 500,
  };
}

export function createApiErrorResponse(
  error: unknown,
  source?: Headers | Request | string | null,
): Response {
  const { body, status } = serializeApiError(error, source);

  return Response.json(body, {
    headers: {
      [REQUEST_ID_HEADER]: body.error.requestId,
    },
    status,
  });
}
