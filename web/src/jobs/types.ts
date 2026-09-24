export const JOB_EXECUTION_STATUSES = ["pending", "running", "succeeded", "failed"] as const;

export type JobExecutionStatus = (typeof JOB_EXECUTION_STATUSES)[number];

export type JsonObject = Record<string, unknown>;

export type JobExecution = {
  id: string;
  type: string;
  idempotencyKey: string;
  status: JobExecutionStatus;
  payload: JsonObject;
  availableAt: Date;
  attemptCount: number;
  maxAttempts: number;
  claimedBy: string | null;
  claimVersion: number;
  leaseExpiresAt: Date | null;
  startedAt: Date | null;
  finishedAt: Date | null;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type ParsedJobArguments = {
  idempotencyKey: string;
  payload: JsonObject;
};

export type JobHandlerSuccess = {
  status: "success";
};

export type JobHandlerRetry = {
  status: "retry";
  errorCode: string;
  message: string;
  retryDelaySeconds?: number;
};

export type JobHandlerFailure = {
  status: "failed";
  errorCode: string;
  message: string;
};

export type JobHandlerResult =
  | JobHandlerSuccess
  | JobHandlerRetry
  | JobHandlerFailure;

export type ClaimedJobExecution = JobExecution & {
  status: "running";
  claimedBy: string;
  leaseExpiresAt: Date;
};

export type JobExecutionContext = {
  execution: ClaimedJobExecution;
  heartbeat: () => Promise<void>;
};

export type JobDefinition = {
  type: string;
  parseArguments: (args: readonly string[]) => ParsedJobArguments;
  handle: (context: JobExecutionContext) => Promise<JobHandlerResult>;
};

export type JobRegistry = ReadonlyMap<string, JobDefinition>;

export const RUNNER_EXIT_CODES = {
  success: 0,
  internalError: 1,
  terminalFailure: 2,
  noOp: 3,
  retryScheduled: 4,
  leaseLost: 5,
  usageOrConfig: 64,
} as const;

export type RunnerExitCode =
  (typeof RUNNER_EXIT_CODES)[keyof typeof RUNNER_EXIT_CODES];

export type RunnerOutcome =
  | {
      status: "success";
      execution: JobExecution;
    }
  | {
      status: "retry_scheduled";
      execution: JobExecution;
    }
  | {
      status: "terminal_failure";
      execution: JobExecution;
    }
  | {
      status: "no_op";
      reason: "duplicate_active" | "not_claimable";
      execution: JobExecution;
    }
  | {
      status: "lease_lost";
      executionId: string;
    };

export class JobUsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "JobUsageError";
  }
}

export class JobConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "JobConfigError";
  }
}

export class JobLeaseLostError extends Error {
  constructor(message = "Job lease ownership was lost") {
    super(message);
    this.name = "JobLeaseLostError";
  }
}
