CREATE TABLE "football"."match_statistic_items" (
	"id" text PRIMARY KEY NOT NULL,
	"match_statistics_id" text NOT NULL,
	"provider_type" text NOT NULL,
	"provider_value" jsonb NOT NULL,
	"provider_order" integer NOT NULL,
	"provider_raw" jsonb NOT NULL,
	CONSTRAINT "match_statistic_items_provider_type_nonblank_check" CHECK (btrim("football"."match_statistic_items"."provider_type") <> ''),
	CONSTRAINT "match_statistic_items_provider_value_type_check" CHECK (jsonb_typeof("football"."match_statistic_items"."provider_value") in ('number', 'string', 'null')),
	CONSTRAINT "match_statistic_items_provider_order_nonnegative_check" CHECK ("football"."match_statistic_items"."provider_order" >= 0)
);
--> statement-breakpoint
CREATE TABLE "football"."match_statistics" (
	"id" text PRIMARY KEY NOT NULL,
	"match_id" text NOT NULL,
	"club_id" text NOT NULL,
	"scope" text NOT NULL,
	"provider_raw" jsonb NOT NULL,
	"observed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "match_statistics_scope_check" CHECK ("football"."match_statistics"."scope" = 'full_match')
);
--> statement-breakpoint
ALTER TABLE "football"."match_statistic_items" ADD CONSTRAINT "match_statistic_items_match_statistics_id_match_statistics_id_fk" FOREIGN KEY ("match_statistics_id") REFERENCES "football"."match_statistics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "football"."match_statistics" ADD CONSTRAINT "match_statistics_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "football"."matches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "football"."match_statistics" ADD CONSTRAINT "match_statistics_club_id_clubs_id_fk" FOREIGN KEY ("club_id") REFERENCES "football"."clubs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "match_statistic_items_snapshot_order_unique" ON "football"."match_statistic_items" USING btree ("match_statistics_id","provider_order");--> statement-breakpoint
CREATE UNIQUE INDEX "match_statistics_match_club_scope_unique" ON "football"."match_statistics" USING btree ("match_id","club_id","scope");--> statement-breakpoint
CREATE INDEX "match_statistics_club_id_idx" ON "football"."match_statistics" USING btree ("club_id");