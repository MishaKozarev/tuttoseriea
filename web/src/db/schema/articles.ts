import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { check, index, integer, jsonb, primaryKey, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { identityAccounts } from "./identity";
import { mediaAssets } from "./media";
import { articleCategories, articleSchema, footballTags } from "./taxonomy";

// The immutable Article identity is separate from its single mutable working draft.
// Runtime receives no UPDATE/DELETE privilege on this table.
export const articles = articleSchema.table("articles", {
  id: text("id").primaryKey().$defaultFn(() => randomUUID()),
  authorAccountId: text("author_account_id").notNull().references(() => identityAccounts.id, { onDelete: "restrict" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [index("articles_author_idx").on(t.authorAccountId)]);

export const articleDrafts = articleSchema.table("drafts", {
  articleId: text("article_id").primaryKey().references(() => articles.id, { onDelete: "restrict" }),
  revision: integer("revision").notNull().default(0),
  formatVersion: integer("format_version").notNull().default(1),
  content: jsonb("content").$type<Record<string, unknown>>().notNull(),
  h1: text("h1").notNull().default(""),
  seoTitle: text("seo_title").notNull().default(""),
  metaDescription: text("meta_description").notNull().default(""),
  slug: text("slug").notNull().default(""),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [
  uniqueIndex("article_drafts_slug_unique").on(t.slug).where(sql`${t.slug} <> ''`),
  check("article_drafts_revision_check", sql`${t.revision} >= 0`),
  check("article_drafts_format_check", sql`${t.formatVersion} = 1 and jsonb_typeof(${t.content}) = 'object'`),
  check("article_drafts_fields_check", sql`length(${t.h1}) <= 300 and length(${t.seoTitle}) <= 300 and length(${t.metaDescription}) <= 500 and length(${t.slug}) <= 160 and (${t.slug} = '' or ${t.slug} ~ '^[a-z0-9]+(-[a-z0-9]+)*$')`),
]);

export const articleDraftCategories = articleSchema.table("draft_categories", {
  draftId: text("draft_id").notNull().references(() => articleDrafts.articleId, { onDelete: "restrict" }),
  categoryId: text("category_id").notNull().references(() => articleCategories.id, { onDelete: "restrict" }),
}, t => [primaryKey({ columns: [t.draftId, t.categoryId] }), index("draft_categories_category_idx").on(t.categoryId)]);

export const articleDraftTags = articleSchema.table("draft_tags", {
  draftId: text("draft_id").notNull().references(() => articleDrafts.articleId, { onDelete: "restrict" }),
  tagId: text("tag_id").notNull().references(() => footballTags.id, { onDelete: "restrict" }),
}, t => [primaryKey({ columns: [t.draftId, t.tagId] }), index("draft_tags_tag_idx").on(t.tagId)]);

// Upload attachment is distinct from a body image node. Removing a body node does
// not delete its durable file or silently remove its draft attachment.
export const articleDraftImages = articleSchema.table("draft_images", {
  draftId: text("draft_id").notNull().references(() => articleDrafts.articleId, { onDelete: "restrict" }),
  mediaId: text("media_id").notNull().references(() => mediaAssets.id, { onDelete: "restrict" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [primaryKey({ columns: [t.draftId, t.mediaId] }), index("draft_images_media_idx").on(t.mediaId)]);

// One current published snapshot. Draft writes never touch this aggregate.
// Its slug and first publication time are immutable after INSERT.
export const articlePublications = articleSchema.table("publications", {
  articleId: text("article_id").primaryKey().references(() => articles.id, { onDelete: "restrict" }),
  revision: integer("revision").notNull(),
  sourceRevision: integer("source_revision").notNull(),
  formatVersion: integer("format_version").notNull(),
  content: jsonb("content").$type<Record<string, unknown>>().notNull(),
  h1: text("h1").notNull(),
  seoTitle: text("seo_title").notNull(),
  metaDescription: text("meta_description").notNull(),
  slug: text("slug").notNull(),
  firstPublishedAt: timestamp("first_published_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [
  uniqueIndex("article_publications_slug_unique").on(t.slug),
  index("article_publications_published_idx").on(t.firstPublishedAt, t.articleId),
  check("article_publications_revision_check", sql`${t.revision} >= 1 and ${t.sourceRevision} >= 0`),
  check("article_publications_format_check", sql`${t.formatVersion} = 1 and jsonb_typeof(${t.content}) = 'object'`),
  check("article_publications_fields_check", sql`length(btrim(${t.h1})) between 1 and 300 and length(${t.seoTitle}) <= 300 and length(${t.metaDescription}) <= 500 and length(${t.slug}) between 1 and 160 and ${t.slug} ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`),
]);

export const articlePublicationCategories = articleSchema.table("publication_categories", {
  publicationId: text("publication_id").notNull().references(() => articlePublications.articleId, { onDelete: "restrict" }),
  categoryId: text("category_id").notNull().references(() => articleCategories.id, { onDelete: "restrict" }),
}, t => [primaryKey({ columns: [t.publicationId, t.categoryId] }), index("publication_categories_category_idx").on(t.categoryId)]);

export const articlePublicationTags = articleSchema.table("publication_tags", {
  publicationId: text("publication_id").notNull().references(() => articlePublications.articleId, { onDelete: "restrict" }),
  tagId: text("tag_id").notNull().references(() => footballTags.id, { onDelete: "restrict" }),
}, t => [primaryKey({ columns: [t.publicationId, t.tagId] }), index("publication_tags_tag_idx").on(t.tagId)]);

export const articlePublicationImages = articleSchema.table("publication_images", {
  publicationId: text("publication_id").notNull().references(() => articlePublications.articleId, { onDelete: "restrict" }),
  mediaId: text("media_id").notNull().references(() => mediaAssets.id, { onDelete: "restrict" }),
}, t => [primaryKey({ columns: [t.publicationId, t.mediaId] }), index("publication_images_media_idx").on(t.mediaId)]);

export const articleOperationReceipts = articleSchema.table("operation_receipts", {
  operationId: text("operation_id").primaryKey(),
  actorAccountId: text("actor_account_id").notNull().references(() => identityAccounts.id, { onDelete: "restrict" }),
  articleId: text("article_id").notNull().references(() => articles.id, { onDelete: "restrict" }),
  action: text("action").notNull(),
  fingerprint: text("fingerprint").notNull(),
  result: jsonb("result").$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [
  check("article_operation_receipts_action_check", sql`${t.action} in ('create','save','image','publish','update_publication')`),
  check("article_operation_receipts_fingerprint_check", sql`${t.fingerprint} ~ '^[0-9a-f]{64}$' and jsonb_typeof(${t.result}) = 'object'`),
]);
