import { getJobRunnerConfig, loadLocalJobEnvFiles } from "./config";
import {
  createDispatcherJobRunner,
  runMatchLifecycleDispatcher,
} from "./match-lifecycle-dispatcher";
import { getMatchLifecycleDispatcherConfig } from "./match-lifecycle-config";
import { MatchLifecycleRepository } from "./match-lifecycle-repository";
import { listJobTypes, productionJobRegistry } from "./registry";
import { JobRepository } from "./repository";
import { JobConfigError, JobUsageError, RUNNER_EXIT_CODES } from "./types";

type DispatcherCommand = "check-runtime" | "run" | "dry-run";

function parseArguments(argv: readonly string[]): DispatcherCommand {
  if (argv.length !== 1) {
    throw new JobUsageError(
      "Match lifecycle dispatcher requires exactly --run, --dry-run or --check-runtime",
    );
  }

  if (argv[0] === "--run") {
    return "run";
  }

  if (argv[0] === "--dry-run") {
    return "dry-run";
  }

  if (argv[0] === "--check-runtime") {
    return "check-runtime";
  }

  throw new JobUsageError("Unknown Match lifecycle dispatcher command");
}

async function main(): Promise<number> {
  const command = parseArguments(process.argv.slice(2));

  if (command === "check-runtime") {
    console.log("match_lifecycle_dispatcher_runtime=ok");
    console.log(`production_job_types=${listJobTypes(productionJobRegistry).length}`);
    return RUNNER_EXIT_CODES.success;
  }

  loadLocalJobEnvFiles();

  const jobConfig = getJobRunnerConfig();
  const dispatcherConfig = getMatchLifecycleDispatcherConfig();
  const lifecycleRepository = new MatchLifecycleRepository(jobConfig);
  const jobRepository = new JobRepository(jobConfig);

  try {
    const result = await runMatchLifecycleDispatcher({
      repository: lifecycleRepository,
      runJob: createDispatcherJobRunner({
        config: jobConfig,
        repository: jobRepository,
      }),
      config: dispatcherConfig,
      dryRun: command === "dry-run",
    });

    console.log(`dispatcher_outcome=${result.status}`);
    if (result.reason) {
      console.log(`dispatcher_reason=${result.reason}`);
    }
    console.log(`lifecycle_refreshed=${result.lifecycleRefreshed}`);
    console.log(`lifecycle_fresh=${result.lifecycleFresh}`);
    console.log(`dataset_tasks_selected=${result.selectedTasks}`);
    console.log(`dataset_tasks_completed=${result.completedTasks}`);

    return RUNNER_EXIT_CODES.success;
  } finally {
    await Promise.all([lifecycleRepository.close(), jobRepository.close()]);
  }
}

main()
  .then((exitCode) => {
    process.exitCode = exitCode;
  })
  .catch((error: unknown) => {
    if (error instanceof JobUsageError || error instanceof JobConfigError) {
      console.error(error.message);
      process.exitCode = RUNNER_EXIT_CODES.usageOrConfig;
      return;
    }

    console.error(error instanceof Error ? (error.stack ?? error.message) : error);
    process.exitCode = RUNNER_EXIT_CODES.internalError;
  });
