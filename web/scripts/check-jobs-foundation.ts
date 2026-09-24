import crypto from "node:crypto";

import { config as loadEnv } from "dotenv";
import pg from "pg";

import {
  createJobRegistry,
  getJobRunnerConfig,
  JobRepository,
  JobUsageError,
  RUNNER_EXIT_CODES,
  runJobOnce,
  type JobDefinition,
  type JobRegistry,
  type ParsedJobArguments,
} from "../src/jobs";

const { Pool } = pg;

loadEnv({ path: ".env.local", quiet: true });
loadEnv({ path: ".env", quiet: true });

const identifierPattern = /^[A-Za-z_][A-Za-z0-9_]*$/;

type CountRow = {
  count: number;
};

type ExecutionStateRow = {
  id: string;
  status: string;
  attempt_count: number;
  last_error_code: string | null;
};

type RetryTimingRow = {
  delay_seconds: string;
};

function requireEnv(name: string): string {
  const value = process.env[name];

  if (!value) {
    throw new Error(`${name} is required`);
  }

  return value;
}

function quoteIdentifier(value: string): string {
  if (!identifierPattern.test(value)) {
    throw new Error(`${value} is not a valid PostgreSQL identifier`);
  }

  return `"${value.replaceAll('"', '""')}"`;
}

