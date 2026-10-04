CREATE TABLE "football"."match_lineup_entries" (
	"id" text PRIMARY KEY NOT NULL,
	"lineup_id" text NOT NULL,
	"role" text NOT NULL,
	"provider_player_id" integer,
	"provider_player_name" text,
	"player_id" text,
	"shirt_number" integer,
	"provider_position" text,
	"grid" text,
	"provider_order" integer NOT NULL,
	"provider_raw" jsonb NOT NULL,
	CONSTRAINT "match_lineup_entries_role_check" CHECK ("football"."match_lineup_entries"."role" in ('starter', 'substitute')),
	CONSTRAINT "match_lineup_entries_provider_order_nonnegative_check" CHECK ("football"."match_lineup_entries"."provider_order" >= 0),
	CONSTRAINT "match_lineup_entries_provider_player_id_positive_check" CHECK ("football"."match_lineup_entries"."provider_player_id" is null or "football"."match_lineup_entries"."provider_player_id" > 0),
	CONSTRAINT "match_lineup_entries_provider_player_name_check" CHECK ("football"."match_lineup_entries"."provider_player_name" is null or btrim("football"."match_lineup_entries"."provider_player_name") <> ''),
	CONSTRAINT "match_lineup_entries_provider_player_identity_check" CHECK ("football"."match_lineup_entries"."provider_player_id" is not null or "football"."match_lineup_entries"."provider_player_name" is not null)
);
--> statement-breakpoint
CREATE TABLE "football"."match_lineups" (
	"id" text PRIMARY KEY NOT NULL,
	"match_id" text NOT NULL,
	"club_id" text NOT NULL,
	"formation" text,
	"provider_coach_id" integer,
	"provider_coach_name" text,
	"provider_coach_photo_url" text,
	"provider_colors" jsonb,
	"provider_raw" jsonb NOT NULL,
	"observed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "match_lineups_provider_coach_id_positive_check" CHECK ("football"."match_lineups"."provider_coach_id" is null or "football"."match_lineups"."provider_coach_id" > 0)
);
--> statement-breakpoint
ALTER TABLE "football"."match_lineup_entries" ADD CONSTRAINT "match_lineup_entries_lineup_id_match_lineups_id_fk" FOREIGN KEY ("lineup_id") REFERENCES "football"."match_lineups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "football"."match_lineup_entries" ADD CONSTRAINT "match_lineup_entries_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "football"."players"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "football"."match_lineups" ADD CONSTRAINT "match_lineups_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "football"."matches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "football"."match_lineups" ADD CONSTRAINT "match_lineups_club_id_clubs_id_fk" FOREIGN KEY ("club_id") REFERENCES "football"."clubs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "match_lineup_entries_role_order_unique" ON "football"."match_lineup_entries" USING btree ("lineup_id","role","provider_order");--> statement-breakpoint
CREATE UNIQUE INDEX "match_lineup_entries_provider_player_unique" ON "football"."match_lineup_entries" USING btree ("lineup_id","provider_player_id") WHERE "football"."match_lineup_entries"."provider_player_id" is not null;--> statement-breakpoint
CREATE INDEX "match_lineup_entries_player_id_idx" ON "football"."match_lineup_entries" USING btree ("player_id");--> statement-breakpoint
CREATE UNIQUE INDEX "match_lineups_match_club_unique" ON "football"."match_lineups" USING btree ("match_id","club_id");--> statement-breakpoint
CREATE INDEX "match_lineups_club_id_idx" ON "football"."match_lineups" USING btree ("club_id");