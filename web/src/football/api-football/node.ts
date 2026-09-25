export {
  API_FOOTBALL_ENV,
  ApiFootballConfigError,
  getApiFootballConfig,
  getApiFootballRealProviderConfig,
  type ApiFootballConfig,
  type ApiFootballRealProviderConfig,
} from "./core-config";
export {
  createApiFootballClient,
  type ApiFootballClient,
  type ApiFootballClientOptions,
  type ApiFootballRequestParameters,
} from "./core-client";
export type {
  ApiFootballEnvelope,
  ApiFootballError,
  ApiFootballErrorCode,
  ApiFootballFailure,
  ApiFootballPaging,
  ApiFootballRateLimit,
  ApiFootballRateLimitScope,
  ApiFootballResult,
  ApiFootballSuccess,
} from "./types";
