import "server-only";

const DATABASE_URL_ENV = "DATABASE_URL";
const AI_SERVICE_URL_ENV = "AI_SERVICE_URL";
const AI_SERVICE_INTERNAL_API_KEY_ENV = "AI_SERVICE_INTERNAL_API_KEY";

export const WEB_RUNTIME_ENV = {
  databaseUrl: DATABASE_URL_ENV,
  aiServiceUrl: AI_SERVICE_URL_ENV,
  aiServiceInternalApiKey: AI_SERVICE_INTERNAL_API_KEY_ENV,
} as const;

type RuntimeEnv = Record<string, string | undefined>;

export type WebRuntimeConfig = {
  databaseUrl: string;
  aiServiceUrl: URL;
  aiServiceInternalApiKey: string;
};

function requireRuntimeEnv(env: RuntimeEnv, name: string): string {
  const value = env[name];

  if (value == null || value.trim() === "") {
    throw new Error(`${name} is required for Web runtime configuration`);
  }

  return value;
}

function requireHttpUrl(env: RuntimeEnv, name: string): URL {
  const value = requireRuntimeEnv(env, name);

  try {
    const url = new URL(value);

    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error("unsupported protocol");
    }

    return url;
  } catch (error) {
    throw new Error(`${name} must be an absolute HTTP/HTTPS URL`, {
      cause: error,
    });
  }
}

export function getDatabaseUrl(env: RuntimeEnv = process.env): string {
  return requireRuntimeEnv(env, DATABASE_URL_ENV);
}

export function getAiServiceRuntimeConfig(
  env: RuntimeEnv = process.env,
): Pick<WebRuntimeConfig, "aiServiceUrl" | "aiServiceInternalApiKey"> {
  return {
    aiServiceUrl: requireHttpUrl(env, AI_SERVICE_URL_ENV),
    aiServiceInternalApiKey: requireRuntimeEnv(env, AI_SERVICE_INTERNAL_API_KEY_ENV),
  };
}

export function getWebRuntimeConfig(env: RuntimeEnv = process.env): WebRuntimeConfig {
  return {
    databaseUrl: getDatabaseUrl(env),
    ...getAiServiceRuntimeConfig(env),
  };
}
