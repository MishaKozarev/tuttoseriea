import { getJobRunnerConfig, loadLocalJobEnvFiles } from "./config";
import {
  MATCH_DATA_BACKFILL_MAX_CONCURRENCY,
  MATCH_DATA_BACKFILL_MIN_REQUEST_INTERVAL_MS,
  runMatchDataBackfill,
  type MatchDataBackfillPlan,
} from "./match-data-backfill";
import { MatchDataBackfillRepository } from "./match-data-backfill-repository";
import { listJobTypes, productionJobRegistry } from "./registry";
import { JobRepository } from "./repository";
import { runJobOnce } from "./runner";
import { JobConfigError, JobUsageError, RUNNER_EXIT_CODES } from "./types";

export type MatchDataBackfillCommand = "check-runtime" | "dry-run" | "run";

export function parseMatchDataBackfillArguments(
  argv: readonly string[],
): MatchDataBackfillCommand {
  if (argv.length !== 1) {
    throw new JobUsageError(
      "Match data backfill requires exactly --check-runtime, --dry-run or --run",
    );
  }

  if (argv[0] === "--check-runtime") {
    return "check-runtime";
  }

  if (argv[0] === "--dry-run") {
    return "dry-run";
  }

  if (argv[0] === "--run") {
    return "run";
  }

  throw new JobUsageError("Unknown Match data backfill command");
}

function printPlan(plan: MatchDataBackfillPlan): void {
  console.log(`finished_matches_total=${plan.totalFinishedMatches}`);
  console.log(`candidate_matches=${plan.candidateMatches}`);
  console.log(`missing_events=${plan.missingEvents}`);
  console.log(`missing_lineups=${plan.missingLineups}`);
  console.log(`missing_statistics=${plan.missingStatistics}`);
  console.log(`already_complete=${plan.alreadyComplete}`);
  console.log(`dataset_operations=${plan.datasetOperations}`);
  console.log(
    `clean_path_estimated_provider_requests=${plan.cleanPathEstimatedProviderRequests}`,
  );

  for (const candidate of plan.candidates) {
    console.log(
      JSON.stringify({
        event: "football.match_data_backfill.candidate",
        match_id: candidate.matchId,
        provider_fixture_id: candidate.providerFixtureId,
        status_changed_at: candidate.statusChangedAt,
        missing_datasets: candidate.missingDatasets,
      }),
    );
  }
}

async function main(argv = process.argv.slice(2)): Promise<number> {
  const command = parseMatchDataBackfillArguments(argv);

  if (command === "check-runtime") {
    console.log("match_data_backfill_runtime=ok");
    console.log(`production_job_types=${listJobTypes(productionJobRegistry).length}`);
    console.log(`backfill_max_concurrency=${MATCH_DATA_BACKFILL_MAX_CONCURRENCY}`);
    console.log(
      `backfill_min_request_interval_ms=${MATCH_DATA_BACKFILL_MIN_REQUEST_INTERVAL_MS}`,
    );
    return RUNNER_EXIT_CODES.success;
  }

  loadLocalJobEnvFiles();
  const config = getJobRunnerConfig();
  const repository = new MatchDataBackfillRepository(config);
  const jobRepository = command === "run" ? new JobRepository(config) : null;

  try {
    const result = await runMatchDataBackfill({
      repository,
      mode: command,
      runJob:
        command === "run" && jobRepository
          ? (type, args, beforeProviderRequestAttempt) =>
              runJobOnce({
                type,
                args,
                registry: productionJobRegistry,
                config,
                repository: jobRepository,
                beforeProviderRequestAttempt,
              })
          : undefined,
    });

    console.log(`backfill_outcome=${result.status}`);

    if (result.status === "no_op") {
      console.log(`backfill_reason=${result.reason}`);
      return RUNNER_EXIT_CODES.noOp;
    }

    printPlan(result.plan);

    if (result.status === "dry_run") {
      console.log("provider_calls=0");
      console.log("job_executions_created=0");
      return RUNNER_EXIT_CODES.success;
    }

    for (const operation of result.results) {
      console.log(
        JSON.stringify({
          event: "football.match_data_backfill.operation_outcome",
          match_id: operation.matchId,
          provider_fixture_id: operation.providerFixtureId,
          dataset: operation.dataset,
          job_type: operation.jobType,
          job_outcome: operation.jobOutcome,
          execution_id: operation.executionId,
          verified_complete: operation.verifiedComplete,
        }),
      );
    }

    console.log(
      `verified_remaining_dataset_operations=${result.verifiedPlan.datasetOperations}`,
    );

    return result.status === "completed"
      ? RUNNER_EXIT_CODES.success
      : RUNNER_EXIT_CODES.terminalFailure;
  } finally {
    await Promise.all([repository.close(), jobRepository?.close()]);
  }
}

export function startMatchDataBackfillCli(): void {
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
}
