export {
  API_FOOTBALL_ENV,
  ApiFootballConfigError,
  getApiFootballConfig,
  getApiFootballRealProviderConfig,
  type ApiFootballConfig,
  type ApiFootballRealProviderConfig,
} from "./config";
export {
  createApiFootballClient,
  type ApiFootballClient,
  type ApiFootballClientOptions,
  type ApiFootballRequestParameters,
} from "./client";
export {
  API_FOOTBALL_FIXTURE_STATUS_CODES,
  UnsupportedApiFootballFixtureStatusError,
  normalizeApiFootballFixtureStatus,
  type ApiFootballFixtureStatusCode,
  type FixturePollingCategory,
  type NormalizedFixtureState,
  type NormalizedFixtureStatus,
} from "./fixture-status";
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
