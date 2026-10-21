import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { check, integer, pgSchema, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { footballClubs, footballCoaches, footballCompetitions, footballPlayers } from "./football";

export const taxonomySchema = pgSchema("taxonomy");
export const footballTags = taxonomySchema.table("football_tags", {
  id: text("id").primaryKey().$defaultFn(() => randomUUID()),
  clubId: text("club_id").references(() => footballClubs.id, { onDelete: "restrict" }),
  playerId: text("player_id").references(() => footballPlayers.id, { onDelete: "restrict" }),
  coachId: text("coach_id").references(() => footballCoaches.id, { onDelete: "restrict" }),
  competitionId: text("competition_id").references(() => footballCompetitions.id, { onDelete: "restrict" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  sourceCheck: check("football_tags_one_source_check", sql`num_nonnulls(${t.clubId},${t.playerId},${t.coachId},${t.competitionId}) = 1`),
  clubUnique: uniqueIndex("football_tags_club_unique").on(t.clubId),
  playerUnique: uniqueIndex("football_tags_player_unique").on(t.playerId),
  coachUnique: uniqueIndex("football_tags_coach_unique").on(t.coachId),
  competitionUnique: uniqueIndex("football_tags_competition_unique").on(t.competitionId),
}));

// Separate domain tables; only their physical column shape is shared.
const categoryColumns = () => ({
  id: text("id").primaryKey().$defaultFn(() => randomUUID()),
  name: text("name").notNull(),
  revision: integer("revision").default(0).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});
export const articleSchema = pgSchema("article");
export const articleCategories = articleSchema.table("categories", categoryColumns(), (t) => ({
  nameUnique: uniqueIndex("article_categories_name_unique").on(sql`lower(btrim(${t.name}))`),
  nameCheck: check("article_categories_name_check", sql`length(btrim(${t.name})) between 1 and 200 and ${t.name} = btrim(${t.name})`),
  revisionCheck: check("article_categories_revision_check", sql`${t.revision} >= 0`),
}));
export const newsSchema = pgSchema("news");
export const newsCategories = newsSchema.table("categories", categoryColumns(), (t) => ({
  nameUnique: uniqueIndex("news_categories_name_unique").on(sql`lower(btrim(${t.name}))`),
  nameCheck: check("news_categories_name_check", sql`length(btrim(${t.name})) between 1 and 200 and ${t.name} = btrim(${t.name})`),
  revisionCheck: check("news_categories_revision_check", sql`${t.revision} >= 0`),
}));
