import { getApiFootballRealProviderConfig, type ApiFootballRealProviderConfig } from "./core-config";
import type {
  ApiFootballEnvelope,
  ApiFootballError,
  ApiFootballErrorCode,
  ApiFootballFailure,
  ApiFootballPaging,
  ApiFootballRateLimit,
  ApiFootballResult,
} from "./types";

const API_FOOTBALL_KEY_HEADER = "x-apisports-key";
const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_RETRY_AFTER_CAP_MS = 2_000;
const DEFAULT_BACKOFF_BASE_MS = 250;

type FetchLike = (input: URL | RequestInfo, init?: RequestInit) => Promise<Response>;
type Sleep = (ms: number) => Promise<void>;

export type ApiFootballClientOptions = {
  config?: ApiFootballRealProviderConfig;
  fetch?: FetchLike;
  sleep?: Sleep;
  maxAttempts?: number;
  retryAfterCapMs?: number;
  backoffBaseMs?: number;
  jitter?: () => number;
};

export type ApiFootballRequestParameters = Record<
  string,
  boolean | number | string | undefined
>;

export type ApiFootballClient = {
  get<TResponse>(
    pathname: string,
    parameters?: ApiFootballRequestParameters,
  ): Promise<ApiFootballResult<TResponse>>;
};

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function normalizePositiveInteger(value: number | undefined, fallback: number): number {
  return Number.isInteger(value) && value != null && value > 0 ? value : fallback;
}

function buildApiFootballUrl(
  baseUrl: URL,
  pathname: string,
  parameters: ApiFootballRequestParameters,
): URL {
  const url = new URL(pathname.replace(/^\/+/u, ""), baseUrl);

  for (const [key, value] of Object.entries(parameters).sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    if (value !== undefined) {
      url.searchParams.set(key, String(value));
    }
  }

  return url;
}

function parseIntegerHeader(headers: Headers, name: string): number | undefined {
  const value = headers.get(name);

  if (value == null || value.trim() === "") {
    return undefined;
  }

  const parsed = Number(value);

  return Number.isInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

function parseRetryAfterSeconds(headers: Headers): number | undefined {
  const value = headers.get("retry-after");

  if (value == null || value.trim() === "") {
    return undefined;
  }

  const seconds = Number(value);

  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.ceil(seconds);
  }

  const timestamp = Date.parse(value);

  if (Number.isNaN(timestamp)) {
    return undefined;
  }

  return Math.max(0, Math.ceil((timestamp - Date.now()) / 1_000));
}

function parseRateLimit(headers: Headers): ApiFootballRateLimit {
  const daily = {
    limit: parseIntegerHeader(headers, "x-ratelimit-requests-limit"),
    remaining: parseIntegerHeader(headers, "x-ratelimit-requests-remaining"),
  };
  const minute = {
    limit: parseIntegerHeader(headers, "x-ratelimit-limit"),
    remaining: parseIntegerHeader(headers, "x-ratelimit-remaining"),
  };
  const scope =
    daily.remaining === 0 ? "daily" : minute.remaining === 0 ? "minute" : "unknown";

  return {
    scope,
    daily,
    minute,
  };
}