function assertCondition(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function parseScopeArguments(args: readonly string[]): ParsedJobArguments {
  if (args.length !== 2 || args[0] !== "--scope") {
    throw new JobUsageError("Expected --scope <value>");
  }

  const scope = args[1]?.trim().toLowerCase();

  if (!scope || !/^[a-z0-9-]+$/u.test(scope)) {
    throw new JobUsageError("Scope must contain only lowercase letters, numbers and dashes");
  }

  return {
    idempotencyKey: `scope:${scope}`,
    payload: { scope },
  };
}

function createCheckRegistry(
  typePrefix: string,
  migrationPool: pg.Pool,
  executionsTable: string,
): JobRegistry {
  const definitions: JobDefinition[] = [
    {
      type: `${typePrefix}success`,
      parseArguments: parseScopeArguments,
      handle: async (context) => {
        await context.heartbeat();
        return { status: "success" };
      },
    },
    {
      type: `${typePrefix}retry`,
      parseArguments: parseScopeArguments,
      handle: async (context) => {
        await context.heartbeat();
        return {
          status: "retry",
          errorCode: "check_retry_requested",
          message: "Retry requested by jobs foundation check.",
          retryDelaySeconds: 120,
        };
      },
    },
    {
      type: `${typePrefix}failure`,
      parseArguments: parseScopeArguments,
      handle: async (context) => {
        await context.heartbeat();
        return {
          status: "failed",
          errorCode: "check_terminal_failure",
          message: "Terminal failure requested by jobs foundation check.",
        };
      },
    },
    {
      type: `${typePrefix}exception`,
      parseArguments: parseScopeArguments,
      handle: async () => {
        throw new Error("Unexpected check handler failure");
      },
    },
    {
      type: `${typePrefix}lease-loss`,
      parseArguments: parseScopeArguments,
      handle: async (context) => {
        await context.heartbeat();
        await migrationPool.query(
          `
            update ${executionsTable}
            set claim_version = claim_version + 1
            where id = $1
          `,
          [context.execution.id],
        );
        await context.heartbeat();
        return { status: "success" };
      },
    },
  ];

  return createJobRegistry(definitions);
}

async function deleteCheckRows(
  migrationPool: pg.Pool,
  executionsTable: string,
  typePrefix: string,
): Promise<number> {
  const result = await migrationPool.query(
    `delete from ${executionsTable} where type like $1`,
    [`${typePrefix}%`],
  );

  return result.rowCount ?? 0;
}

async function insertStaleExecution(
  migrationPool: pg.Pool,
  executionsTable: string,
  input: {
    id: string;
    type: string;
    idempotencyKey: string;
    attemptCount: number;
    maxAttempts: number;
  },
): Promise<void> {
  await migrationPool.query(
    `
      insert into ${executionsTable} (
        id,
        type,
        idempotency_key,
        status,
        payload,
        available_at,
        attempt_count,
        max_attempts,
        claimed_by,
        claim_version,
        lease_expires_at,
        started_at
      )
      values (
        $1,
        $2,
        $3,
        'running',
        $4::jsonb,
        now(),
        $5,
        $6,
        'stale-check-runner',
        1,
        now() - interval '5 minutes',
        now() - interval '10 minutes'
      )
    `,
    [
      input.id,
      input.type,
      input.idempotencyKey,
      JSON.stringify({ scope: input.idempotencyKey }),
      input.attemptCount,
      input.maxAttempts,
    ],
  );
}

async function countRows(
  migrationPool: pg.Pool,
  executionsTable: string,
  whereSql: string,
  values: unknown[],
): Promise<number> {
  const result = await migrationPool.query<CountRow>(
    `select count(*)::int as count from ${executionsTable} where ${whereSql}`,
    values,
  );

  return result.rows[0]?.count ?? 0;
}

async function getExecutionState(
  migrationPool: pg.Pool,
  executionsTable: string,
  id: string,
): Promise<ExecutionStateRow> {
  const result = await migrationPool.query<ExecutionStateRow>(
    `
      select id, status, attempt_count, last_error_code
      from ${executionsTable}
      where id = $1
    `,
    [id],
  );
  const row = result.rows[0];

  if (!row) {
    throw new Error(`Execution ${id} was not found`);
  }

  return row;
}

async function getAvailableDelaySeconds(
  migrationPool: pg.Pool,
  executionsTable: string,
  id: string,
): Promise<number> {
  const result = await migrationPool.query<RetryTimingRow>(
    `
      select extract(epoch from (available_at - now()))::text as delay_seconds
      from ${executionsTable}
      where id = $1
    `,
    [id],
  );
  const value = result.rows[0]?.delay_seconds;

  if (value === undefined) {
    throw new Error(`Execution ${id} was not found for available_at timing check`);
  }

  return Number(value);
}

async function main(): Promise<void> {
  const jobsSchema = process.env.DATABASE_JOBS_SCHEMA ?? "jobs";
  const executionsTable = `${quoteIdentifier(jobsSchema)}.${quoteIdentifier("executions")}`;
  const typePrefix = `stage41a-check-${crypto.randomUUID()}-`;
  const migrationPool = new Pool({
    connectionString: requireEnv("MIGRATION_DATABASE_URL"),
    max: 2,
  });
  const repository = new JobRepository(getJobRunnerConfig());
  const registry = createCheckRegistry(typePrefix, migrationPool, executionsTable);

  try {
    await deleteCheckRows(migrationPool, executionsTable, typePrefix);

    const success = await runJobOnce({
      type: `${typePrefix}success`,
      args: ["--scope", "success"],
      registry,
      config: getJobRunnerConfig(),
      repository,
      runnerId: "stage41a-check-success",
    });

    assertCondition(success.exitCode === RUNNER_EXIT_CODES.success, "success job failed");
    assertCondition(
      success.outcome.status === "success" && success.outcome.execution.status === "succeeded",
      "success job did not finalize as succeeded",
    );

    const duplicateCreateResults = await Promise.all([
      repository.createOrGetActiveExecution({
        type: `${typePrefix}success`,
        idempotencyKey: "scope:duplicate-create",
        payload: { scope: "duplicate-create" },
        maxAttempts: 3,
      }),
      repository.createOrGetActiveExecution({
        type: `${typePrefix}success`,
        idempotencyKey: "scope:duplicate-create",
        payload: { scope: "duplicate-create" },
        maxAttempts: 3,
      }),
    ]);

    assertCondition(
      duplicateCreateResults[0]?.id === duplicateCreateResults[1]?.id,
      "duplicate concurrent create did not return the same active execution",
    );
    assertCondition(
      (await countRows(
        migrationPool,
        executionsTable,
        "type = $1 and idempotency_key = $2 and status in ('pending', 'running')",
        [`${typePrefix}success`, "scope:duplicate-create"],
      )) === 1,
      "duplicate concurrent create produced more than one active execution",
    );

    const competingClaimExecution = await repository.createOrGetActiveExecution({
      type: `${typePrefix}success`,
      idempotencyKey: "scope:competing-claims",
      payload: { scope: "competing-claims" },
      maxAttempts: 3,
    });
    const competingClaims = await Promise.all([
      repository.claimExecution(competingClaimExecution.id, "stage41a-check-owner-a", 60),
      repository.claimExecution(competingClaimExecution.id, "stage41a-check-owner-b", 60),
    ]);
    const claimedByCompetitor = competingClaims.filter((claim) => claim !== null);
    const claimedExecution = claimedByCompetitor[0];

    assertCondition(
      claimedByCompetitor.length === 1 && !!claimedExecution,
      "competing claims did not produce exactly one owner",
    );
    assertCondition(
      claimedExecution.attemptCount === 1 && claimedExecution.claimVersion === 1,
      "claim did not increment attempt_count and claim_version",
    );
    assertCondition(
      (await repository.heartbeat(
        {
          id: claimedExecution.id,
          runnerId: claimedExecution.claimedBy,
          claimVersion: claimedExecution.claimVersion - 1,
        },
        60,
      )) === null,
      "heartbeat accepted a stale fencing token",
    );
    assertCondition(
      (await repository.finalizeSuccess({
        id: claimedExecution.id,
        runnerId: "stage41a-check-stale-owner",
        claimVersion: claimedExecution.claimVersion,
      })) === null,
      "finalize accepted a stale owner",
    );
    assertCondition(
      (await repository.finalizeSuccess({
        id: claimedExecution.id,
        runnerId: claimedExecution.claimedBy,
        claimVersion: claimedExecution.claimVersion,
      }))?.status === "succeeded",
      "current owner could not finalize after stale owner was blocked",
    );

    const retry = await runJobOnce({
      type: `${typePrefix}retry`,
      args: ["--scope", "retry"],
      registry,
      config: getJobRunnerConfig(),
      repository,
      runnerId: "stage41a-check-retry",
    });

    assertCondition(
      retry.exitCode === RUNNER_EXIT_CODES.retryScheduled,
      "retry job did not return retryScheduled exit code",
    );
    assertCondition(
      retry.outcome.status === "retry_scheduled" &&
        retry.outcome.execution.status === "pending",
      "retry job did not become pending",
    );

    if (retry.outcome.status !== "retry_scheduled") {
      throw new Error("retry job did not produce a retry_scheduled outcome");
    }

    const retryDelaySeconds = await getAvailableDelaySeconds(
      migrationPool,
      executionsTable,
      retry.outcome.execution.id,
    );

    assertCondition(
      retryDelaySeconds > 0 && retryDelaySeconds <= 120,
      `retry available_at was not scheduled from database time: ${retryDelaySeconds}`,
    );

    const retryNoOp = await runJobOnce({
      type: `${typePrefix}retry`,
      args: ["--scope", "retry"],
      registry,
      config: getJobRunnerConfig(),
      repository,
      runnerId: "stage41a-check-retry-no-op",
    });

    assertCondition(
      retryNoOp.exitCode === RUNNER_EXIT_CODES.noOp &&
        retryNoOp.outcome.status === "no_op" &&
        retryNoOp.outcome.reason === "not_claimable",
      "retry job was unexpectedly claimed before available_at",
    );

    const failure = await runJobOnce({
      type: `${typePrefix}failure`,
      args: ["--scope", "failure"],
      registry,
      config: getJobRunnerConfig(),
      repository,
      runnerId: "stage41a-check-failure",
    });

    assertCondition(
      failure.exitCode === RUNNER_EXIT_CODES.terminalFailure,
      "terminal failure job did not return terminal failure exit code",
    );

    const failureRerun = await runJobOnce({
      type: `${typePrefix}failure`,
      args: ["--scope", "failure"],
      registry,
      config: getJobRunnerConfig(),
      repository,
      runnerId: "stage41a-check-failure-rerun",
    });

    assertCondition(
      failure.outcome.status === "terminal_failure" &&
        failureRerun.outcome.status === "terminal_failure" &&
        failure.outcome.execution.id !== failureRerun.outcome.execution.id,
      "terminal execution did not allow a new run for the same scope",
    );

    const exception = await runJobOnce({
      type: `${typePrefix}exception`,
      args: ["--scope", "exception"],
      registry,
      config: getJobRunnerConfig(),
      repository,
      runnerId: "stage41a-check-exception",
    });

    assertCondition(
      exception.outcome.status === "terminal_failure" &&
        exception.outcome.execution.lastErrorCode === "handler_unexpected_error",
      "unexpected handler exception was not marked as terminal failure",
    );

    const duplicateActive = await repository.createOrGetActiveExecution({
      type: `${typePrefix}success`,
      idempotencyKey: "scope:duplicate-active",
      payload: { scope: "duplicate-active" },
      maxAttempts: 3,
    });
    const claimedDuplicate = await repository.claimExecution(
      duplicateActive.id,
      "stage41a-check-active-owner",
      60,
    );

    assertCondition(!!claimedDuplicate, "active duplicate setup was not claimed");

    const duplicate = await runJobOnce({
      type: `${typePrefix}success`,
      args: ["--scope", "duplicate-active"],
      registry,
      config: getJobRunnerConfig(),
      repository,
      runnerId: "stage41a-check-duplicate",
    });

    assertCondition(
      duplicate.exitCode === RUNNER_EXIT_CODES.noOp &&
        duplicate.outcome.status === "no_op" &&
        duplicate.outcome.reason === "duplicate_active",
      "active duplicate did not return no-op",
    );

    const staleRecoverId = `stage41a-stale-recover-${crypto.randomUUID()}`;
    await insertStaleExecution(migrationPool, executionsTable, {
      id: staleRecoverId,
      type: `${typePrefix}success`,
      idempotencyKey: "scope:stale-recover",
      attemptCount: 1,
      maxAttempts: 3,
    });

    const staleRecovered = await runJobOnce({
      type: `${typePrefix}success`,
      args: ["--scope", "stale-recover"],
      registry,
      config: getJobRunnerConfig(),
      repository,
      runnerId: "stage41a-check-stale-recover",
    });
    const staleRecoverState = await getExecutionState(
      migrationPool,
      executionsTable,
      staleRecoverId,
    );

    assertCondition(
      staleRecovered.exitCode === RUNNER_EXIT_CODES.success &&
        staleRecoverState.status === "succeeded" &&
        staleRecoverState.attempt_count === 2,
      "recoverable stale execution was not reclaimed and finalized",
    );

    const staleExhaustedId = `stage41a-stale-exhausted-${crypto.randomUUID()}`;
    await insertStaleExecution(migrationPool, executionsTable, {
      id: staleExhaustedId,
      type: `${typePrefix}success`,
      idempotencyKey: "scope:stale-exhausted",
      attemptCount: 3,
      maxAttempts: 3,
    });

    const afterExhaustedStale = await runJobOnce({
      type: `${typePrefix}success`,
      args: ["--scope", "stale-exhausted"],
      registry,
      config: getJobRunnerConfig(),
      repository,
      runnerId: "stage41a-check-stale-exhausted",
    });
    const staleExhaustedState = await getExecutionState(
      migrationPool,
      executionsTable,
      staleExhaustedId,
    );

    assertCondition(
      afterExhaustedStale.exitCode === RUNNER_EXIT_CODES.success &&
        staleExhaustedState.status === "failed" &&
        staleExhaustedState.last_error_code === "lease_expired",
      "exhausted stale execution was not fenced as lease_expired before new run",
    );

    assertCondition(
      (await countRows(
        migrationPool,
        executionsTable,
        "type like $1 and idempotency_key = $2 and status = 'succeeded'",
        [`${typePrefix}%`, "scope:stale-exhausted"],
      )) === 1,
      "new execution after exhausted stale row did not succeed",
    );

    const leaseLoss = await runJobOnce({
      type: `${typePrefix}lease-loss`,
      args: ["--scope", "lease-loss"],
      registry,
      config: getJobRunnerConfig(),
      repository,
      runnerId: "stage41a-check-lease-loss",
    });

    assertCondition(
      leaseLoss.exitCode === RUNNER_EXIT_CODES.leaseLost &&
        leaseLoss.outcome.status === "lease_lost",
      "lease/fencing loss did not return the lease lost outcome",
    );

    console.log("Jobs foundation check passed.");
    console.log("jobs_create_claim_finalize=true");
    console.log("jobs_duplicate_concurrent_create=true");
    console.log("jobs_terminal_scope_rerun=true");
    console.log("jobs_competing_claims_single_owner=true");
    console.log("jobs_claim_version_attempt_count=true");
    console.log("jobs_retry_schedules_pending_without_auto_rerun=true");
    console.log("jobs_retry_available_at_db_time=true");
    console.log("jobs_duplicate_active_no_op=true");
    console.log("jobs_stale_recovery=true");
    console.log("jobs_exhausted_stale_marked_failed=true");
    console.log("jobs_heartbeat_fencing=true");
  } finally {
    const deletedRows = await deleteCheckRows(migrationPool, executionsTable, typePrefix);

    await repository.close();
    await migrationPool.end();

    console.log(`jobs_check_cleanup_rows=${deletedRows}`);
  }
}

main().catch((error: unknown) => {
  if (error instanceof Error) {
    console.error(error.stack ?? error.message);
  } else {
    console.error(error);
  }

  process.exitCode = 1;
});
