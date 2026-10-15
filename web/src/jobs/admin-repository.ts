import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";

import { getCurrentSerieAMatchEventContext } from "../football/match-events-repository";
import { quoteIdentifier, type JobRunnerConfig } from "./config";
import {
  ADMIN_JOB_COOLDOWN_SECONDS, ADMIN_JOB_HISTORY_LIMIT, ADMIN_JOB_TYPES,
  AdminJobRequestError, adminJobArguments, type AdminJobCommand, type AdminJobScope,
} from "./admin-contract";
import { getJobDefinition, productionJobRegistry } from "./registry";
import { JobRepository } from "./repository";
import { JobLeaseLostError, type JobExecutionStatus } from "./types";

const LOCK_NAMESPACE = 910_230_201;
const ADMISSION_LOCK = 230_000_009;
const CONSUMER_LOCK = 230_000_010;

type RequestRow = {
  id: string; actor_account_id: string; request_key: string; job_type: AdminJobScope["jobType"];
  idempotency_key: string; match_id: string | null; execution_id: string;
  correlation_id: string; created_at: Date;
};
type ViewRow = RequestRow & {
  status: JobExecutionStatus; attempt_count: number; max_attempts: number; available_at: Date;
  started_at: Date | null; finished_at: Date | null; updated_at: Date; last_error_code: string | null;
};
export type AdminJobView = ReturnType<typeof mapView>;
function mapView(row: ViewRow) {
  return {
    id: row.id, actorAccountId: row.actor_account_id, requestKey: row.request_key,
    jobType: row.job_type, idempotencyKey: row.idempotency_key, matchId: row.match_id,
    correlationId: row.correlation_id, createdAt: row.created_at,
    execution: {
      id: row.execution_id, status: row.status, attemptCount: row.attempt_count,
      maxAttempts: row.max_attempts, availableAt: row.available_at, startedAt: row.started_at,
      finishedAt: row.finished_at, updatedAt: row.updated_at, lastErrorCode: row.last_error_code,
    },
  };
}
export type AdminConsumerLock = { assertHeld: () => Promise<void>; release: () => Promise<void> };

export class AdminJobRepository {
  readonly jobs: JobRepository;
  private readonly pool: Pool;
  private readonly requests: string;
  private readonly executions: string;
  constructor(config: Pick<JobRunnerConfig, "databaseUrl" | "jobsSchema">) {
    this.pool = new Pool({ connectionString: config.databaseUrl, max: 3 });
    this.jobs = new JobRepository(config);
    const schema = quoteIdentifier(config.jobsSchema);
    this.requests = `${schema}.admin_requests`;
    this.executions = `${schema}.executions`;
  }
  async close(): Promise<void> {
    await Promise.all([this.jobs.close(), this.pool.end()]);
  }

  async assertCurrentScope(scope: AdminJobScope, client: Pick<PoolClient, "query"> = this.pool): Promise<void> {
    if (scope.matchId !== null && !await getCurrentSerieAMatchEventContext(client, scope.matchId)) {
      throw new AdminJobRequestError("MATCH_OUTSIDE_CURRENT_SERIE_A", 400, "Match is outside current Serie A scope");
    }
  }

