import crypto from "node:crypto";

import { normalizeRetryDelaySeconds, type JobRunnerConfig } from "./config";
import { getJobDefinition } from "./registry";
import { JobRepository } from "./repository";
import {
  JobLeaseLostError,
  RUNNER_EXIT_CODES,
  type ClaimedJobExecution,
  type JobExecution,
  type JobExecutionContext,
  type JobRegistry,
  type RunnerExitCode,
  type RunnerOutcome,
} from "./types";

const unexpectedHandlerError = {
  code: "handler_unexpected_error",
  message: "Job handler failed unexpectedly.",
} as const;

export type RunJobInput = {
  type: string;
  args: readonly string[];
  registry: JobRegistry;
  config: JobRunnerConfig;
  repository?: JobRepository;
  runnerId?: string;
};

export type RunJobResult = {
  outcome: RunnerOutcome;
  exitCode: RunnerExitCode;
};

function createRunnerId(): string {
  return `job-runner:${process.pid}:${crypto.randomUUID()}`;
}

function leaseIdentity(execution: ClaimedJobExecution, runnerId: string) {
  return {
    id: execution.id,
    runnerId,
    claimVersion: execution.claimVersion,
  };
}

async function assertFinalized(
  execution: ClaimedJobExecution,
  runnerId: string,
  finalized: Promise<JobExecution | null>,
): Promise<JobExecution> {
  const result = await finalized;

  if (!result) {
    throw new JobLeaseLostError(
      `Job execution ${execution.id} lost lease before finalization`,
    );
  }

  return result;
}

function createContext(
  repository: JobRepository,
  execution: ClaimedJobExecution,
  runnerId: string,
  leaseSeconds: number,
): JobExecutionContext {
  return {
    execution,
    heartbeat: async () => {
      const heartbeat = await repository.heartbeat(
        leaseIdentity(execution, runnerId),
        leaseSeconds,
      );

      if (!heartbeat) {
        throw new JobLeaseLostError(
          `Job execution ${execution.id} lost lease during heartbeat`,
        );
      }
    },
  };
}

export async function runJobOnce(input: RunJobInput): Promise<RunJobResult> {
  const definition = getJobDefinition(input.registry, input.type);
  const parsed = definition.parseArguments(input.args);
  const runnerId = input.runnerId ?? createRunnerId();
  const repository =
    input.repository ??
    new JobRepository({
      databaseUrl: input.config.databaseUrl,
      jobsSchema: input.config.jobsSchema,
    });

  const execution = await repository.createOrGetActiveExecution({
    type: definition.type,
    idempotencyKey: parsed.idempotencyKey,
    payload: parsed.payload,
    maxAttempts: input.config.maxAttempts,
  });

  const claimed = await repository.claimExecution(
    execution.id,
    runnerId,
    input.config.leaseSeconds,
  );

  if (!claimed) {
    const current = (await repository.getExecution(execution.id)) ?? execution;

    return {
      outcome: {
        status: "no_op",
        reason: current.status === "running" ? "duplicate_active" : "not_claimable",
        execution: current,
      },
      exitCode: RUNNER_EXIT_CODES.noOp,
    };
  }

  const identity = leaseIdentity(claimed, runnerId);
  const context = createContext(repository, claimed, runnerId, input.config.leaseSeconds);

  try {
    const result = await definition.handle(context);

    if (result.status === "success") {
      const finalized = await assertFinalized(
        claimed,
        runnerId,
        repository.finalizeSuccess(identity),
      );

      return {
        outcome: { status: "success", execution: finalized },
        exitCode: RUNNER_EXIT_CODES.success,
      };
    }

    if (result.status === "retry") {
      if (claimed.attemptCount >= claimed.maxAttempts) {
        const finalized = await assertFinalized(
          claimed,
          runnerId,
          repository.finalizeFailure({
            ...identity,
            code: "max_attempts_exhausted",
            message: result.message,
          }),
        );

        return {
          outcome: { status: "terminal_failure", execution: finalized },
          exitCode: RUNNER_EXIT_CODES.terminalFailure,
        };
      }

      const finalized = await assertFinalized(
        claimed,
        runnerId,
        repository.finalizeRetry({
          ...identity,
          code: result.errorCode,
          message: result.message,
          delaySeconds: normalizeRetryDelaySeconds(result.retryDelaySeconds, input.config),
        }),
      );

      return {
        outcome: { status: "retry_scheduled", execution: finalized },
        exitCode: RUNNER_EXIT_CODES.retryScheduled,
      };
    }

    const finalized = await assertFinalized(
      claimed,
      runnerId,
      repository.finalizeFailure({
        ...identity,
        code: result.errorCode,
        message: result.message,
      }),
    );

    return {
      outcome: { status: "terminal_failure", execution: finalized },
      exitCode: RUNNER_EXIT_CODES.terminalFailure,
    };
  } catch (error) {
    if (error instanceof JobLeaseLostError) {
      return {
        outcome: { status: "lease_lost", executionId: claimed.id },
        exitCode: RUNNER_EXIT_CODES.leaseLost,
      };
    }

    const finalized = await repository.finalizeFailure({
      ...identity,
      ...unexpectedHandlerError,
    });

    if (!finalized) {
      return {
        outcome: { status: "lease_lost", executionId: claimed.id },
        exitCode: RUNNER_EXIT_CODES.leaseLost,
      };
    }

    return {
      outcome: { status: "terminal_failure", execution: finalized },
      exitCode: RUNNER_EXIT_CODES.terminalFailure,
    };
  }
}

export function formatRunnerOutcome(outcome: RunnerOutcome): string[] {
  if (outcome.status === "lease_lost") {
    return [`job_outcome=${outcome.status}`, `execution_id=${outcome.executionId}`];
  }

  const lines = [
    `job_outcome=${outcome.status}`,
    `execution_id=${outcome.execution.id}`,
  ];

  if (outcome.status === "no_op") {
    lines.push(`job_no_op_reason=${outcome.reason}`);
  }

  lines.push(
    `job_type=${outcome.execution.type}`,
    `job_status=${outcome.execution.status}`,
    `job_attempt_count=${outcome.execution.attemptCount}`,
  );

  if (outcome.execution.lastErrorCode) {
    lines.push(`job_last_error_code=${outcome.execution.lastErrorCode}`);
  }

  return lines;
}
