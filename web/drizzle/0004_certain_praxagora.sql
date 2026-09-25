CREATE SCHEMA "football";
--> statement-breakpoint
CREATE TABLE "football"."clubs" (
	"id" text PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"provider_club_id" integer NOT NULL,
	"provider_name" text NOT NULL,
	"code" text,
	"country" text,
	"founded" integer,
	"national" boolean,
	"provider_logo_url" text,
	"slug" text NOT NULL,
	"name_ru" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "football"."competitions" (
	"id" text PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"provider_competition_id" integer NOT NULL,
	"provider_name" text NOT NULL,
	"country" text,
	"type" text,
	"provider_logo_url" text,
	"slug" text NOT NULL,
	"name_ru" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "football"."season_clubs" (
	"season_id" text NOT NULL,
	"club_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "season_clubs_season_id_club_id_pk" PRIMARY KEY("season_id","club_id")
);
--> statement-breakpoint
CREATE TABLE "football"."seasons" (
	"id" text PRIMARY KEY NOT NULL,
	"competition_id" text NOT NULL,
	"provider" text NOT NULL,
	"provider_season_year" integer NOT NULL,
	"starts_on" date,
	"ends_on" date,
	"provider_current" boolean NOT NULL,
	"display_label" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "football"."season_clubs" ADD CONSTRAINT "season_clubs_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "football"."seasons"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "football"."season_clubs" ADD CONSTRAINT "season_clubs_club_id_clubs_id_fk" FOREIGN KEY ("club_id") REFERENCES "football"."clubs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "football"."seasons" ADD CONSTRAINT "seasons_competition_id_competitions_id_fk" FOREIGN KEY ("competition_id") REFERENCES "football"."competitions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "clubs_provider_club_id_unique" ON "football"."clubs" USING btree ("provider","provider_club_id");--> statement-breakpoint
CREATE UNIQUE INDEX "clubs_slug_unique" ON "football"."clubs" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "competitions_provider_competition_id_unique" ON "football"."competitions" USING btree ("provider","provider_competition_id");--> statement-breakpoint
CREATE UNIQUE INDEX "competitions_slug_unique" ON "football"."competitions" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "season_clubs_club_id_idx" ON "football"."season_clubs" USING btree ("club_id");--> statement-breakpoint
CREATE UNIQUE INDEX "seasons_competition_provider_year_unique" ON "football"."seasons" USING btree ("competition_id","provider","provider_season_year");--> statement-breakpoint
CREATE INDEX "seasons_competition_id_idx" ON "football"."seasons" USING btree ("competition_id");