  async admit(actorAccountId: string, command: AdminJobCommand, correlationId: string, maxAttempts: number) {
    return this.jobs.withTransaction(async (client) => {
      // Serialize the complete read/validate/create association, including different scopes/actors.
      await client.query("select pg_advisory_xact_lock($1, $2)", [LOCK_NAMESPACE, ADMISSION_LOCK]);
      const replay = await client.query<RequestRow>(
        `select * from ${this.requests} where actor_account_id = $1 and request_key = $2`,
        [actorAccountId, command.requestKey],
      );
      const prior = replay.rows[0];
      if (prior) {
        if (prior.job_type !== command.jobType || prior.idempotency_key !== command.idempotencyKey ||
            prior.match_id !== command.matchId) {
          throw new AdminJobRequestError("IDEMPOTENCY_CONFLICT", 409, "Request key already belongs to another scope");
        }
        return { requestId: prior.id, executionId: prior.execution_id, deduplicated: true };
      }
      await this.assertCurrentScope(command, client);
      const active = await client.query(
        `select 1 from ${this.executions} e where e.status in ('pending', 'running')
         and exists (select 1 from ${this.requests} r where r.execution_id = e.id) limit 1`,
      );
      if (active.rowCount) {
        throw new AdminJobRequestError("ADMIN_JOB_BUSY", 409, "An Admin job is already pending or running");
      }
      const recent = await client.query(
        `select 1 from ${this.executions} e where e.type = $1 and e.idempotency_key = $2
         and e.status in ('succeeded', 'failed') and e.finished_at > now() - ($3::int * interval '1 second')
         and exists (select 1 from ${this.requests} r where r.execution_id = e.id) limit 1`,
        [command.jobType, command.idempotencyKey, ADMIN_JOB_COOLDOWN_SECONDS],
      );
      if (recent.rowCount) {
        throw new AdminJobRequestError("ADMIN_JOB_COOLDOWN", 429, "Canonical scope is within the Admin cooldown");
      }
      const parsed = getJobDefinition(productionJobRegistry, command.jobType).parseArguments(adminJobArguments(command));
      if (parsed.idempotencyKey !== command.idempotencyKey) throw new Error("Invalid canonical Admin scope");
      const execution = await this.jobs.createOrGetActiveExecution({
        type: command.jobType, ...parsed, maxAttempts, recoverExpired: false,
      }, client);
      // create-or-get keeps the row locked through attribution commit. A running
      // non-Admin handler cannot acquire our gate retroactively.
      if (execution.status === "running") {
        throw new AdminJobRequestError("FOOTBALL_JOB_ALREADY_RUNNING", 409, "Canonical job is already running outside Admin");
      }
      const requestId = randomUUID();
      await client.query(
        `insert into ${this.requests}
          (id, actor_account_id, request_key, job_type, idempotency_key, match_id, execution_id, correlation_id)
         values ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [requestId, actorAccountId, command.requestKey, command.jobType, command.idempotencyKey,
          command.matchId, execution.id, correlationId],
      );
      return { requestId, executionId: execution.id, deduplicated: false };
    });
  }

  async history(limit = 20): Promise<AdminJobView[]> {
    if (!Number.isInteger(limit) || limit < 1 || limit > ADMIN_JOB_HISTORY_LIMIT) {
      throw new AdminJobRequestError("VALIDATION_ERROR", 400, "History limit must be between 1 and 50");
    }
    const result = await this.pool.query<ViewRow>(`${this.viewSql()} order by r.created_at desc, r.id desc limit $1`, [limit]);
    return result.rows.map(mapView);
  }
  async get(requestId: string): Promise<AdminJobView | null> {
    const result = await this.pool.query<ViewRow>(`${this.viewSql()} where r.id = $1`, [requestId]);
    return result.rows[0] ? mapView(result.rows[0]) : null;
  }
  private viewSql() {
    return `select r.id, r.actor_account_id, r.request_key, r.job_type, r.idempotency_key,
      r.match_id, r.execution_id, r.correlation_id, r.created_at at time zone 'UTC' as created_at,
      e.status, e.attempt_count, e.max_attempts,
      e.available_at at time zone 'UTC' as available_at,
      e.started_at at time zone 'UTC' as started_at,
      e.finished_at at time zone 'UTC' as finished_at,
      e.updated_at at time zone 'UTC' as updated_at, e.last_error_code
      from ${this.requests} r join ${this.executions} e on e.id = r.execution_id`;
  }

  async nextDue(): Promise<(AdminJobScope & { executionId: string; requestId: string }) | null> {
    const result = await this.pool.query<RequestRow>(
      `select r.* from ${this.requests} r join ${this.executions} e on e.id = r.execution_id
       where r.job_type = any($1::text[]) and e.type = r.job_type and e.idempotency_key = r.idempotency_key
         and ((e.status = 'pending' and e.available_at <= now())
           or (e.status = 'running' and e.lease_expires_at < now()))
       order by e.available_at, r.created_at, r.id limit 1`, [[...ADMIN_JOB_TYPES]],
    );
    const row = result.rows[0];
    return row ? { jobType: row.job_type, matchId: row.match_id, idempotencyKey: row.idempotency_key,
      executionId: row.execution_id, requestId: row.id } : null;
  }

  async tryAcquireConsumerLock(): Promise<AdminConsumerLock | null> {
    const client = await this.pool.connect();
    let lost = false;
    const onError = () => { lost = true; };
    client.on("error", onError);
    try {
      const result = await client.query<{ locked: boolean }>("select pg_try_advisory_lock($1,$2) as locked", [LOCK_NAMESPACE, CONSUMER_LOCK]);
      if (!result.rows[0]?.locked) {
        client.removeListener("error", onError);
        client.release();
        return null;
      }
      return {
        assertHeld: async () => {
          if (lost) throw new JobLeaseLostError("Admin consumer lock connection lost");
          try { await client.query("select 1"); } catch {
            lost = true;
            throw new JobLeaseLostError("Admin consumer lock connection lost");
          }
        },
        release: async () => {
          try {
            if (!lost) await client.query("select pg_advisory_unlock($1,$2)", [LOCK_NAMESPACE, CONSUMER_LOCK]);
          } finally {
            client.removeListener("error", onError);
            client.release(lost);
          }
        },
      };
    } catch (error) {
      client.removeListener("error", onError);
      client.release(true);
      throw error;
    }
  }
}
