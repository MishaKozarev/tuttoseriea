CREATE SCHEMA "article";
--> statement-breakpoint
CREATE SCHEMA "news";
--> statement-breakpoint
CREATE SCHEMA "taxonomy";
--> statement-breakpoint
CREATE TABLE "article"."categories" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "article_categories_name_check" CHECK (length(btrim("article"."categories"."name")) between 1 and 200 and "article"."categories"."name" = btrim("article"."categories"."name")),
	CONSTRAINT "article_categories_revision_check" CHECK ("article"."categories"."revision" >= 0)
);
--> statement-breakpoint
CREATE TABLE "taxonomy"."football_tags" (
	"id" text PRIMARY KEY NOT NULL,
	"club_id" text,
	"player_id" text,
	"coach_id" text,
	"competition_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "football_tags_one_source_check" CHECK (num_nonnulls("taxonomy"."football_tags"."club_id","taxonomy"."football_tags"."player_id","taxonomy"."football_tags"."coach_id","taxonomy"."football_tags"."competition_id") = 1)
);
--> statement-breakpoint
CREATE TABLE "news"."categories" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "news_categories_name_check" CHECK (length(btrim("news"."categories"."name")) between 1 and 200 and "news"."categories"."name" = btrim("news"."categories"."name")),
	CONSTRAINT "news_categories_revision_check" CHECK ("news"."categories"."revision" >= 0)
);
--> statement-breakpoint
ALTER TABLE "taxonomy"."football_tags" ADD CONSTRAINT "football_tags_club_id_clubs_id_fk" FOREIGN KEY ("club_id") REFERENCES "football"."clubs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "taxonomy"."football_tags" ADD CONSTRAINT "football_tags_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "football"."players"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "taxonomy"."football_tags" ADD CONSTRAINT "football_tags_coach_id_coaches_id_fk" FOREIGN KEY ("coach_id") REFERENCES "football"."coaches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "taxonomy"."football_tags" ADD CONSTRAINT "football_tags_competition_id_competitions_id_fk" FOREIGN KEY ("competition_id") REFERENCES "football"."competitions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "article_categories_name_unique" ON "article"."categories" USING btree (lower(btrim("name")));--> statement-breakpoint
CREATE UNIQUE INDEX "football_tags_club_unique" ON "taxonomy"."football_tags" USING btree ("club_id");--> statement-breakpoint
CREATE UNIQUE INDEX "football_tags_player_unique" ON "taxonomy"."football_tags" USING btree ("player_id");--> statement-breakpoint
CREATE UNIQUE INDEX "football_tags_coach_unique" ON "taxonomy"."football_tags" USING btree ("coach_id");--> statement-breakpoint
CREATE UNIQUE INDEX "football_tags_competition_unique" ON "taxonomy"."football_tags" USING btree ("competition_id");--> statement-breakpoint
CREATE UNIQUE INDEX "news_categories_name_unique" ON "news"."categories" USING btree (lower(btrim("name")));