import { randomUUID } from "node:crypto";

import {
  boolean,
  date,
  index,
  integer,
  pgSchema,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const footballSchema = pgSchema("football");

export const footballCompetitions = footballSchema.table(
  "competitions",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    provider: text("provider").notNull(),
    providerCompetitionId: integer("provider_competition_id").notNull(),
    providerName: text("provider_name").notNull(),
    country: text("country"),
    type: text("type"),
    providerLogoUrl: text("provider_logo_url"),
    slug: text("slug").notNull(),
    nameRu: text("name_ru").notNull(),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
  },
  (table) => ({
    providerCompetitionUnique: uniqueIndex(
      "competitions_provider_competition_id_unique",
    ).on(table.provider, table.providerCompetitionId),
    slugUnique: uniqueIndex("competitions_slug_unique").on(table.slug),
  }),
);

export const footballSeasons = footballSchema.table(
  "seasons",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    competitionId: text("competition_id")
      .notNull()
      .references(() => footballCompetitions.id, { onDelete: "restrict" }),
    provider: text("provider").notNull(),
    providerSeasonYear: integer("provider_season_year").notNull(),
    startsOn: date("starts_on", { mode: "string" }),
    endsOn: date("ends_on", { mode: "string" }),
    providerCurrent: boolean("provider_current").notNull(),
    displayLabel: text("display_label").notNull(),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
  },
  (table) => ({
    competitionSeasonUnique: uniqueIndex("seasons_competition_provider_year_unique").on(
      table.competitionId,
      table.provider,
      table.providerSeasonYear,
    ),
    competitionIndex: index("seasons_competition_id_idx").on(table.competitionId),
  }),
);

export const footballClubs = footballSchema.table(
  "clubs",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    provider: text("provider").notNull(),
    providerClubId: integer("provider_club_id").notNull(),
    providerName: text("provider_name").notNull(),
    code: text("code"),
    country: text("country"),
    founded: integer("founded"),
    national: boolean("national"),
    providerLogoUrl: text("provider_logo_url"),
    slug: text("slug").notNull(),
    nameRu: text("name_ru"),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
  },
  (table) => ({
    providerClubUnique: uniqueIndex("clubs_provider_club_id_unique").on(
      table.provider,
      table.providerClubId,
    ),
    slugUnique: uniqueIndex("clubs_slug_unique").on(table.slug),
  }),
);

export const footballSeasonClubs = footballSchema.table(
  "season_clubs",
  {
    seasonId: text("season_id")
      .notNull()
      .references(() => footballSeasons.id, { onDelete: "restrict" }),
    clubId: text("club_id")
      .notNull()
      .references(() => footballClubs.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
  },
  (table) => ({
    seasonClubPk: primaryKey({
      columns: [table.seasonId, table.clubId],
      name: "season_clubs_season_id_club_id_pk",
    }),
    clubIndex: index("season_clubs_club_id_idx").on(table.clubId),
  }),
);
