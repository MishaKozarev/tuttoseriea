export type ApiFootballPaging = {
  current: number;
  total: number;
};

export type ApiFootballEnvelope<TResponse> = {
  get: string;
  parameters: Record<string, unknown>;
  errors: unknown[] | Record<string, unknown>;
  results: number;
  paging: ApiFootballPaging;
  response: TResponse;
};

export type ApiFootballRateLimitScope = "daily" | "minute" | "unknown";

export type ApiFootballRateLimit = {
  scope: ApiFootballRateLimitScope;
  daily?: {
    limit?: number;
    remaining?: number;
  };
  minute?: {
    limit?: number;
    remaining?: number;
  };
};

export type ApiFootballErrorCode =
  | "transport_error"
  | "timeout"
  | "http_rate_limited"
  | "daily_quota_exhausted"
  | "http_server_error"
  | "http_client_error"
  | "provider_error"
  | "malformed_response";

export type ApiFootballError = {
  code: ApiFootballErrorCode;
  message: string;
  retryable: boolean;
  attempts: number;
  httpStatus?: number;
  retryAfterSeconds?: number;
  rateLimit?: ApiFootballRateLimit;
};

export type ApiFootballSuccess<TResponse> = {
  ok: true;
  data: TResponse;
  results: number;
  paging: ApiFootballPaging;
  operation: string;
  attempts: number;
};

export type ApiFootballFailure = {
  ok: false;
  error: ApiFootballError;
};

export type ApiFootballResult<TResponse> =
  | ApiFootballSuccess<TResponse>
  | ApiFootballFailure;
