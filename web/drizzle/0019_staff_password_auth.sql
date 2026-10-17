-- Fail closed instead of silently merging identities. No Account/FK is recreated.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM auth.users WHERE email IS NULL OR btrim(email) = '') OR
     EXISTS (SELECT 1 FROM auth.users GROUP BY lower(btrim(email)) HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'Authentication migration requires unique non-empty normalized emails';
  END IF;
END $$;
--> statement-breakpoint
UPDATE auth.users SET name = 'Staff' WHERE name IS NULL;
--> statement-breakpoint
UPDATE auth.users SET email = lower(btrim(email)) WHERE email <> lower(btrim(email));
--> statement-breakpoint
CREATE TABLE "auth"."rate_limits" (
	"id" text PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"count" integer NOT NULL,
	"last_request" bigint NOT NULL,
	CONSTRAINT "rate_limits_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "auth"."credential_accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"password" text,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth"."password_operations" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"session_id" text NOT NULL,
	"security_revision" integer NOT NULL,
	"password_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "auth"."security_audit" (
	"id" text PRIMARY KEY NOT NULL,
	"operation_id" text NOT NULL,
	"event_type" text NOT NULL,
	"operator" text NOT NULL,
	"target_account_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth"."staff_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"token" text NOT NULL,
	"user_id" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"security_revision" integer DEFAULT 0 NOT NULL,
	"mfa_verified_at" timestamp with time zone,
	CONSTRAINT "staff_sessions_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "auth"."staff_verifications" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth"."totp_step_up_uses" (
	"proof_hash" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth"."two_factors" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"secret" text NOT NULL,
	"backup_codes" text NOT NULL,
	"verified" boolean DEFAULT false NOT NULL,
	"failed_verification_count" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	CONSTRAINT "two_factors_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
ALTER TABLE "auth"."users" ALTER COLUMN "name" SET DEFAULT 'Staff';--> statement-breakpoint
ALTER TABLE "auth"."users" ALTER COLUMN "name" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "auth"."users" ALTER COLUMN "email" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "auth"."users" ADD COLUMN "email_verified_flag" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "auth"."users" ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "auth"."users" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "auth"."users" ADD COLUMN "two_factor_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "auth"."users" ADD COLUMN "security_revision" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
UPDATE auth.users SET email_verified_flag = (email_verified IS NOT NULL);--> statement-breakpoint
ALTER TABLE "identity"."accounts" ADD COLUMN "status" text DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "auth"."credential_accounts" ADD CONSTRAINT "credential_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth"."password_operations" ADD CONSTRAINT "password_operations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth"."password_operations" ADD CONSTRAINT "password_operations_session_id_staff_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "auth"."staff_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth"."staff_sessions" ADD CONSTRAINT "staff_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth"."two_factors" ADD CONSTRAINT "two_factors_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "credential_accounts_provider_identity_uq" ON "auth"."credential_accounts" USING btree ("provider_id","account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "security_audit_operation_event_uq" ON "auth"."security_audit" USING btree ("operation_id","event_type");--> statement-breakpoint
CREATE INDEX "staff_sessions_user_idx" ON "auth"."staff_sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "staff_verifications_identifier_idx" ON "auth"."staff_verifications" USING btree ("identifier");--> statement-breakpoint
ALTER TABLE "identity"."accounts" ADD CONSTRAINT "accounts_status_check" CHECK ("identity"."accounts"."status" in ('active', 'disabled'));
