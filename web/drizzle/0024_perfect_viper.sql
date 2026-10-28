CREATE SCHEMA "media";
--> statement-breakpoint
CREATE TABLE "identity"."account_permission_assignments" (
	"account_id" text NOT NULL,
	"permission_id" text NOT NULL,
	"granted" boolean DEFAULT false NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"changed_by_account_id" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "account_permission_assignments_account_id_permission_id_pk" PRIMARY KEY("account_id","permission_id"),
	CONSTRAINT "account_permission_assignments_values_check" CHECK ("identity"."account_permission_assignments"."permission_id" = 'article.publish.own' and "identity"."account_permission_assignments"."revision" > 0)
);
--> statement-breakpoint
CREATE TABLE "identity"."writer_operation_receipts" (
	"operation_id" text PRIMARY KEY NOT NULL,
	"actor_account_id" text NOT NULL,
	"target_account_id" text NOT NULL,
	"action" text NOT NULL,
	"fingerprint" text NOT NULL,
	"result" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "writer_operation_receipts_values_check" CHECK ("identity"."writer_operation_receipts"."operation_id" ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' and "identity"."writer_operation_receipts"."fingerprint" ~ '^[0-9a-f]{64}$' and "identity"."writer_operation_receipts"."action" in ('create_writer','attach_writer','publish_own','profile','avatar'))
);
--> statement-breakpoint
CREATE TABLE "identity"."writer_profiles" (
	"account_id" text PRIMARY KEY NOT NULL,
	"nickname" text DEFAULT '' NOT NULL,
	"social_links" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"avatar_media_id" text,
	"revision" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "writer_profiles_values_check" CHECK (length("identity"."writer_profiles"."nickname") <= 60 and jsonb_typeof("identity"."writer_profiles"."social_links") = 'array' and jsonb_array_length("identity"."writer_profiles"."social_links") <= 10 and "identity"."writer_profiles"."revision" > 0)
);
--> statement-breakpoint
CREATE TABLE "media"."assets" (
	"id" text PRIMARY KEY NOT NULL,
	"storage_key" text NOT NULL,
	"mime_type" text NOT NULL,
	"byte_size" integer NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"sha256" text NOT NULL,
	"uploader_account_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "media_assets_id_check" CHECK ("media"."assets"."id" ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
	CONSTRAINT "media_assets_key_check" CHECK ("media"."assets"."storage_key" = "media"."assets"."id" || '.webp'),
	CONSTRAINT "media_assets_content_check" CHECK ("media"."assets"."mime_type" = 'image/webp' and "media"."assets"."byte_size" between 1 and 5242880 and "media"."assets"."width" between 1 and 512 and "media"."assets"."height" between 1 and 512 and "media"."assets"."sha256" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE "identity"."account_permission_assignments" ADD CONSTRAINT "account_permission_assignments_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "identity"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity"."account_permission_assignments" ADD CONSTRAINT "account_permission_assignments_changed_by_account_id_accounts_id_fk" FOREIGN KEY ("changed_by_account_id") REFERENCES "identity"."accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity"."writer_operation_receipts" ADD CONSTRAINT "writer_operation_receipts_actor_account_id_accounts_id_fk" FOREIGN KEY ("actor_account_id") REFERENCES "identity"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity"."writer_operation_receipts" ADD CONSTRAINT "writer_operation_receipts_target_account_id_accounts_id_fk" FOREIGN KEY ("target_account_id") REFERENCES "identity"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity"."writer_profiles" ADD CONSTRAINT "writer_profiles_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "identity"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity"."writer_profiles" ADD CONSTRAINT "writer_profiles_avatar_media_id_assets_id_fk" FOREIGN KEY ("avatar_media_id") REFERENCES "media"."assets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media"."assets" ADD CONSTRAINT "assets_uploader_account_id_accounts_id_fk" FOREIGN KEY ("uploader_account_id") REFERENCES "identity"."accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "media_assets_storage_key_unique" ON "media"."assets" USING btree ("storage_key");
