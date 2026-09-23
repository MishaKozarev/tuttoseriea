import { randomUUID } from "node:crypto";

import {
  index,
  pgSchema,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { users } from "./auth";

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
  },
  (table) => ({
    authUserUnique: uniqueIndex("accounts_auth_user_id_unique").on(table.authUserId),
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
