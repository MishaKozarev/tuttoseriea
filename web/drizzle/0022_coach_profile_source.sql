ALTER TABLE "football"."coaches" DROP CONSTRAINT "coaches_photo_source_consistency_check";--> statement-breakpoint
ALTER TABLE "football"."coaches" ALTER COLUMN "provider_name" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "football"."coaches" ALTER COLUMN "name_source_match_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "football"."coaches" ADD COLUMN "firstname" text;--> statement-breakpoint
ALTER TABLE "football"."coaches" ADD COLUMN "lastname" text;--> statement-breakpoint
ALTER TABLE "football"."coaches" ADD COLUMN "age" integer;--> statement-breakpoint
ALTER TABLE "football"."coaches" ADD COLUMN "birth_date" date;--> statement-breakpoint
ALTER TABLE "football"."coaches" ADD COLUMN "birth_place" text;--> statement-breakpoint
ALTER TABLE "football"."coaches" ADD COLUMN "birth_country" text;--> statement-breakpoint
ALTER TABLE "football"."coaches" ADD COLUMN "nationality" text;--> statement-breakpoint
ALTER TABLE "football"."coaches" ADD COLUMN "height" text;--> statement-breakpoint
ALTER TABLE "football"."coaches" ADD COLUMN "weight" text;--> statement-breakpoint
ALTER TABLE "football"."coaches" ADD COLUMN "provider_raw" jsonb;--> statement-breakpoint
ALTER TABLE "football"."coaches" ADD COLUMN "profile_observed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "football"."coaches" ADD CONSTRAINT "coaches_age_check" CHECK ("football"."coaches"."age" is null or "football"."coaches"."age" >= 0);--> statement-breakpoint
ALTER TABLE "football"."coaches" ADD CONSTRAINT "coaches_profile_source_check" CHECK ((
    ("football"."coaches"."profile_observed_at" is null and "football"."coaches"."provider_raw" is null) or
    ("football"."coaches"."profile_observed_at" is not null and "football"."coaches"."provider_raw" is not null
      and jsonb_typeof("football"."coaches"."provider_raw") = 'object' and "football"."coaches"."provider_name" is not null)));