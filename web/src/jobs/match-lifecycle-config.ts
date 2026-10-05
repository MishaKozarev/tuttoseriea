import { JobConfigError } from "./types";

type RuntimeEnv = Record<string, string | undefined>;

export type MatchLifecycleDispatcherConfig = {
  managedFrom: Date;
  recoveryHorizonSeconds: number;
  finalConfirmationDelaySeconds: number;
  maxConcurrency: number;
  lineupConfirmationLeadSeconds: number;
  lineupLiveRecoverySeconds: number;
  failureCooldownSeconds: number;
};

function positiveInteger(
  env: RuntimeEnv,
  name: string,
  defaultValue: number,
): number {
  const value = env[name]?.trim();

  if (!value) {
    return defaultValue;
  }

  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new JobConfigError(`${name} must be a positive integer`);
  }

  return parsed;
}

function requiredInstant(env: RuntimeEnv, name: string): Date {
  const value = env[name]?.trim();

  if (!value) {
    throw new JobConfigError(`${name} is required for Match lifecycle dispatcher`);
  }

  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u.test(value)) {
    throw new JobConfigError(`${name} must be a canonical UTC timestamp`);
  }

  const parsed = new Date(value);

  if (Number.isNaN(parsed.getTime())) {
    throw new JobConfigError(`${name} must be a valid timestamp`);
  }

  return parsed;
}

export function getMatchLifecycleDispatcherConfig(
  env: RuntimeEnv = process.env,
): MatchLifecycleDispatcherConfig {
  const maxConcurrency = positiveInteger(
    env,
    "FOOTBALL_MATCH_DISPATCHER_MAX_CONCURRENCY",
    2,
  );

  if (maxConcurrency > 2) {
    throw new JobConfigError(
      "FOOTBALL_MATCH_DISPATCHER_MAX_CONCURRENCY must not exceed 2",
    );
  }

  return {
    managedFrom: requiredInstant(
      env,
      "FOOTBALL_MATCH_DISPATCHER_MANAGED_FROM",
    ),
    recoveryHorizonSeconds: positiveInteger(
      env,
      "FOOTBALL_MATCH_DISPATCHER_RECOVERY_HORIZON_SECONDS",
      86_400,
    ),
    finalConfirmationDelaySeconds: positiveInteger(
      env,
      "FOOTBALL_MATCH_DISPATCHER_FINAL_CONFIRMATION_DELAY_SECONDS",
      1_800,
    ),
    maxConcurrency,
    lineupConfirmationLeadSeconds: positiveInteger(
      env,
      "FOOTBALL_MATCH_DISPATCHER_LINEUP_CONFIRMATION_LEAD_SECONDS",
      600,
    ),
    lineupLiveRecoverySeconds: positiveInteger(
      env,
      "FOOTBALL_MATCH_DISPATCHER_LINEUP_LIVE_RECOVERY_SECONDS",
      3_600,
    ),
    failureCooldownSeconds: positiveInteger(
      env,
      "FOOTBALL_MATCH_DISPATCHER_FAILURE_COOLDOWN_SECONDS",
      300,
    ),
  };
}
