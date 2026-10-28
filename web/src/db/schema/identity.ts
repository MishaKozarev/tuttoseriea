import { randomUUID } from "node:crypto";

import {
  index,
  check,
  pgSchema,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  integer,
  boolean,
  jsonb,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

import { users } from "./auth";
import { mediaAssets } from "./media";

export const identitySchema = pgSchema("identity");

export const identityAccounts = identitySchema.table(
  "accounts",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    authUserId: text("auth_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    status: text("status").notNull().default("active"),
  },
  (table) => ({
    authUserUnique: uniqueIndex("accounts_auth_user_id_unique").on(table.authUserId),
    statusCheck: check("accounts_status_check", sql`${table.status} in ('active', 'disabled')`),
  }),
);

export const identityRoles = identitySchema.table("roles", {
  id: text("id").primaryKey(),
});

export const identityAccountRoles = identitySchema.table(
  "account_roles",
  {
    accountId: text("account_id")
      .notNull()
      .references(() => identityAccounts.id, { onDelete: "cascade" }),
    roleId: text("role_id")
      .notNull()
      .references(() => identityRoles.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  },
  (table) => ({
    accountRolePk: primaryKey({
      columns: [table.accountId, table.roleId],
      name: "account_roles_account_id_role_id_pk",
    }),
    roleIdIndex: index("account_roles_role_id_idx").on(table.roleId),
  }),
);

export const writerProfiles = identitySchema.table("writer_profiles", {
  accountId: text("account_id").primaryKey().references(() => identityAccounts.id, { onDelete: "cascade" }),
  nickname: text("nickname").notNull().default(""),
  socialLinks: jsonb("social_links").$type<{ label: string; url: string }[]>().notNull().default([]),
  avatarMediaId: text("avatar_media_id").references(() => mediaAssets.id, { onDelete: "restrict" }),
  revision: integer("revision").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [
  check("writer_profiles_values_check", sql`length(${table.nickname}) <= 60 and jsonb_typeof(${table.socialLinks}) = 'array' and jsonb_array_length(${table.socialLinks}) <= 10 and ${table.revision} > 0`),
]);

export const accountPermissionAssignments = identitySchema.table("account_permission_assignments", {
  accountId: text("account_id").notNull().references(() => identityAccounts.id, { onDelete: "cascade" }),
  permissionId: text("permission_id").notNull(),
  granted: boolean("granted").notNull().default(false),
  revision: integer("revision").notNull().default(1),
  changedByAccountId: text("changed_by_account_id").notNull().references(() => identityAccounts.id, { onDelete: "restrict" }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [
  primaryKey({ columns: [table.accountId, table.permissionId] }),
  check("account_permission_assignments_values_check", sql`${table.permissionId} = 'article.publish.own' and ${table.revision} > 0`),
]);

// An immutable receipt belongs to a server-verified actor and one exact command.
// Credential/session values are never stored in a receipt.
export const writerOperationReceipts = identitySchema.table("writer_operation_receipts", {
  operationId: text("operation_id").primaryKey(),
  actorAccountId: text("actor_account_id").notNull().references(() => identityAccounts.id, { onDelete: "cascade" }),
  targetAccountId: text("target_account_id").notNull().references(() => identityAccounts.id, { onDelete: "cascade" }),
  action: text("action").notNull(),
  fingerprint: text("fingerprint").notNull(),
  result: jsonb("result").$type<{ accountId: string; revision?: number }>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [
  check("writer_operation_receipts_values_check", sql`${table.operationId} ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' and ${table.fingerprint} ~ '^[0-9a-f]{64}$' and ${table.action} in ('create_writer','attach_writer','publish_own','profile','avatar')`),
]);
