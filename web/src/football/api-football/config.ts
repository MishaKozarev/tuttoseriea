import "server-only";

const DEFAULT_API_FOOTBALL_BASE_URL = "https://v3.football.api-sports.io/";
const DEFAULT_API_FOOTBALL_TIMEOUT_MS = 10_000;

const API_FOOTBALL_KEY_ENV = "API_FOOTBALL_KEY";
const API_FOOTBALL_BASE_URL_ENV = "API_FOOTBALL_BASE_URL";
const API_FOOTBALL_TIMEOUT_MS_ENV = "API_FOOTBALL_TIMEOUT_MS";
const API_FOOTBALL_ENABLE_REAL_ENV = "API_FOOTBALL_ENABLE_REAL";

export const API_FOOTBALL_ENV = {
  key: API_FOOTBALL_KEY_ENV,
  baseUrl: API_FOOTBALL_BASE_URL_ENV,
  timeoutMs: API_FOOTBALL_TIMEOUT_MS_ENV,
  enableReal: API_FOOTBALL_ENABLE_REAL_ENV,
} as const;

type RuntimeEnv = Record<string, string | undefined>;

export type ApiFootballConfig = {
  baseUrl: URL;
  timeoutMs: number;
  realProviderEnabled: boolean;
  hasApiKey: boolean;
};

export type ApiFootballRealProviderConfig = {
  baseUrl: URL;
  timeoutMs: number;
  apiKey: string;
};

export class ApiFootballConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ApiFootballConfigError";
  }
}

function parseHttpUrl(env: RuntimeEnv, name: string, defaultValue: string): URL {
  const value = env[name]?.trim() || defaultValue;

  try {
    const url = new URL(value);

    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error("unsupported protocol");
    }

    return url;
  } catch {
    throw new ApiFootballConfigError(`${name} must be an absolute HTTP/HTTPS URL`);
  }
}

function parsePositiveInteger(
  env: RuntimeEnv,
  name: string,
  defaultValue: number,
): number {
  const value = env[name];

  if (value == null || value.trim() === "") {
    return defaultValue;
  }

  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new ApiFootballConfigError(`${name} must be a positive integer`);
  }

  return parsed;
}

function parseRealProviderOptIn(env: RuntimeEnv): boolean {
  const value = env[API_FOOTBALL_ENABLE_REAL_ENV]?.trim();

  if (!value || value === "false" || value === "0") {
    return false;
  }

  if (value === "true" || value === "1") {
    return true;
  }

  throw new ApiFootballConfigError(
    `${API_FOOTBALL_ENABLE_REAL_ENV} must be true or false`,
  );
}

function getApiKey(env: RuntimeEnv): string | undefined {
  const value = env[API_FOOTBALL_KEY_ENV]?.trim();

  return value || undefined;
}

export function getApiFootballConfig(env: RuntimeEnv = process.env): ApiFootballConfig {
  return {
    baseUrl: parseHttpUrl(env, API_FOOTBALL_BASE_URL_ENV, DEFAULT_API_FOOTBALL_BASE_URL),
    timeoutMs: parsePositiveInteger(
      env,
      API_FOOTBALL_TIMEOUT_MS_ENV,
      DEFAULT_API_FOOTBALL_TIMEOUT_MS,
    ),
    realProviderEnabled: parseRealProviderOptIn(env),
    hasApiKey: getApiKey(env) != null,
  };
}

export function getApiFootballRealProviderConfig(
  env: RuntimeEnv = process.env,
): ApiFootballRealProviderConfig {
  const config = getApiFootballConfig(env);

  if (!config.realProviderEnabled) {
    throw new ApiFootballConfigError(
      `${API_FOOTBALL_ENABLE_REAL_ENV}=true is required before real API-Football calls`,
    );
  }

  const apiKey = getApiKey(env);

  if (!apiKey) {
    throw new ApiFootballConfigError(
      `${API_FOOTBALL_KEY_ENV} is required when real API-Football calls are enabled`,
    );
  }

  return {
    apiKey,
    baseUrl: config.baseUrl,
    timeoutMs: config.timeoutMs,
  };
}
