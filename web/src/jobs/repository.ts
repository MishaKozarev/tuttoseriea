import { randomUUID } from "node:crypto";

import { Pool, type PoolClient, type QueryResult } from "pg";

import { quoteIdentifier, type JobRunnerConfig } from "./config";
import type {
  ClaimedJobExecution,
  JobExecution,
  JobExecutionStatus,
  JsonObject,
} from "./types";

type JobExecutionRow = {
  id: string;
  type: string;
  idempotency_key: string;
  status: JobExecutionStatus;
  payload: unknown;
  available_at: Date;
  attempt_count: number;
  max_attempts: number;
  claimed_by: string | null;
  claim_version: number;
  lease_expires_at: Date | null;
  started_at: Date | null;
  finished_at: Date | null;
  last_error_code: string | null;
  last_error_message: string | null;
  created_at: Date;
  updated_at: Date;
};

type ExecutionScope = {
  type: string;
  idempotencyKey: string;
};

type LeaseIdentity = {
  id: string;
  runnerId: string;
  claimVersion: number;
};

type ErrorInfo = {
  code: string;
  message: string;
};

type CreateExecutionInput = ExecutionScope & {
  payload: JsonObject;
  maxAttempts: number;
};

type RetryInput = LeaseIdentity &
  ErrorInfo & {
    delaySeconds: number;
  };

function asJsonObject(value: unknown): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return value as JsonObject;
}

