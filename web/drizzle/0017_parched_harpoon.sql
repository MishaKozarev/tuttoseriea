CREATE TABLE "jobs"."admin_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"actor_account_id" text NOT NULL,
	"request_key" text NOT NULL,
	"job_type" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"match_id" text,
	"execution_id" text NOT NULL,
	"correlation_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "admin_requests_scope_check" CHECK ((
    ("jobs"."admin_requests"."job_type" in ('football.sync-serie-a-foundation', 'football.sync-serie-a-matches',
      'football.sync-serie-a-standings', 'football.sync-serie-a-squads', 'football.sync-serie-a-player-statistics')
      and "jobs"."admin_requests"."match_id" is null)
    or ("jobs"."admin_requests"."job_type" in ('football.sync-serie-a-match-events', 'football.sync-serie-a-match-lineups',
      'football.sync-serie-a-match-statistics') and "jobs"."admin_requests"."match_id" is not null)
  ))
);
--> statement-breakpoint
ALTER TABLE "jobs"."admin_requests" ADD CONSTRAINT "admin_requests_actor_account_id_accounts_id_fk" FOREIGN KEY ("actor_account_id") REFERENCES "identity"."accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs"."admin_requests" ADD CONSTRAINT "admin_requests_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "football"."matches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs"."admin_requests" ADD CONSTRAINT "admin_requests_execution_id_executions_id_fk" FOREIGN KEY ("execution_id") REFERENCES "jobs"."executions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "admin_requests_actor_request_unique" ON "jobs"."admin_requests" USING btree ("actor_account_id","request_key");--> statement-breakpoint
CREATE INDEX "admin_requests_execution_idx" ON "jobs"."admin_requests" USING btree ("execution_id");--> statement-breakpoint
CREATE INDEX "admin_requests_created_idx" ON "jobs"."admin_requests" USING btree ("created_at","id");