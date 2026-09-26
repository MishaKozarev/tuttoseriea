CREATE TABLE "football"."matches" (
	"id" text PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"provider_fixture_id" integer NOT NULL,
	"season_id" text NOT NULL,
	"home_club_id" text NOT NULL,
	"away_club_id" text NOT NULL,
	"round" text NOT NULL,
	"kickoff_at" timestamp with time zone,
	"provider_timezone" text,
	"provider_timestamp" integer,
	"first_period_start" integer,
	"second_period_start" integer,
	"referee" text,
	"provider_venue_id" integer,
	"venue_name" text,
	"venue_city" text,
	"status" text NOT NULL,
	"polling_category" text NOT NULL,
	"provider_status_long" text,
	"provider_status_short" text NOT NULL,
	"status_elapsed" integer,
	"status_extra" integer,
	"home_winner" boolean,
	"away_winner" boolean,
	"home_goals" integer,
	"away_goals" integer,
	"halftime_home" integer,
	"halftime_away" integer,
	"fulltime_home" integer,
	"fulltime_away" integer,
	"extratime_home" integer,
	"extratime_away" integer,
	"penalty_home" integer,
	"penalty_away" integer,
	"provider_raw" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "matches_home_away_different_check" CHECK ("football"."matches"."home_club_id" <> "football"."matches"."away_club_id"),
	CONSTRAINT "matches_status_check" CHECK ("football"."matches"."status" in (
        'scheduled',
        'live',
        'paused',
        'suspended',
        'interrupted',
        'postponed',
        'abandoned',
        'finished',
        'cancelled',
        'awarded',
        'walkover'
      )),
	CONSTRAINT "matches_polling_category_check" CHECK ("football"."matches"."polling_category" in ('ACTIVE', 'WATCH', 'TERMINAL'))
);
--> statement-breakpoint
ALTER TABLE "football"."matches" ADD CONSTRAINT "matches_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "football"."seasons"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "football"."matches" ADD CONSTRAINT "matches_home_season_club_fk" FOREIGN KEY ("season_id","home_club_id") REFERENCES "football"."season_clubs"("season_id","club_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "football"."matches" ADD CONSTRAINT "matches_away_season_club_fk" FOREIGN KEY ("season_id","away_club_id") REFERENCES "football"."season_clubs"("season_id","club_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "matches_provider_fixture_id_unique" ON "football"."matches" USING btree ("provider","provider_fixture_id");--> statement-breakpoint
CREATE INDEX "matches_season_kickoff_idx" ON "football"."matches" USING btree ("season_id","kickoff_at");--> statement-breakpoint
CREATE INDEX "matches_status_idx" ON "football"."matches" USING btree ("status");--> statement-breakpoint
CREATE INDEX "matches_home_club_id_idx" ON "football"."matches" USING btree ("home_club_id");--> statement-breakpoint
CREATE INDEX "matches_away_club_id_idx" ON "football"."matches" USING btree ("away_club_id");