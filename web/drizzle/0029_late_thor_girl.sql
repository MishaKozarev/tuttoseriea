ALTER TABLE "article"."drafts" ADD COLUMN "slug_mode" text DEFAULT 'auto' NOT NULL;--> statement-breakpoint
ALTER TABLE "article"."drafts" ADD CONSTRAINT "article_drafts_slug_mode_check" CHECK ("article"."drafts"."slug_mode" in ('auto', 'manual'));
--> statement-breakpoint
-- Preserve every legacy explicit address (including published URLs). Only its
-- provenance is marked; empty legacy drafts opt into lazy automatic preparation.
UPDATE "article"."drafts" SET "slug_mode" = 'manual' WHERE "slug" <> '';
