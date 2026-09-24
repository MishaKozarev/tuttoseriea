import fs from "node:fs";
import path from "node:path";

import { JobConfigError, JobUsageError } from "./types";

const identifierPattern = /^[A-Za-z_][A-Za-z0-9_]*$/;

type RuntimeEnv = Record<string, string | undefined>;

export type JobRunnerConfig = {
  databaseUrl: string;
  jobsSchema: string;
  leaseSeconds: number;
  maxAttempts: number;
  retryDelaySeconds: number;
  retryDelayCapSeconds: number;
};

function parseEnvLine(line: string): [string, string] | null {
  const trimmed = line.trim();

  if (!trimmed || trimmed.startsWith("#")) {
    return null;
  }

  const equalsIndex = trimmed.indexOf("=");

  if (equalsIndex <= 0) {
    return null;
  }

  const key = trimmed.slice(0, equalsIndex).trim();
  let value = trimmed.slice(equalsIndex + 1).trim();

  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }

  return [key, value];
}

function loadEnvFile(filePath: string, env: NodeJS.ProcessEnv): void {
  if (!fs.existsSync(filePath)) {
    return;
  }

  const content = fs.readFileSync(filePath, "utf8");

  for (const line of content.split(/\r?\n/u)) {
    const parsed = parseEnvLine(line);

    if (!parsed) {
      continue;
    }

    const [key, value] = parsed;

    if (env[key] === undefined) {
      env[key] = value;
    }
  }
}

export function loadLocalJobEnvFiles(
  appDirectory = process.cwd(),
  env = process.env,
): void {
  loadEnvFile(path.join(appDirectory, ".env.local"), env);
  loadEnvFile(path.join(appDirectory, ".env"), env);
}

function requireEnv(env: RuntimeEnv, name: string): string {
  const value = env[name];

  if (value == null || value.trim() === "") {
    throw new JobConfigError(`${name} is required for job runner configuration`);
  }

  return value;
}

function optionalPositiveInteger(
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
    throw new JobConfigError(`${name} must be a positive integer`);
  }

  return parsed;
}

export function assertPostgresIdentifier(value: string, label: string): void {
  if (!identifierPattern.test(value)) {
    throw new JobConfigError(`${label} must be an unquoted PostgreSQL identifier`);
  }
}

export function quoteIdentifier(value: string): string {
  assertPostgresIdentifier(value, "PostgreSQL identifier");
  return `"${value.replaceAll('"', '""')}"`;
}

export function getJobRunnerConfig(env: RuntimeEnv = process.env): JobRunnerConfig {
  const jobsSchema = env.DATABASE_JOBS_SCHEMA?.trim() || "jobs";

  assertPostgresIdentifier(jobsSchema, "DATABASE_JOBS_SCHEMA");

  const retryDelaySeconds = optionalPositiveInteger(
    env,
    "JOB_RUNNER_RETRY_DELAY_SECONDS",
    60,
  );
  const retryDelayCapSeconds = optionalPositiveInteger(
    env,
    "JOB_RUNNER_RETRY_DELAY_CAP_SECONDS",
    300,
  );

  if (retryDelaySeconds > retryDelayCapSeconds) {
    throw new JobConfigError(
      "JOB_RUNNER_RETRY_DELAY_SECONDS must be less than or equal to JOB_RUNNER_RETRY_DELAY_CAP_SECONDS",
    );
  }

  return {
    databaseUrl: requireEnv(env, "DATABASE_URL"),
    jobsSchema,
    leaseSeconds: optionalPositiveInteger(env, "JOB_RUNNER_LEASE_SECONDS", 60),
    maxAttempts: optionalPositiveInteger(env, "JOB_RUNNER_MAX_ATTEMPTS", 3),
    retryDelaySeconds,
    retryDelayCapSeconds,
  };
}

export function normalizeRetryDelaySeconds(
  requestedDelaySeconds: number | undefined,
  config: Pick<JobRunnerConfig, "retryDelaySeconds" | "retryDelayCapSeconds">,
): number {
  if (requestedDelaySeconds === undefined) {
    return config.retryDelaySeconds;
  }

  if (!Number.isInteger(requestedDelaySeconds) || requestedDelaySeconds <= 0) {
    throw new JobUsageError("retryDelaySeconds must be a positive integer");
  }

  return Math.min(requestedDelaySeconds, config.retryDelayCapSeconds);
}