function createFailure(
  code: ApiFootballErrorCode,
  message: string,
  retryable: boolean,
  attempts: number,
  details: Omit<ApiFootballError, "attempts" | "code" | "message" | "retryable"> = {},
): ApiFootballFailure {
  return {
    ok: false,
    error: {
      attempts,
      code,
      message,
      retryable,
      ...details,
    },
  };
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function hasStructuredProviderError(errors: unknown): boolean {
  if (Array.isArray(errors)) {
    return errors.length > 0;
  }

  if (errors && typeof errors === "object") {
    return Object.keys(errors).length > 0;
  }

  return Boolean(errors);
}

function hasRetryableProviderError(errors: unknown): boolean {
  if (!errors || typeof errors !== "object" || Array.isArray(errors)) {
    return false;
  }

  return Object.keys(errors).some((key) =>
    /^(timeout|rate[_-]?limit|server|temporary)$/iu.test(key),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parsePaging(value: unknown): ApiFootballPaging | null {
  if (!isRecord(value)) {
    return null;
  }

  const { current, total } = value;

  if (
    typeof current !== "number" ||
    typeof total !== "number" ||
    !Number.isInteger(current) ||
    !Number.isInteger(total)
  ) {
    return null;
  }

  return { current, total };
}

function parseEnvelope<TResponse>(body: unknown): ApiFootballEnvelope<TResponse> | null {
  if (!isRecord(body)) {
    return null;
  }

  const { errors, get, paging, parameters, response, results } = body;
  const parsedPaging = parsePaging(paging);

  if (
    typeof get !== "string" ||
    !isRecord(parameters) ||
    typeof results !== "number" ||
    !Number.isInteger(results) ||
    !parsedPaging ||
    errors === undefined ||
    response === undefined
  ) {
    return null;
  }

  return {
    errors: errors as unknown[] | Record<string, unknown>,
    get,
    paging: parsedPaging,
    parameters,
    response: response as TResponse,
    results,
  };
}

async function readJson(response: Response): Promise<unknown> {
  return await response.json();
}

function classifyHttpFailure(response: Response, attempts: number): ApiFootballFailure {
  const retryAfterSeconds = parseRetryAfterSeconds(response.headers);

  if (response.status === 429) {
    const rateLimit = parseRateLimit(response.headers);

    if (rateLimit.scope === "daily") {
      return createFailure(
        "daily_quota_exhausted",
        "API-Football daily quota is exhausted",
        false,
        attempts,
        {
          httpStatus: response.status,
          rateLimit,
          retryAfterSeconds,
        },
      );
    }

    return createFailure("http_rate_limited", "API-Football rate limit reached", true, attempts, {
      httpStatus: response.status,
      rateLimit,
      retryAfterSeconds,
    });
  }

  if (response.status >= 500) {
    return createFailure("http_server_error", "API-Football returned a server error", true, attempts, {
      httpStatus: response.status,
      retryAfterSeconds,
    });
  }

  if (response.status >= 400) {
    return createFailure("http_client_error", "API-Football rejected the request", false, attempts, {
      httpStatus: response.status,
    });
  }

  return createFailure(
    "malformed_response",
    "API-Football returned an unexpected HTTP response",
    false,
    attempts,
    { httpStatus: response.status },
  );
}

function getRetryDelayMs(
  error: ApiFootballError,
  attempt: number,
  retryAfterCapMs: number,
  backoffBaseMs: number,
  jitter: () => number,
): number {
  if (error.retryAfterSeconds !== undefined) {
    return Math.min(error.retryAfterSeconds * 1_000, retryAfterCapMs);
  }

  const backoff = backoffBaseMs * 2 ** Math.max(0, attempt - 1);
  const boundedJitter = Math.floor(Math.max(0, Math.min(1, jitter())) * backoffBaseMs);

  return Math.min(backoff + boundedJitter, retryAfterCapMs);
}

export function createApiFootballClient(
  options: ApiFootballClientOptions = {},
): ApiFootballClient {
  const config = options.config ?? getApiFootballRealProviderConfig();
  const fetchImpl = options.fetch ?? fetch;
  const sleep = options.sleep ?? defaultSleep;
  const maxAttempts = normalizePositiveInteger(options.maxAttempts, DEFAULT_MAX_ATTEMPTS);
  const retryAfterCapMs = normalizePositiveInteger(
    options.retryAfterCapMs,
    DEFAULT_RETRY_AFTER_CAP_MS,
  );
  const backoffBaseMs = normalizePositiveInteger(
    options.backoffBaseMs,
    DEFAULT_BACKOFF_BASE_MS,
  );
  const jitter = options.jitter ?? Math.random;

  return {
    async get<TResponse>(
      pathname: string,
      parameters: ApiFootballRequestParameters = {},
    ): Promise<ApiFootballResult<TResponse>> {
      const url = buildApiFootballUrl(config.baseUrl, pathname, parameters);

      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        const controller = new AbortController();
        let didTimeout = false;
        const timeout = setTimeout(() => {
          didTimeout = true;
          controller.abort();
        }, config.timeoutMs);

        let failure: ApiFootballFailure | null = null;

        try {
          const response = await fetchImpl(url, {
            cache: "no-store",
            headers: {
              accept: "application/json",
              [API_FOOTBALL_KEY_HEADER]: config.apiKey,
            },
            signal: controller.signal,
          });

          if (!response.ok) {
            failure = classifyHttpFailure(response, attempt);
          } else {
            let body: unknown;

            try {
              body = await readJson(response);
            } catch {
              failure = createFailure(
                "malformed_response",
                "API-Football returned invalid JSON",
                false,
                attempt,
              );
            }

            if (failure) {
              return failure;
            }

            const envelope = parseEnvelope<TResponse>(body);

            if (!envelope) {
              failure = createFailure(
                "malformed_response",
                "API-Football returned an unexpected response shape",
                false,
                attempt,
              );
            } else if (hasStructuredProviderError(envelope.errors)) {
              const retryable = hasRetryableProviderError(envelope.errors);

              failure = createFailure(
                "provider_error",
                "API-Football returned provider errors",
                retryable,
                attempt,
              );
            } else {
              return {
                attempts: attempt,
                data: envelope.response,
                ok: true,
                operation: envelope.get,
                paging: envelope.paging,
                results: envelope.results,
              };
            }
          }
        } catch (error) {
          failure = createFailure(
            didTimeout || isAbortError(error) ? "timeout" : "transport_error",
            didTimeout || isAbortError(error)
              ? "API-Football request timed out"
              : "API-Football network request failed",
            true,
            attempt,
          );
        } finally {
          clearTimeout(timeout);
        }

        if (!failure.error.retryable || attempt >= maxAttempts) {
          return failure;
        }

        await sleep(
          getRetryDelayMs(
            failure.error,
            attempt,
            retryAfterCapMs,
            backoffBaseMs,
            jitter,
          ),
        );
      }

      return createFailure(
        "transport_error",
        "API-Football request failed after all attempts",
        true,
        maxAttempts,
      );
    },
  };
}
