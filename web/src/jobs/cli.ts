import { loadLocalJobEnvFiles, getJobRunnerConfig } from "./config";
import { listJobTypes, productionJobRegistry } from "./registry";
import { JobRepository } from "./repository";
import { formatRunnerOutcome, runJobOnce } from "./runner";
import { JobConfigError, JobUsageError, RUNNER_EXIT_CODES } from "./types";

type CliCommand =
  | {
      name: "check-runtime";
    }
  | {
      name: "list-types";
    }
  | {
      name: "run";
      type: string;
      args: string[];
    };

function printUsage(): void {
  console.error("Usage:");
  console.error("  node job-runner/cli.js --check-runtime");
  console.error("  node job-runner/cli.js --list-types");
  console.error("  node job-runner/cli.js --type <job-type> [job arguments...]");
}

export function parseCliArguments(argv: readonly string[]): CliCommand {
  const normalizedArgv = argv[0] === "--" ? argv.slice(1) : argv;

  if (normalizedArgv.length === 1 && normalizedArgv[0] === "--check-runtime") {
    return { name: "check-runtime" };
  }

  if (normalizedArgv.length === 1 && normalizedArgv[0] === "--list-types") {
    return { name: "list-types" };
  }

  if (normalizedArgv[0] === "--type") {
    const type = normalizedArgv[1];

    if (!type) {
      throw new JobUsageError("--type requires a job type");
    }

    return {
      name: "run",
      type,
      args: normalizedArgv.slice(2),
    };
  }

  throw new JobUsageError("Unknown job runner command");
}

function printRuntimeCheck(): void {
  console.log("job_runner_runtime=ok");
  console.log(`pg_dependency=${typeof JobRepository === "function" ? "loaded" : "missing"}`);
  console.log(`production_job_types=${listJobTypes(productionJobRegistry).length}`);
}

async function main(): Promise<number> {
  const command = parseCliArguments(process.argv.slice(2));

  if (command.name === "check-runtime") {
    printRuntimeCheck();
    return RUNNER_EXIT_CODES.success;
  }

  if (command.name === "list-types") {
    const types = listJobTypes(productionJobRegistry);

    for (const type of types) {
      console.log(type);
    }

    console.log(`production_job_types=${types.length}`);
    return RUNNER_EXIT_CODES.success;
  }

  loadLocalJobEnvFiles();

  const config = getJobRunnerConfig();
  const repository = new JobRepository(config);

  try {
    const result = await runJobOnce({
      type: command.type,
      args: command.args,
      registry: productionJobRegistry,
      config,
      repository,
    });

    for (const line of formatRunnerOutcome(result.outcome)) {
      console.log(line);
    }

    return result.exitCode;
  } finally {
    await repository.close();
  }
}

main()
  .then((exitCode) => {
    process.exitCode = exitCode;
  })
  .catch((error: unknown) => {
    if (error instanceof JobUsageError || error instanceof JobConfigError) {
      console.error(error.message);
      printUsage();
      process.exitCode = RUNNER_EXIT_CODES.usageOrConfig;
      return;
    }

    if (error instanceof Error) {
      console.error(error.stack ?? error.message);
    } else {
      console.error(error);
    }

    process.exitCode = RUNNER_EXIT_CODES.internalError;
  });
