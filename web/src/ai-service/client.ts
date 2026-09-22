import "server-only";

import { getAiServiceRuntimeConfig } from "@/src/config/runtime";
import type { paths } from "@/src/generated/ai-service-openapi";

const INTERNAL_API_KEY_HEADER = "X-Internal-API-Key";

export type AiServiceInternalHealthResponse =
  paths["/internal/health"]["get"]["responses"][200]["content"]["application/json"];

export function buildAiServiceUrl(pathname: string): URL {
  const { aiServiceUrl } = getAiServiceRuntimeConfig();

  return new URL(pathname, aiServiceUrl);
}

export async function getAiServiceInternalHealth(): Promise<AiServiceInternalHealthResponse> {
  const { aiServiceInternalApiKey } = getAiServiceRuntimeConfig();
  const url = buildAiServiceUrl("/internal/health");

  const response = await fetch(url, {
    cache: "no-store",
    headers: {
      [INTERNAL_API_KEY_HEADER]: aiServiceInternalApiKey,
    },
  });

  if (!response.ok) {
    throw new Error(`AI service request failed with status ${response.status}`);
  }

  return (await response.json()) as AiServiceInternalHealthResponse;
}
