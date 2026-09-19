import "server-only";

import type { paths } from "@/src/generated/ai-service-openapi";

const AI_SERVICE_URL_ENV = "AI_SERVICE_URL";
const AI_SERVICE_INTERNAL_API_KEY_ENV = "AI_SERVICE_INTERNAL_API_KEY";
const INTERNAL_API_KEY_HEADER = "X-Internal-API-Key";

export type AiServiceInternalHealthResponse =
  paths["/internal/health"]["get"]["responses"][200]["content"]["application/json"];

function requireServerEnv(name: string): string {
  const value = process.env[name];

  if (!value) {
    throw new Error(`${name} is required`);
  }

  return value;
}

export function buildAiServiceUrl(pathname: string): URL {
  const baseUrl = requireServerEnv(AI_SERVICE_URL_ENV);

  try {
    return new URL(pathname, baseUrl);
  } catch (error) {
    throw new Error(`${AI_SERVICE_URL_ENV} must be a valid URL`, {
      cause: error,
    });
  }
}

export async function getAiServiceInternalHealth(): Promise<AiServiceInternalHealthResponse> {
  const apiKey = requireServerEnv(AI_SERVICE_INTERNAL_API_KEY_ENV);
  const url = buildAiServiceUrl("/internal/health");

  const response = await fetch(url, {
    cache: "no-store",
    headers: {
      [INTERNAL_API_KEY_HEADER]: apiKey,
    },
  });

  if (!response.ok) {
    throw new Error(`AI service request failed with status ${response.status}`);
  }

  return (await response.json()) as AiServiceInternalHealthResponse;
}
