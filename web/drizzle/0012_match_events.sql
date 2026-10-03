CREATE TABLE "football"."match_events" (
	"id" text PRIMARY KEY NOT NULL,
	"match_id" text NOT NULL,
	"provider_order" integer NOT NULL,
	"elapsed" integer NOT NULL,
	"extra" integer,
	"club_id" text NOT NULL,
	"provider_player_id" integer,
	"provider_player_name" text,
	"player_id" text,
	"provider_related_player_id" integer,
	"provider_related_player_name" text,
	"related_player_id" text,
	"provider_type" text NOT NULL,
	"provider_detail" text NOT NULL,
	"comments" text,
	"provider_raw" jsonb NOT NULL,
	CONSTRAINT "match_events_provider_order_nonnegative_check" CHECK ("football"."match_events"."provider_order" >= 0),
	CONSTRAINT "match_events_elapsed_nonnegative_check" CHECK ("football"."match_events"."elapsed" >= 0),
	CONSTRAINT "match_events_extra_nonnegative_check" CHECK ("football"."match_events"."extra" is null or "football"."match_events"."extra" >= 0),
	CONSTRAINT "match_events_provider_player_id_positive_check" CHECK ("football"."match_events"."provider_player_id" is null or "football"."match_events"."provider_player_id" > 0),
	CONSTRAINT "match_events_provider_related_player_id_positive_check" CHECK ("football"."match_events"."provider_related_player_id" is null or "football"."match_events"."provider_related_player_id" > 0)
);
--> statement-breakpoint
ALTER TABLE "football"."match_events" ADD CONSTRAINT "match_events_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "football"."matches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "football"."match_events" ADD CONSTRAINT "match_events_club_id_clubs_id_fk" FOREIGN KEY ("club_id") REFERENCES "football"."clubs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "football"."match_events" ADD CONSTRAINT "match_events_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "football"."players"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "football"."match_events" ADD CONSTRAINT "match_events_related_player_id_players_id_fk" FOREIGN KEY ("related_player_id") REFERENCES "football"."players"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "match_events_match_order_unique" ON "football"."match_events" USING btree ("match_id","provider_order");--> statement-breakpoint
CREATE INDEX "match_events_club_id_idx" ON "football"."match_events" USING btree ("club_id");--> statement-breakpoint
CREATE INDEX "match_events_player_id_idx" ON "football"."match_events" USING btree ("player_id");--> statement-breakpoint
CREATE INDEX "match_events_related_player_id_idx" ON "football"."match_events" USING btree ("related_player_id");