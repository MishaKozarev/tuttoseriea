CREATE SCHEMA "jobs";
--> statement-breakpoint
CREATE TABLE "jobs"."executions" (
	"id" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"status" text NOT NULL,
	"payload" jsonb NOT NULL,
	"available_at" timestamp DEFAULT now() NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer NOT NULL,
	"claimed_by" text,
	"claim_version" integer DEFAULT 0 NOT NULL,
	"lease_expires_at" timestamp,
	"started_at" timestamp,
	"finished_at" timestamp,
	"last_error_code" text,
	"last_error_message" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "executions_status_check" CHECK ("jobs"."executions"."status" in ('pending', 'running', 'succeeded', 'failed')),
	CONSTRAINT "executions_attempt_count_check" CHECK ("jobs"."executions"."attempt_count" >= 0),
	CONSTRAINT "executions_max_attempts_check" CHECK ("jobs"."executions"."max_attempts" > 0),
	CONSTRAINT "executions_claim_version_check" CHECK ("jobs"."executions"."claim_version" >= 0),
	CONSTRAINT "executions_owner_lease_consistency_check" CHECK ((
        ("jobs"."executions"."status" = 'running' and "jobs"."executions"."claimed_by" is not null and "jobs"."executions"."lease_expires_at" is not null)
        or
        ("jobs"."executions"."status" <> 'running' and "jobs"."executions"."claimed_by" is null and "jobs"."executions"."lease_expires_at" is null)
      ))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "executions_active_scope_unique" ON "jobs"."executions" USING btree ("type","idempotency_key") WHERE "jobs"."executions"."status" in ('pending', 'running');--> statement-breakpoint
CREATE INDEX "executions_claimable_pending_idx" ON "jobs"."executions" USING btree ("available_at") WHERE "jobs"."executions"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "executions_stale_running_idx" ON "jobs"."executions" USING btree ("lease_expires_at") WHERE "jobs"."executions"."status" = 'running';