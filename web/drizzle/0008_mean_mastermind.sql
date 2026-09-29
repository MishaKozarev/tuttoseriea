CREATE TABLE "football"."player_statistics" (
	"id" text PRIMARY KEY NOT NULL,
	"season_id" text NOT NULL,
	"club_id" text NOT NULL,
	"player_id" text NOT NULL,
	"appearances" integer,
	"lineups" integer,
	"minutes" integer,
	"shirt_number" integer,
	"position" text,
	"rating" text,
	"captain" boolean,
	"substitutes_in" integer,
	"substitutes_out" integer,
	"substitutes_bench" integer,
	"shots_total" integer,
	"shots_on" integer,
	"goals_total" integer,
	"goals_conceded" integer,
	"goals_assists" integer,
	"passes_total" integer,
	"passes_key" integer,
	"passes_accuracy" integer,
	"tackles_total" integer,
	"tackles_blocks" integer,
	"tackles_interceptions" integer,
	"duels_total" integer,
	"duels_won" integer,
	"dribbles_attempts" integer,
	"dribbles_success" integer,
	"fouls_drawn" integer,
	"fouls_committed" integer,
	"cards_yellow" integer,
	"cards_yellow_red" integer,
	"cards_red" integer,
	"penalty_committed" integer,
	"penalty_scored" integer,
	"penalty_missed" integer,
	"player_raw" jsonb NOT NULL,
	"statistics_raw" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "football"."players" ADD COLUMN "firstname" text;--> statement-breakpoint
ALTER TABLE "football"."players" ADD COLUMN "lastname" text;--> statement-breakpoint
ALTER TABLE "football"."players" ADD COLUMN "birth_date" date;--> statement-breakpoint
ALTER TABLE "football"."players" ADD COLUMN "birth_place" text;--> statement-breakpoint
ALTER TABLE "football"."players" ADD COLUMN "birth_country" text;--> statement-breakpoint
ALTER TABLE "football"."players" ADD COLUMN "nationality" text;--> statement-breakpoint
ALTER TABLE "football"."players" ADD COLUMN "height" text;--> statement-breakpoint
ALTER TABLE "football"."players" ADD COLUMN "weight" text;--> statement-breakpoint
ALTER TABLE "football"."players" ADD COLUMN "injured" boolean;--> statement-breakpoint
ALTER TABLE "football"."player_statistics" ADD CONSTRAINT "player_statistics_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "football"."players"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "football"."player_statistics" ADD CONSTRAINT "player_statistics_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "football"."seasons"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "football"."player_statistics" ADD CONSTRAINT "player_statistics_season_club_fk" FOREIGN KEY ("season_id","club_id") REFERENCES "football"."season_clubs"("season_id","club_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "player_statistics_season_club_player_unique" ON "football"."player_statistics" USING btree ("season_id","club_id","player_id");--> statement-breakpoint
CREATE INDEX "player_statistics_player_id_idx" ON "football"."player_statistics" USING btree ("player_id");--> statement-breakpoint
CREATE INDEX "player_statistics_club_id_idx" ON "football"."player_statistics" USING btree ("club_id");