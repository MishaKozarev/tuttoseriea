ALTER TABLE "football"."clubs" ADD COLUMN "localization_revision" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "football"."competitions" ADD COLUMN "localization_revision" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "football"."players" ADD COLUMN "localization_revision" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "football"."clubs" ADD CONSTRAINT "clubs_localization_revision_check" CHECK ("football"."clubs"."localization_revision" >= 0);--> statement-breakpoint
ALTER TABLE "football"."competitions" ADD CONSTRAINT "competitions_localization_revision_check" CHECK ("football"."competitions"."localization_revision" >= 0);--> statement-breakpoint
ALTER TABLE "football"."players" ADD CONSTRAINT "players_localization_revision_check" CHECK ("football"."players"."localization_revision" >= 0);