CREATE TABLE "football"."players" (
	"id" text PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"provider_player_id" integer NOT NULL,
	"provider_name" text NOT NULL,
	"age" integer,
	"provider_photo_url" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "players_age_positive_check" CHECK ("football"."players"."age" is null or "football"."players"."age" > 0)
);
--> statement-breakpoint
CREATE TABLE "football"."squad_memberships" (
	"id" text PRIMARY KEY NOT NULL,
	"club_id" text NOT NULL,
	"player_id" text NOT NULL,
	"shirt_number" integer,
	"position" text NOT NULL,
	"provider_raw" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "squad_memberships_shirt_number_nonnegative_check" CHECK ("football"."squad_memberships"."shirt_number" is null or "football"."squad_memberships"."shirt_number" >= 0)
);
--> statement-breakpoint
ALTER TABLE "football"."squad_memberships" ADD CONSTRAINT "squad_memberships_club_id_clubs_id_fk" FOREIGN KEY ("club_id") REFERENCES "football"."clubs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "football"."squad_memberships" ADD CONSTRAINT "squad_memberships_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "football"."players"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "players_provider_player_id_unique" ON "football"."players" USING btree ("provider","provider_player_id");--> statement-breakpoint
CREATE UNIQUE INDEX "squad_memberships_club_player_unique" ON "football"."squad_memberships" USING btree ("club_id","player_id");--> statement-breakpoint
CREATE INDEX "squad_memberships_player_id_idx" ON "football"."squad_memberships" USING btree ("player_id");