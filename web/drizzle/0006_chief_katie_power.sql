CREATE TABLE "football"."standings" (
	"id" text PRIMARY KEY NOT NULL,
	"season_id" text NOT NULL,
	"club_id" text NOT NULL,
	"group_name" text,
	"rank" integer NOT NULL,
	"points" integer NOT NULL,
	"goals_diff" integer NOT NULL,
	"form" text,
	"provider_status" text,
	"description" text,
	"played" integer NOT NULL,
	"wins" integer NOT NULL,
	"draws" integer NOT NULL,
	"losses" integer NOT NULL,
	"goals_for" integer NOT NULL,
	"goals_against" integer NOT NULL,
	"home_played" integer NOT NULL,
	"home_wins" integer NOT NULL,
	"home_draws" integer NOT NULL,
	"home_losses" integer NOT NULL,
	"home_goals_for" integer NOT NULL,
	"home_goals_against" integer NOT NULL,
	"away_played" integer NOT NULL,
	"away_wins" integer NOT NULL,
	"away_draws" integer NOT NULL,
	"away_losses" integer NOT NULL,
	"away_goals_for" integer NOT NULL,
	"away_goals_against" integer NOT NULL,
	"provider_raw" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "standings_rank_positive_check" CHECK ("football"."standings"."rank" > 0),
	CONSTRAINT "standings_statistics_nonnegative_check" CHECK ("football"."standings"."played" >= 0
        and "football"."standings"."wins" >= 0
        and "football"."standings"."draws" >= 0
        and "football"."standings"."losses" >= 0
        and "football"."standings"."goals_for" >= 0
        and "football"."standings"."goals_against" >= 0
        and "football"."standings"."home_played" >= 0
        and "football"."standings"."home_wins" >= 0
        and "football"."standings"."home_draws" >= 0
        and "football"."standings"."home_losses" >= 0
        and "football"."standings"."home_goals_for" >= 0
        and "football"."standings"."home_goals_against" >= 0
        and "football"."standings"."away_played" >= 0
        and "football"."standings"."away_wins" >= 0
        and "football"."standings"."away_draws" >= 0
        and "football"."standings"."away_losses" >= 0
        and "football"."standings"."away_goals_for" >= 0
        and "football"."standings"."away_goals_against" >= 0)
);
--> statement-breakpoint
ALTER TABLE "football"."standings" ADD CONSTRAINT "standings_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "football"."seasons"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "football"."standings" ADD CONSTRAINT "standings_season_club_fk" FOREIGN KEY ("season_id","club_id") REFERENCES "football"."season_clubs"("season_id","club_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "standings_season_club_unique" ON "football"."standings" USING btree ("season_id","club_id");--> statement-breakpoint
CREATE UNIQUE INDEX "standings_season_rank_unique" ON "football"."standings" USING btree ("season_id","rank");--> statement-breakpoint
CREATE INDEX "standings_club_id_idx" ON "football"."standings" USING btree ("club_id");