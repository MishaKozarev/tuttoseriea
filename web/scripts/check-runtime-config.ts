import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  WEB_RUNTIME_ENV,
  getAiServiceRuntimeConfig,
  getDatabaseUrl,
  getWebRuntimeConfig,
} from "../src/config/runtime";
import {
  API_FOOTBALL_ENV,
  getApiFootballConfig,
  getApiFootballRealProviderConfig,
} from "../src/football/api-football";

const appDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(appDirectory, "..");

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function assertThrows(name: string, operation: () => unknown, expected: RegExp): void {
  try {
    operation();
  } catch (error) {
    assert(error instanceof Error, `${name} threw a non-Error value`);
    assert(
      expected.test(error.message),
      `${name} error message did not match ${expected}: ${error.message}`,
    );
    return;
  }

  throw new Error(`${name} did not throw`);
}

function readRelative(relativePath: string): string {
  return readFileSync(path.join(repoRoot, relativePath), "utf8");
}

function collectTextFiles(directory: string): string[] {
  const result: string[] = [];

  for (const entry of readdirSync(directory)) {
    const fullPath = path.join(directory, entry);
    const stats = statSync(fullPath);

    if (stats.isDirectory()) {
      result.push(...collectTextFiles(fullPath));
      continue;
    }

    if (/\.(ts|tsx|mjs|js|md|example)$/.test(entry) || entry === ".env.example") {
      result.push(fullPath);
    }
  }

  return result;
}

const validEnv = {
  DATABASE_URL: "postgresql://user:password@127.0.0.1:15432/tuttoseriea_local",
  AI_SERVICE_URL: "http://127.0.0.1:8000",
  AI_SERVICE_INTERNAL_API_KEY: "local-contract-test-key",
};

const validConfig = getWebRuntimeConfig(validEnv);

assert(validConfig.databaseUrl === validEnv.DATABASE_URL, "DATABASE_URL was not read");
assert(
  validConfig.aiServiceUrl.toString() === "http://127.0.0.1:8000/",
  "AI_SERVICE_URL was not parsed as an absolute URL",
);
assert(
  validConfig.aiServiceInternalApiKey === validEnv.AI_SERVICE_INTERNAL_API_KEY,
  "AI_SERVICE_INTERNAL_API_KEY was not read",
);
assert(getDatabaseUrl(validEnv) === validEnv.DATABASE_URL, "getDatabaseUrl mismatch");
assert(
  getAiServiceRuntimeConfig(validEnv).aiServiceInternalApiKey ===
    validEnv.AI_SERVICE_INTERNAL_API_KEY,
  "getAiServiceRuntimeConfig mismatch",
);

const providerKey = "runtime-config-check-provider-key";
const providerConfig = getApiFootballConfig({
  API_FOOTBALL_KEY: providerKey,
});

assert(
  providerConfig.baseUrl.toString() === "https://v3.football.api-sports.io/",
  "API_FOOTBALL_BASE_URL default was not applied",
);
assert(
  providerConfig.timeoutMs === 10_000,
  "API_FOOTBALL_TIMEOUT_MS default was not applied",
);
assert(
  providerConfig.realProviderEnabled === false,
  "API_FOOTBALL_KEY presence must not enable real provider calls",
);
assert(providerConfig.hasApiKey === true, "API_FOOTBALL_KEY presence was not detected");
assert(!("apiKey" in providerConfig), "safe provider config must not expose API key");

assertThrows(
  "real API-Football mode without opt-in",
  () => getApiFootballRealProviderConfig({ API_FOOTBALL_KEY: providerKey }),
  /API_FOOTBALL_ENABLE_REAL=true is required/,
);
assertThrows(
  "real API-Football mode without key",
  () => getApiFootballRealProviderConfig({ API_FOOTBALL_ENABLE_REAL: "true" }),
  /API_FOOTBALL_KEY is required/,
);
assert(
  getApiFootballRealProviderConfig({
    API_FOOTBALL_ENABLE_REAL: "true",
    API_FOOTBALL_KEY: providerKey,
  }).apiKey === providerKey,
  "explicit real API-Football provider config did not read the key",
);

assertThrows(
  "missing DATABASE_URL",
  () => getWebRuntimeConfig({ ...validEnv, DATABASE_URL: "" }),
  /DATABASE_URL is required/,
);
assertThrows(
  "missing AI_SERVICE_URL",
  () => getWebRuntimeConfig({ ...validEnv, AI_SERVICE_URL: "" }),
  /AI_SERVICE_URL is required/,
);
assertThrows(
  "missing AI_SERVICE_INTERNAL_API_KEY",
  () => getWebRuntimeConfig({ ...validEnv, AI_SERVICE_INTERNAL_API_KEY: "" }),
  /AI_SERVICE_INTERNAL_API_KEY is required/,
);
assertThrows(
  "malformed AI_SERVICE_URL",
  () => getWebRuntimeConfig({ ...validEnv, AI_SERVICE_URL: "not a url" }),
  /AI_SERVICE_URL must be an absolute HTTP\/HTTPS URL/,
);
assertThrows(
  "unsupported AI_SERVICE_URL protocol",
  () => getWebRuntimeConfig({ ...validEnv, AI_SERVICE_URL: "ftp://127.0.0.1:8000" }),
  /AI_SERVICE_URL must be an absolute HTTP\/HTTPS URL/,
);

const runtimeModule = readRelative("web/src/config/runtime.ts");
assert(
  runtimeModule.includes('import "server-only";'),
  "Web runtime config module must import server-only",
);

const webExample = readRelative("web/.env.example");
const aiServiceExample = readRelative("ai-service/.env.example");
const canonicalSecretName = WEB_RUNTIME_ENV.aiServiceInternalApiKey;

assert(
  webExample.includes(`${canonicalSecretName}=`),
  "web/.env.example must use the canonical AI service secret name",
);
assert(
  aiServiceExample.includes(`${canonicalSecretName}=`),
  "ai-service/.env.example must use the canonical AI service secret name",
);
assert(
  webExample.includes(`${API_FOOTBALL_ENV.enableReal}=false`),
  "web/.env.example must document explicit API-Football real-provider opt-in",
);
assert(
  webExample.includes(`${API_FOOTBALL_ENV.key}=`),
  "web/.env.example must document the API-Football key name without a real secret",
);

for (const fullPath of [
  ...collectTextFiles(path.join(appDirectory, "app")),
  ...collectTextFiles(path.join(appDirectory, "src")),
  path.join(appDirectory, ".env.example"),
]) {
  const text = readFileSync(fullPath, "utf8");
  assert(
    !/NEXT_PUBLIC_[A-Z0-9_]*AI[A-Z0-9_]*/.test(text),
    `${path.relative(repoRoot, fullPath)} exposes AI configuration through NEXT_PUBLIC_*`,
  );
  assert(
    !/NEXT_PUBLIC_[A-Z0-9_]*(FOOTBALL|APISPORTS|API_SPORTS|PROVIDER)[A-Z0-9_]*/.test(
      text,
    ),
    `${path.relative(repoRoot, fullPath)} exposes provider configuration through NEXT_PUBLIC_*`,
  );
}

console.log("runtime_config_check=passed");
