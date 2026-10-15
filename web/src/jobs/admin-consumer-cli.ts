import { getApiFootballRealProviderConfig } from "../football/api-football/core-config";
import { AdminJobRepository } from "./admin-repository";
import { runAdminConsumer } from "./admin-consumer";
import { getJobRunnerConfig, loadLocalJobEnvFiles } from "./config";
import { listJobTypes, productionJobRegistry } from "./registry";
import { formatRunnerOutcome } from "./runner";
import { JobConfigError, JobUsageError, RUNNER_EXIT_CODES } from "./types";

export function parseAdminConsumerArguments(args: readonly string[]): "check-runtime" | "once" | "run" {
  if (args.length === 1) {
    if (args[0] === "--check-runtime") return "check-runtime";
    if (args[0] === "--once") return "once";
    if (args[0] === "--run") return "run";
  }
  throw new JobUsageError("Admin consumer requires exactly --check-runtime, --once or --run");
}

export function requireAdminConsumerOptIn(env: Record<string, string | undefined>): void {
  if (env.FOOTBALL_ADMIN_CONSUMER_STAGE !== "staging" || env.FOOTBALL_ADMIN_CONSUMER_ENABLED !== "true") {
    throw new JobConfigError("Admin consumer requires explicit STAGING enablement");
  }
  getApiFootballRealProviderConfig(env);
}

export async function adminConsumerMain(args = process.argv.slice(2)): Promise<number> {
  const command = parseAdminConsumerArguments(args);
  if (command === "check-runtime") {
    console.log("football_admin_consumer_runtime=ok");
    console.log(`production_job_types=${listJobTypes(productionJobRegistry).length}`);
    return RUNNER_EXIT_CODES.success;
  }
  loadLocalJobEnvFiles();
  requireAdminConsumerOptIn(process.env);
  const config = getJobRunnerConfig();
  const repository = new AdminJobRepository(config);
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
  try {
    const result = await runAdminConsumer({
      repository, config, once: command === "once", signal: controller.signal,
      onResult: (value) => console.log(formatRunnerOutcome(value.outcome).join("\n")),
    });
    console.log(`football_admin_consumer=${result}`);
    return result === "already_running" ? RUNNER_EXIT_CODES.noOp : RUNNER_EXIT_CODES.success;
  } finally {
    process.removeListener("SIGTERM", stop);
    process.removeListener("SIGINT", stop);
    await repository.close();
  }
}

export function startAdminConsumerCli(): void {
  adminConsumerMain().then((code) => { process.exitCode = code; }).catch((error: unknown) => {
    // No connection strings, provider errors or credentials in process-level logs.
    const controlled = error instanceof JobUsageError || error instanceof JobConfigError;
    console.error(controlled ? error.message : "Admin consumer stopped after an internal error");
    process.exitCode = controlled ? RUNNER_EXIT_CODES.usageOrConfig : RUNNER_EXIT_CODES.internalError;
  });
}
