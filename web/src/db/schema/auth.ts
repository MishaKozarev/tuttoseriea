import { randomUUID } from "node:crypto";

import {
  boolean,
  bigint,
  integer,
  index,
  jsonb,
  pgSchema,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const authSchema = pgSchema("auth");

export const users = authSchema.table(
  "users",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    name: text("name").notNull().default("Staff"),
    email: text("email").notNull(),
    emailVerified: timestamp("email_verified", { mode: "date" }),
    emailVerifiedFlag: boolean("email_verified_flag").notNull().default(false),
    image: text("image"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    twoFactorEnabled: boolean("two_factor_enabled").notNull().default(false),
    securityRevision: integer("security_revision").notNull().default(0),
  },
  (table) => ({
    emailUnique: uniqueIndex("users_email_unique").on(table.email),
  }),
);

export const accounts = authSchema.table(
  "accounts",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    provider: text("provider").notNull(),
    providerAccountId: text("provider_account_id").notNull(),
    refresh_token: text("refresh_token"),
    access_token: text("access_token"),
    expires_at: integer("expires_at"),
    token_type: text("token_type"),
    scope: text("scope"),
    id_token: text("id_token"),
    session_state: text("session_state"),
  },
  (table) => ({
    compoundKey: primaryKey({
      columns: [table.provider, table.providerAccountId],
      name: "accounts_provider_provider_account_id_pk",
    }),
  }),
);

export const sessions = authSchema.table("sessions", {
  sessionToken: text("session_token").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expires: timestamp("expires", { mode: "date" }).notNull(),
});

export const verificationTokens = authSchema.table(
  "verification_tokens",
  {
    identifier: text("identifier").notNull(),
    token: text("token").notNull(),
    expires: timestamp("expires", { mode: "date" }).notNull(),
  },
  (table) => ({
    compoundKey: primaryKey({
      columns: [table.identifier, table.token],
      name: "verification_tokens_identifier_token_pk",
    }),
  }),
);

export const authenticators = authSchema.table(
  "authenticators",
  {
    credentialID: text("credential_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    providerAccountId: text("provider_account_id").notNull(),
    credentialPublicKey: text("credential_public_key").notNull(),
    counter: integer("counter").notNull(),
    credentialDeviceType: text("credential_device_type").notNull(),
    credentialBackedUp: boolean("credential_backed_up").notNull(),
    transports: text("transports"),
  },
  (table) => ({
    compoundKey: primaryKey({
      columns: [table.userId, table.credentialID],
      name: "authenticators_user_id_credential_id_pk",
    }),
    credentialIdUnique: uniqueIndex("authenticators_credential_id_unique").on(
      table.credentialID,
    ),
  }),
);

export const authTables = {
  usersTable: users,
  accountsTable: accounts,
  sessionsTable: sessions,
  verificationTokensTable: verificationTokens,
  authenticatorsTable: authenticators,
};

// Legacy Auth.js tables above remain migration/rollback data. New authentication
// never reads their sessions, provider accounts, or verification tokens.
export const credentialAccounts = authSchema.table("credential_accounts", {
  id: text("id").primaryKey().$defaultFn(randomUUID),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  password: text("password"),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
  scope: text("scope"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [uniqueIndex("credential_accounts_provider_identity_uq").on(table.providerId, table.accountId)]);

export const staffSessions = authSchema.table("staff_sessions", {
  id: text("id").primaryKey().$defaultFn(randomUUID),
  token: text("token").notNull().unique(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  securityRevision: integer("security_revision").notNull().default(0),
  mfaVerifiedAt: timestamp("mfa_verified_at", { withTimezone: true }),
}, (table) => [index("staff_sessions_user_idx").on(table.userId)]);

export const staffVerifications = authSchema.table("staff_verifications", {
  id: text("id").primaryKey().$defaultFn(randomUUID),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("staff_verifications_identifier_idx").on(table.identifier)]);

export const twoFactors = authSchema.table("two_factors", {
  id: text("id").primaryKey().$defaultFn(randomUUID),
  userId: text("user_id").notNull().unique().references(() => users.id, { onDelete: "cascade" }),
  secret: text("secret").notNull(),
  backupCodes: text("backup_codes").notNull(),
  verified: boolean("verified").notNull().default(false),
  failedVerificationCount: integer("failed_verification_count").notNull().default(0),
  lockedUntil: timestamp("locked_until", { withTimezone: true }),
});

export const authRateLimits = authSchema.table("rate_limits", {
  id: text("id").primaryKey().$defaultFn(randomUUID),
  key: text("key").notNull().unique(),
  count: integer("count").notNull(),
  // Better Auth uses epoch milliseconds; JS numbers are exact in this range.
  lastRequest: bigint("last_request", { mode: "number" }).notNull(),
});

export const passwordOperations = authSchema.table("password_operations", {
  id: text("id").primaryKey().$defaultFn(randomUUID),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  sessionId: text("session_id").notNull().references(() => staffSessions.id, { onDelete: "cascade" }),
  securityRevision: integer("security_revision").notNull(),
  passwordHash: text("password_hash").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  consumedAt: timestamp("consumed_at", { withTimezone: true }),
});

export const totpStepUpUses = authSchema.table("totp_step_up_uses", {
  proofHash: text("proof_hash").primaryKey(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

export const securityAudit = authSchema.table("security_audit", {
  id: text("id").primaryKey().$defaultFn(randomUUID),
  operationId: text("operation_id").notNull(),
  eventType: text("event_type").notNull(),
  operator: text("operator").notNull(),
  targetAccountId: text("target_account_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  details: jsonb("details").$type<Record<string, string | number | boolean | null>>().notNull().default({}),
}, (table) => [uniqueIndex("security_audit_operation_event_uq").on(table.operationId, table.eventType)]);
