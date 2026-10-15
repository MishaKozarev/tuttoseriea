import { randomUUID } from "node:crypto";

import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  jsonb,
  pgSchema,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { identityAccounts } from "./identity";
import { footballMatches } from "./football";

export const jobsSchema = pgSchema("jobs");

export const jobExecutions = jobsSchema.table(
  "executions",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    type: text("type").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    status: text("status").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    availableAt: timestamp("available_at", { mode: "date" }).defaultNow().notNull(),
    attemptCount: integer("attempt_count").default(0).notNull(),
    maxAttempts: integer("max_attempts").notNull(),
    claimedBy: text("claimed_by"),
    claimVersion: integer("claim_version").default(0).notNull(),
    leaseExpiresAt: timestamp("lease_expires_at", { mode: "date" }),
    startedAt: timestamp("started_at", { mode: "date" }),
    finishedAt: timestamp("finished_at", { mode: "date" }),
    lastErrorCode: text("last_error_code"),
    lastErrorMessage: text("last_error_message"),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
  },
  (table) => ({
    activeScopeUnique: uniqueIndex("executions_active_scope_unique")
      .on(table.type, table.idempotencyKey)
      .where(sql`${table.status} in ('pending', 'running')`),
    claimablePendingIndex: index("executions_claimable_pending_idx")
      .on(table.availableAt)
      .where(sql`${table.status} = 'pending'`),
    staleRunningIndex: index("executions_stale_running_idx")
      .on(table.leaseExpiresAt)
      .where(sql`${table.status} = 'running'`),
    statusCheck: check(
      "executions_status_check",
      sql`${table.status} in ('pending', 'running', 'succeeded', 'failed')`,
    ),
    attemptCountCheck: check(
      "executions_attempt_count_check",
      sql`${table.attemptCount} >= 0`,
    ),
    maxAttemptsCheck: check("executions_max_attempts_check", sql`${table.maxAttempts} > 0`),
    claimVersionCheck: check(
      "executions_claim_version_check",
      sql`${table.claimVersion} >= 0`,
    ),
    ownerLeaseConsistencyCheck: check(
      "executions_owner_lease_consistency_check",
      sql`(
        (${table.status} = 'running' and ${table.claimedBy} is not null and ${table.leaseExpiresAt} is not null)
        or
        (${table.status} <> 'running' and ${table.claimedBy} is null and ${table.leaseExpiresAt} is null)
      )`,
    ),
  }),
);

// Immutable request attribution; execution state belongs exclusively to executions.
export const jobAdminRequests = jobsSchema.table("admin_requests", {
  id: text("id").primaryKey().$defaultFn(() => randomUUID()),
  actorAccountId: text("actor_account_id").notNull().references(() => identityAccounts.id, { onDelete: "restrict" }),
  requestKey: text("request_key").notNull(),
  jobType: text("job_type").notNull(),
  idempotencyKey: text("idempotency_key").notNull(),
  matchId: text("match_id").references(() => footballMatches.id, { onDelete: "restrict" }),
  executionId: text("execution_id").notNull().references(() => jobExecutions.id, { onDelete: "restrict" }),
  correlationId: text("correlation_id").notNull(),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
}, (table) => ({
  requestUnique: uniqueIndex("admin_requests_actor_request_unique").on(table.actorAccountId, table.requestKey),
  executionIndex: index("admin_requests_execution_idx").on(table.executionId),
  historyIndex: index("admin_requests_created_idx").on(table.createdAt, table.id),
  scopeCheck: check("admin_requests_scope_check", sql`(
    (${table.jobType} in ('football.sync-serie-a-foundation', 'football.sync-serie-a-matches',
      'football.sync-serie-a-standings', 'football.sync-serie-a-squads', 'football.sync-serie-a-player-statistics')
      and ${table.matchId} is null)
    or (${table.jobType} in ('football.sync-serie-a-match-events', 'football.sync-serie-a-match-lineups',
      'football.sync-serie-a-match-statistics') and ${table.matchId} is not null)
  )`),
}));
