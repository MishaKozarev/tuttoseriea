import {
  SERIE_A_MATCHES_JOB_TYPE,
} from "../football/foundation";
import type { JobRunnerConfig } from "./config";
import { getJobDefinition, productionJobRegistry } from "./registry";
import { JobRepository } from "./repository";
import { runJobOnce, type RunJobResult } from "./runner";
import type { JobRegistry } from "./types";
import type { MatchLifecycleDispatcherConfig } from "./match-lifecycle-config";
import {
  isLifecycleSnapshotFresh,
  selectDueDatasetTasks,
  type DispatcherExecution,
  type DispatcherTask,
} from "./match-lifecycle-policy";
import type { MatchLifecycleRepositoryContract } from "./match-lifecycle-repository";

export type DispatcherJobRunner = (
  type: string,
  args: readonly string[],
  task?: DispatcherTask,
) => Promise<RunJobResult>;

export type MatchLifecycleDispatcherResult = {
  status: "completed" | "no_op";
  reason?: "lock_held" | "before_managed_from" | "lifecycle_not_fresh";
  lifecycleRefreshed: boolean;
  lifecycleFresh: boolean;
  selectedTasks: number;
  completedTasks: number;
};

function latestExecution(executions: readonly DispatcherExecution[]) {
  return executions[0] ?? null;
}

function latestSuccessfulLifecycleAt(
  executions: readonly DispatcherExecution[],
): Date | null {
  return (
    executions.find(
      (execution) =>
        execution.status === "succeeded" && execution.finishedAt !== null,
    )?.finishedAt ?? null
  );
}

function lifecycleFailureIsCoolingDown(
  executions: readonly DispatcherExecution[],
  now: Date,
  config: MatchLifecycleDispatcherConfig,
): boolean {
  const latest = latestExecution(executions);

  return (
    latest?.status === "failed" &&
    now.getTime() - latest.updatedAt.getTime() < config.failureCooldownSeconds * 1_000
  );
}

async function runWithConcurrency(
  tasks: readonly DispatcherTask[],
  concurrency: number,
  runJob: DispatcherJobRunner,
): Promise<number> {
  let nextIndex = 0;
  let completed = 0;

  const worker = async () => {
    while (nextIndex < tasks.length) {
      const task = tasks[nextIndex];
      nextIndex += 1;

      if (!task) {
        continue;
      }

      const result = await runJob(
        task.type,
        ["--match-id", task.matchId],
        task,
      );

      console.log(
        JSON.stringify({
          event: "football.match_lifecycle.dataset_outcome",
          match_id: task.matchId,
          job_type: task.type,
          phase: task.phase,
          outcome: result.outcome.status,
          execution_id:
            result.outcome.status === "lease_lost"
              ? result.outcome.executionId
              : result.outcome.execution.id,
        }),
      );
      completed += 1;
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(concurrency, tasks.length) }, () => worker()),
  );

  return completed;
}

export async function runMatchLifecycleDispatcher(input: {
  repository: MatchLifecycleRepositoryContract;
  runJob: DispatcherJobRunner;
  config: MatchLifecycleDispatcherConfig;
  now?: Date;
  dryRun?: boolean;
}): Promise<MatchLifecycleDispatcherResult> {
  const now = input.now ?? new Date();
  const lock = await input.repository.tryAcquireLock();

  if (!lock) {
    return {
      status: "no_op",
      reason: "lock_held",
      lifecycleRefreshed: false,
      lifecycleFresh: false,
      selectedTasks: 0,
      completedTasks: 0,
    };
  }

  try {
    if (now < input.config.managedFrom) {
      return {
        status: "no_op",
        reason: "before_managed_from",
        lifecycleRefreshed: false,
        lifecycleFresh: false,
        selectedTasks: 0,
        completedTasks: 0,
      };
    }

    let matches = await input.repository.listCurrentSerieAMatches();
    let lifecycleExecutions = await input.repository.listLifecycleExecutions();
    let lifecycleFresh = isLifecycleSnapshotFresh(
      latestSuccessfulLifecycleAt(lifecycleExecutions),
      matches,
      now,
      input.config,
    );
    let lifecycleRefreshed = false;

    if (!lifecycleFresh) {
      if (input.dryRun || lifecycleFailureIsCoolingDown(lifecycleExecutions, now, input.config)) {
        return {
          status: "no_op",
          reason: "lifecycle_not_fresh",
          lifecycleRefreshed: false,
          lifecycleFresh: false,
          selectedTasks: 0,
          completedTasks: 0,
        };
      }

      const lifecycleResult = await input.runJob(SERIE_A_MATCHES_JOB_TYPE, []);

      if (lifecycleResult.outcome.status !== "success") {
        return {
          status: "no_op",
          reason: "lifecycle_not_fresh",
          lifecycleRefreshed: false,
          lifecycleFresh: false,
          selectedTasks: 0,
          completedTasks: 0,
        };
      }

      lifecycleRefreshed = true;
      matches = await input.repository.listCurrentSerieAMatches();
      lifecycleExecutions = await input.repository.listLifecycleExecutions();
      lifecycleFresh = isLifecycleSnapshotFresh(
        latestSuccessfulLifecycleAt(lifecycleExecutions),
        matches,
        now,
        input.config,
      );

      if (!lifecycleFresh) {
        return {
          status: "no_op",
          reason: "lifecycle_not_fresh",
          lifecycleRefreshed,
          lifecycleFresh: false,
          selectedTasks: 0,
          completedTasks: 0,
        };
      }
    }

    const executions = await input.repository.listMatchExecutions(
      input.config.managedFrom,
    );
    const tasks = selectDueDatasetTasks(
      matches,
      executions,
      now,
      input.config,
    );

    if (input.dryRun) {
      return {
        status: "completed",
        lifecycleRefreshed,
        lifecycleFresh,
        selectedTasks: tasks.length,
        completedTasks: 0,
      };
    }

    const completedTasks = await runWithConcurrency(
      tasks,
      input.config.maxConcurrency,
      input.runJob,
    );

    return {
      status: "completed",
      lifecycleRefreshed,
      lifecycleFresh,
      selectedTasks: tasks.length,
      completedTasks,
    };
  } finally {
    await lock.release();
  }
}

function registryWithDispatcherMetadata(task: DispatcherTask): JobRegistry {
  const definition = getJobDefinition(productionJobRegistry, task.type);

  return new Map([
    [
      definition.type,
      {
        ...definition,
        parseArguments: (args: readonly string[]) => {
          const parsed = definition.parseArguments(args);

          return {
            ...parsed,
            payload: {
              ...parsed.payload,
              dispatcher: {
                version: 1,
                phase: task.phase,
                statusChangedAt: task.statusChangedAt,
              },
            },
          };
        },
      },
    ],
  ]);
}

export function createDispatcherJobRunner(input: {
  config: JobRunnerConfig;
  repository: JobRepository;
}): DispatcherJobRunner {
  return async (type, args, task) =>
    runJobOnce({
      type,
      args,
      registry: task ? registryWithDispatcherMetadata(task) : productionJobRegistry,
      config: input.config,
      repository: input.repository,
    });
}
