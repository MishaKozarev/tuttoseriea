import "server-only";

import {
  API_ERROR_CODES,
  ApplicationError,
  createApiErrorResponse,
  type ApiErrorCode,
} from "@/src/api/errors";

type AccessErrorOptions = {
  code?: ApiErrorCode;
  message?: string;
  requestId?: string;
};

export function createUnauthorizedError(options: AccessErrorOptions = {}) {
  return new ApplicationError({
    code: options.code ?? API_ERROR_CODES.unauthorized,
    message: options.message ?? "Authentication required",
    requestId: options.requestId,
    status: 401,
  });
}

export function createForbiddenError(options: AccessErrorOptions = {}) {
  return new ApplicationError({
    code: options.code ?? API_ERROR_CODES.forbidden,
    message: options.message ?? "Access denied",
    requestId: options.requestId,
    status: 403,
  });
}

export function createUnauthorizedResponse(
  options: AccessErrorOptions = {},
  source?: Headers | Request | string | null,
): Response {
  return createApiErrorResponse(createUnauthorizedError(options), source);
}

export function createForbiddenResponse(
  options: AccessErrorOptions = {},
  source?: Headers | Request | string | null,
): Response {
  return createApiErrorResponse(createForbiddenError(options), source);
}
