CREATE TABLE "article"."publication_categories" (
	"publication_id" text NOT NULL,
	"category_id" text NOT NULL,
	CONSTRAINT "publication_categories_publication_id_category_id_pk" PRIMARY KEY("publication_id","category_id")
);
--> statement-breakpoint
CREATE TABLE "article"."publication_images" (
	"publication_id" text NOT NULL,
	"media_id" text NOT NULL,
	CONSTRAINT "publication_images_publication_id_media_id_pk" PRIMARY KEY("publication_id","media_id")
);
--> statement-breakpoint
CREATE TABLE "article"."publication_tags" (
	"publication_id" text NOT NULL,
	"tag_id" text NOT NULL,
	CONSTRAINT "publication_tags_publication_id_tag_id_pk" PRIMARY KEY("publication_id","tag_id")
);
--> statement-breakpoint
CREATE TABLE "article"."publications" (
	"article_id" text PRIMARY KEY NOT NULL,
	"revision" integer NOT NULL,
	"source_revision" integer NOT NULL,
	"format_version" integer NOT NULL,
	"content" jsonb NOT NULL,
	"h1" text NOT NULL,
	"seo_title" text NOT NULL,
	"meta_description" text NOT NULL,
	"slug" text NOT NULL,
	"first_published_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "article_publications_revision_check" CHECK ("article"."publications"."revision" >= 1 and "article"."publications"."source_revision" >= 0),
	CONSTRAINT "article_publications_format_check" CHECK ("article"."publications"."format_version" = 1 and jsonb_typeof("article"."publications"."content") = 'object'),
	CONSTRAINT "article_publications_fields_check" CHECK (length(btrim("article"."publications"."h1")) between 1 and 300 and length("article"."publications"."seo_title") <= 300 and length("article"."publications"."meta_description") <= 500 and length("article"."publications"."slug") between 1 and 160 and "article"."publications"."slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$')
);
--> statement-breakpoint
ALTER TABLE "article"."operation_receipts" DROP CONSTRAINT "article_operation_receipts_action_check";--> statement-breakpoint
ALTER TABLE "article"."publication_categories" ADD CONSTRAINT "publication_categories_publication_id_publications_article_id_fk" FOREIGN KEY ("publication_id") REFERENCES "article"."publications"("article_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "article"."publication_categories" ADD CONSTRAINT "publication_categories_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "article"."categories"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "article"."publication_images" ADD CONSTRAINT "publication_images_publication_id_publications_article_id_fk" FOREIGN KEY ("publication_id") REFERENCES "article"."publications"("article_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "article"."publication_images" ADD CONSTRAINT "publication_images_media_id_assets_id_fk" FOREIGN KEY ("media_id") REFERENCES "media"."assets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "article"."publication_tags" ADD CONSTRAINT "publication_tags_publication_id_publications_article_id_fk" FOREIGN KEY ("publication_id") REFERENCES "article"."publications"("article_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "article"."publication_tags" ADD CONSTRAINT "publication_tags_tag_id_football_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "taxonomy"."football_tags"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "article"."publications" ADD CONSTRAINT "publications_article_id_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "article"."articles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "publication_categories_category_idx" ON "article"."publication_categories" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "publication_images_media_idx" ON "article"."publication_images" USING btree ("media_id");--> statement-breakpoint
CREATE INDEX "publication_tags_tag_idx" ON "article"."publication_tags" USING btree ("tag_id");--> statement-breakpoint
CREATE UNIQUE INDEX "article_publications_slug_unique" ON "article"."publications" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "article_publications_published_idx" ON "article"."publications" USING btree ("first_published_at","article_id");--> statement-breakpoint
ALTER TABLE "article"."operation_receipts" ADD CONSTRAINT "article_operation_receipts_action_check" CHECK ("article"."operation_receipts"."action" in ('create','save','image','publish','update_publication'));
--> statement-breakpoint
-- A published URL is permanent, including when the working draft is edited.
CREATE FUNCTION article.guard_publication_identity() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF NEW.article_id IS DISTINCT FROM OLD.article_id
     OR NEW.slug IS DISTINCT FROM OLD.slug
     OR NEW.first_published_at IS DISTINCT FROM OLD.first_published_at THEN
    RAISE EXCEPTION USING ERRCODE = '23514', CONSTRAINT = 'article_published_slug_immutable',
      MESSAGE = 'Published Article identity is immutable';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION article.guard_publication_identity() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER article_publication_identity_guard BEFORE UPDATE ON article.publications
FOR EACH ROW EXECUTE FUNCTION article.guard_publication_identity();
--> statement-breakpoint
CREATE FUNCTION article.guard_published_draft_slug() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF NEW.slug IS DISTINCT FROM OLD.slug
     AND EXISTS (SELECT 1 FROM article.publications p WHERE p.article_id = OLD.article_id) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', CONSTRAINT = 'article_published_slug_immutable',
      MESSAGE = 'Published Article slug is immutable';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION article.guard_published_draft_slug() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER article_published_draft_slug_guard BEFORE UPDATE OF slug ON article.drafts
FOR EACH ROW EXECUTE FUNCTION article.guard_published_draft_slug();
