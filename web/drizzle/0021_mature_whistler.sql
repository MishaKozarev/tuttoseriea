CREATE TABLE "football"."coaches" (
	"id" text PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"provider_coach_id" integer NOT NULL,
	"provider_name" text NOT NULL,
	"provider_photo_url" text,
	"name_ru" text,
	"name_ru_review_status" text,
	"localization_revision" integer DEFAULT 0 NOT NULL,
	"name_source_match_id" text NOT NULL,
	"photo_source_match_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "coaches_provider_check" CHECK (btrim("football"."coaches"."provider") <> ''),
	CONSTRAINT "coaches_provider_coach_id_check" CHECK ("football"."coaches"."provider_coach_id" > 0),
	CONSTRAINT "coaches_provider_name_check" CHECK (btrim("football"."coaches"."provider_name") <> ''),
	CONSTRAINT "coaches_localization_revision_check" CHECK ("football"."coaches"."localization_revision" >= 0),
	CONSTRAINT "coaches_name_ru_review_consistency_check" CHECK ((
    ("football"."coaches"."name_ru" is null and "football"."coaches"."name_ru_review_status" is null) or
    ("football"."coaches"."name_ru" is not null and btrim("football"."coaches"."name_ru") <> '' and "football"."coaches"."name_ru_review_status" is not null
      and "football"."coaches"."name_ru_review_status" in ('unreviewed','reviewed')))),
	CONSTRAINT "coaches_photo_source_consistency_check" CHECK ((
    ("football"."coaches"."provider_photo_url" is null and "football"."coaches"."photo_source_match_id" is null) or
    ("football"."coaches"."provider_photo_url" is not null and btrim("football"."coaches"."provider_photo_url") <> '' and "football"."coaches"."photo_source_match_id" is not null)))
);
--> statement-breakpoint
ALTER TABLE "football"."match_lineups" ADD COLUMN "coach_id" text;--> statement-breakpoint
ALTER TABLE "football"."coaches" ADD CONSTRAINT "coaches_name_source_match_id_matches_id_fk" FOREIGN KEY ("name_source_match_id") REFERENCES "football"."matches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "football"."coaches" ADD CONSTRAINT "coaches_photo_source_match_id_matches_id_fk" FOREIGN KEY ("photo_source_match_id") REFERENCES "football"."matches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "coaches_provider_coach_id_unique" ON "football"."coaches" USING btree ("provider","provider_coach_id");--> statement-breakpoint
ALTER TABLE "football"."match_lineups" ADD CONSTRAINT "match_lineups_coach_id_coaches_id_fk" FOREIGN KEY ("coach_id") REFERENCES "football"."coaches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "match_lineups_coach_id_idx" ON "football"."match_lineups" USING btree ("coach_id");--> statement-breakpoint
ALTER TABLE "football"."match_lineups" ADD CONSTRAINT "match_lineups_coach_identity_check" CHECK ("football"."match_lineups"."coach_id" is null or "football"."match_lineups"."provider_coach_id" is not null);