function mapExecution(row: JobExecutionRow): JobExecution {
  return {
    id: row.id,
    type: row.type,
    idempotencyKey: row.idempotency_key,
    status: row.status,
    payload: asJsonObject(row.payload),
    availableAt: row.available_at,
    attemptCount: row.attempt_count,
    maxAttempts: row.max_attempts,
    claimedBy: row.claimed_by,
    claimVersion: row.claim_version,
    leaseExpiresAt: row.lease_expires_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    lastErrorCode: row.last_error_code,
    lastErrorMessage: row.last_error_message,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function firstExecution(result: QueryResult<JobExecutionRow>): JobExecution | null {
  const row = result.rows[0];

  return row ? mapExecution(row) : null;
}

function toClaimedExecution(execution: JobExecution): ClaimedJobExecution {
  if (
    execution.status !== "running" ||
    !execution.claimedBy ||
    !execution.leaseExpiresAt
  ) {
    throw new Error(`Execution ${execution.id} is not claimed`);
  }

  return execution as ClaimedJobExecution;
}

export class JobRepository {
  private readonly pool: Pool;
  private readonly executionsTable: string;

  constructor(config: Pick<JobRunnerConfig, "databaseUrl" | "jobsSchema">) {
    this.pool = new Pool({
      connectionString: config.databaseUrl,
      max: 5,
    });
    this.executionsTable = `${quoteIdentifier(config.jobsSchema)}.${quoteIdentifier("executions")}`;
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  async withTransaction<T>(operation: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    let transactionStarted = false;

    try {
      await client.query("begin");
      transactionStarted = true;

      const result = await operation(client);

      await client.query("commit");
      transactionStarted = false;

      return result;
    } finally {
      try {
        if (transactionStarted) {
          await client.query("rollback");
        }
      } finally {
        client.release();
      }
    }
  }

  async createOrGetActiveExecution(input: CreateExecutionInput): Promise<JobExecution> {
    return this.withTransaction(async (client) => {
      const executionId = randomUUID();

      await client.query(
        `
          update ${this.executionsTable}
          set
            status = 'failed',
            claimed_by = null,
            lease_expires_at = null,
            finished_at = now(),
            last_error_code = 'lease_expired',
            last_error_message = 'Lease expired before the execution completed.',
            updated_at = now()
          where type = $1
            and idempotency_key = $2
            and status = 'running'
            and lease_expires_at < now()
            and attempt_count >= max_attempts
        `,
        [input.type, input.idempotencyKey],
      );

      await client.query(
        `
          update ${this.executionsTable}
          set
            status = 'pending',
            claimed_by = null,
            lease_expires_at = null,
            updated_at = now()
          where type = $1
            and idempotency_key = $2
            and status = 'running'
            and lease_expires_at < now()
            and attempt_count < max_attempts
        `,
        [input.type, input.idempotencyKey],
      );

      const inserted = await client.query<JobExecutionRow>(
        `
          insert into ${this.executionsTable} as current_execution (
            id,
            type,
            idempotency_key,
            status,
            payload,
            max_attempts
          )
          values ($1, $2, $3, 'pending', $4::jsonb, $5)
          on conflict (type, idempotency_key)
            where status in ('pending', 'running')
          do update set updated_at = current_execution.updated_at
          returning *
        `,
        [
          executionId,
          input.type,
          input.idempotencyKey,
          JSON.stringify(input.payload),
          input.maxAttempts,
        ],
      );
      const execution = firstExecution(inserted);

      if (!execution) {
        throw new Error("Failed to create or read job execution");
      }

      return execution;
    });
  }

  async claimExecution(
    id: string,
    runnerId: string,
    leaseSeconds: number,
  ): Promise<ClaimedJobExecution | null> {
    const claimed = await this.pool.query<JobExecutionRow>(
      `
        update ${this.executionsTable}
        set
          status = 'running',
          claimed_by = $2,
          claim_version = claim_version + 1,
          lease_expires_at = now() + ($3::int * interval '1 second'),
          started_at = coalesce(started_at, now()),
          attempt_count = attempt_count + 1,
          updated_at = now()
        where id = $1
          and status = 'pending'
          and available_at <= now()
        returning *
      `,
      [id, runnerId, leaseSeconds],
    );
    const execution = firstExecution(claimed);

    return execution ? toClaimedExecution(execution) : null;
  }

  async heartbeat(
    input: LeaseIdentity,
    leaseSeconds: number,
  ): Promise<ClaimedJobExecution | null> {
    const heartbeat = await this.pool.query<JobExecutionRow>(
      `
        update ${this.executionsTable}
        set
          lease_expires_at = now() + ($4::int * interval '1 second'),
          updated_at = now()
        where id = $1
          and status = 'running'
          and claimed_by = $2
          and claim_version = $3
          and lease_expires_at > now()
        returning *
      `,
      [input.id, input.runnerId, input.claimVersion, leaseSeconds],
    );
    const execution = firstExecution(heartbeat);

    return execution ? toClaimedExecution(execution) : null;
  }

  async finalizeSuccess(input: LeaseIdentity): Promise<JobExecution | null> {
    return firstExecution(
      await this.pool.query<JobExecutionRow>(
        `
          update ${this.executionsTable}
          set
            status = 'succeeded',
            claimed_by = null,
            lease_expires_at = null,
            finished_at = now(),
            last_error_code = null,
            last_error_message = null,
            updated_at = now()
          where id = $1
            and status = 'running'
            and claimed_by = $2
            and claim_version = $3
            and lease_expires_at > now()
          returning *
        `,
        [input.id, input.runnerId, input.claimVersion],
      ),
    );
  }

  async finalizeRetry(input: RetryInput): Promise<JobExecution | null> {
    return firstExecution(
      await this.pool.query<JobExecutionRow>(
        `
          update ${this.executionsTable}
          set
            status = 'pending',
            available_at = now() + ($4::int * interval '1 second'),
            claimed_by = null,
            lease_expires_at = null,
            last_error_code = $5,
            last_error_message = $6,
            updated_at = now()
          where id = $1
            and status = 'running'
            and claimed_by = $2
            and claim_version = $3
            and lease_expires_at > now()
            and attempt_count < max_attempts
          returning *
        `,
        [
          input.id,
          input.runnerId,
          input.claimVersion,
          input.delaySeconds,
          input.code,
          input.message,
        ],
      ),
    );
  }

  async finalizeFailure(input: LeaseIdentity & ErrorInfo): Promise<JobExecution | null> {
    return firstExecution(
      await this.pool.query<JobExecutionRow>(
        `
          update ${this.executionsTable}
          set
            status = 'failed',
            claimed_by = null,
            lease_expires_at = null,
            finished_at = now(),
            last_error_code = $4,
            last_error_message = $5,
            updated_at = now()
          where id = $1
            and status = 'running'
            and claimed_by = $2
            and claim_version = $3
            and lease_expires_at > now()
          returning *
        `,
        [input.id, input.runnerId, input.claimVersion, input.code, input.message],
      ),
    );
  }

  async getExecution(id: string): Promise<JobExecution | null> {
    return firstExecution(
      await this.pool.query<JobExecutionRow>(
        `select * from ${this.executionsTable} where id = $1`,
        [id],
      ),
    );
  }
}
