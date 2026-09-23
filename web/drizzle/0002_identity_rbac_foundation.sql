CREATE SCHEMA "identity";
--> statement-breakpoint
CREATE TABLE "identity"."account_roles" (
	"account_id" text NOT NULL,
	"role_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "account_roles_account_id_role_id_pk" PRIMARY KEY("account_id","role_id")
);
--> statement-breakpoint
CREATE TABLE "identity"."accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"auth_user_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "identity"."roles" (
	"id" text PRIMARY KEY NOT NULL
);
--> statement-breakpoint
INSERT INTO "identity"."roles" ("id") VALUES
	('writer'),
	('admin'),
	('super_admin')
ON CONFLICT ("id") DO NOTHING;
--> statement-breakpoint
ALTER TABLE "identity"."account_roles" ADD CONSTRAINT "account_roles_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "identity"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity"."account_roles" ADD CONSTRAINT "account_roles_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "identity"."roles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity"."accounts" ADD CONSTRAINT "accounts_auth_user_id_users_id_fk" FOREIGN KEY ("auth_user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_roles_role_id_idx" ON "identity"."account_roles" USING btree ("role_id");--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_auth_user_id_unique" ON "identity"."accounts" USING btree ("auth_user_id");
