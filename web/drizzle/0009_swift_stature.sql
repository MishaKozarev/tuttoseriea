ALTER TABLE "football"."competitions" ALTER COLUMN "name_ru" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "football"."clubs" ADD COLUMN "name_ru_review_status" text;--> statement-breakpoint
ALTER TABLE "football"."competitions" ADD COLUMN "name_ru_review_status" text;--> statement-breakpoint
ALTER TABLE "football"."players" ADD COLUMN "name_ru" text;--> statement-breakpoint
ALTER TABLE "football"."players" ADD COLUMN "name_ru_review_status" text;--> statement-breakpoint
UPDATE "football"."competitions"
SET "name_ru_review_status" = 'unreviewed'
WHERE "name_ru" IS NOT NULL;--> statement-breakpoint
UPDATE "football"."clubs"
SET "name_ru_review_status" = 'unreviewed'
WHERE "name_ru" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "football"."clubs" ADD CONSTRAINT "clubs_name_ru_review_consistency_check" CHECK ((
        ("football"."clubs"."name_ru" is null and "football"."clubs"."name_ru_review_status" is null)
        or
        (
          "football"."clubs"."name_ru" is not null
          and "football"."clubs"."name_ru_review_status" is not null
          and "football"."clubs"."name_ru_review_status" in ('unreviewed', 'reviewed')
        )
      ));--> statement-breakpoint
ALTER TABLE "football"."competitions" ADD CONSTRAINT "competitions_name_ru_review_consistency_check" CHECK ((
        ("football"."competitions"."name_ru" is null and "football"."competitions"."name_ru_review_status" is null)
        or
        (
          "football"."competitions"."name_ru" is not null
          and "football"."competitions"."name_ru_review_status" is not null
          and "football"."competitions"."name_ru_review_status" in ('unreviewed', 'reviewed')
        )
      ));--> statement-breakpoint
ALTER TABLE "football"."players" ADD CONSTRAINT "players_name_ru_review_consistency_check" CHECK ((
        ("football"."players"."name_ru" is null and "football"."players"."name_ru_review_status" is null)
        or
        (
          "football"."players"."name_ru" is not null
          and "football"."players"."name_ru_review_status" is not null
          and "football"."players"."name_ru_review_status" in ('unreviewed', 'reviewed')
        )
      ));
