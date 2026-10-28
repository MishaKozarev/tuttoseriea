import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { check, integer, pgSchema, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { identityAccounts } from "./identity";

export const mediaSchema = pgSchema("media");
export const mediaAssets = mediaSchema.table("assets", {
  id: text("id").primaryKey().$defaultFn(() => randomUUID()),
  storageKey: text("storage_key").notNull(),
  mimeType: text("mime_type").notNull(),
  byteSize: integer("byte_size").notNull(),
  width: integer("width").notNull(),
  height: integer("height").notNull(),
  sha256: text("sha256").notNull(),
  uploaderAccountId: text("uploader_account_id").notNull().references(() => identityAccounts.id, { onDelete: "restrict" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [
  uniqueIndex("media_assets_storage_key_unique").on(table.storageKey),
  check("media_assets_id_check", sql`${table.id} ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'`),
  check("media_assets_key_check", sql`${table.storageKey} = ${table.id} || '.webp'`),
  check("media_assets_content_check", sql`${table.mimeType} = 'image/webp' and ${table.byteSize} between 1 and 5242880 and ${table.width} between 1 and 512 and ${table.height} between 1 and 512 and ${table.sha256} ~ '^[0-9a-f]{64}$'`),
]);
