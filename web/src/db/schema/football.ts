import { randomUUID } from "node:crypto";

import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
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

export const footballMatches = footballSchema.table(
  "matches",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    provider: text("provider").notNull(),
    providerFixtureId: integer("provider_fixture_id").notNull(),
    seasonId: text("season_id").notNull(),
    homeClubId: text("home_club_id").notNull(),
    awayClubId: text("away_club_id").notNull(),
    round: text("round").notNull(),
    kickoffAt: timestamp("kickoff_at", { mode: "date", withTimezone: true }),
    providerTimezone: text("provider_timezone"),
    providerTimestamp: integer("provider_timestamp"),
    firstPeriodStart: integer("first_period_start"),
    secondPeriodStart: integer("second_period_start"),
    referee: text("referee"),
    providerVenueId: integer("provider_venue_id"),
    venueName: text("venue_name"),
    venueCity: text("venue_city"),
    status: text("status").notNull(),
    pollingCategory: text("polling_category").notNull(),
    providerStatusLong: text("provider_status_long"),
    providerStatusShort: text("provider_status_short").notNull(),
    statusElapsed: integer("status_elapsed"),
    statusExtra: integer("status_extra"),
    homeWinner: boolean("home_winner"),
    awayWinner: boolean("away_winner"),
    homeGoals: integer("home_goals"),
    awayGoals: integer("away_goals"),
    halftimeHome: integer("halftime_home"),
    halftimeAway: integer("halftime_away"),
    fulltimeHome: integer("fulltime_home"),
    fulltimeAway: integer("fulltime_away"),
    extratimeHome: integer("extratime_home"),
    extratimeAway: integer("extratime_away"),
    penaltyHome: integer("penalty_home"),
    penaltyAway: integer("penalty_away"),
    providerRaw: jsonb("provider_raw").$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
  },
  (table) => ({
    providerFixtureUnique: uniqueIndex("matches_provider_fixture_id_unique").on(
      table.provider,
      table.providerFixtureId,
    ),
    seasonKickoffIndex: index("matches_season_kickoff_idx").on(
      table.seasonId,
      table.kickoffAt,
    ),
    statusIndex: index("matches_status_idx").on(table.status),
    homeClubIndex: index("matches_home_club_id_idx").on(table.homeClubId),
    awayClubIndex: index("matches_away_club_id_idx").on(table.awayClubId),
    seasonFk: foreignKey({
      name: "matches_season_id_seasons_id_fk",
      columns: [table.seasonId],
      foreignColumns: [footballSeasons.id],
    }).onDelete("restrict"),
    homeSeasonClubFk: foreignKey({
      name: "matches_home_season_club_fk",
      columns: [table.seasonId, table.homeClubId],
      foreignColumns: [footballSeasonClubs.seasonId, footballSeasonClubs.clubId],
    }).onDelete("restrict"),
    awaySeasonClubFk: foreignKey({
      name: "matches_away_season_club_fk",
      columns: [table.seasonId, table.awayClubId],
      foreignColumns: [footballSeasonClubs.seasonId, footballSeasonClubs.clubId],
    }).onDelete("restrict"),
    differentClubsCheck: check(
      "matches_home_away_different_check",
      sql`${table.homeClubId} <> ${table.awayClubId}`,
    ),
    statusCheck: check(
      "matches_status_check",
      sql`${table.status} in (
        'scheduled',
        'live',
        'paused',
        'suspended',
        'interrupted',
        'postponed',
        'abandoned',
        'finished',
        'cancelled',
        'awarded',
        'walkover'
      )`,
    ),
    pollingCategoryCheck: check(
      "matches_polling_category_check",
      sql`${table.pollingCategory} in ('ACTIVE', 'WATCH', 'TERMINAL')`,
    ),
  }),
);

export const footballStandings = footballSchema.table(
  "standings",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    seasonId: text("season_id").notNull(),
    clubId: text("club_id").notNull(),
    groupName: text("group_name"),
    rank: integer("rank").notNull(),
    points: integer("points").notNull(),
    goalsDiff: integer("goals_diff").notNull(),
    form: text("form"),
    providerStatus: text("provider_status"),
    description: text("description"),
    played: integer("played").notNull(),
    wins: integer("wins").notNull(),
    draws: integer("draws").notNull(),
    losses: integer("losses").notNull(),
    goalsFor: integer("goals_for").notNull(),
    goalsAgainst: integer("goals_against").notNull(),
    homePlayed: integer("home_played").notNull(),
    homeWins: integer("home_wins").notNull(),
    homeDraws: integer("home_draws").notNull(),
    homeLosses: integer("home_losses").notNull(),
    homeGoalsFor: integer("home_goals_for").notNull(),
    homeGoalsAgainst: integer("home_goals_against").notNull(),
    awayPlayed: integer("away_played").notNull(),
    awayWins: integer("away_wins").notNull(),
    awayDraws: integer("away_draws").notNull(),
    awayLosses: integer("away_losses").notNull(),
    awayGoalsFor: integer("away_goals_for").notNull(),
    awayGoalsAgainst: integer("away_goals_against").notNull(),
    providerRaw: jsonb("provider_raw").$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
  },
  (table) => ({
    seasonClubUnique: uniqueIndex("standings_season_club_unique").on(
      table.seasonId,
      table.clubId,
    ),
    seasonRankUnique: uniqueIndex("standings_season_rank_unique").on(
      table.seasonId,
      table.rank,
    ),
    clubIndex: index("standings_club_id_idx").on(table.clubId),
    seasonFk: foreignKey({
      name: "standings_season_id_seasons_id_fk",
      columns: [table.seasonId],
      foreignColumns: [footballSeasons.id],
    }).onDelete("restrict"),
    seasonClubFk: foreignKey({
      name: "standings_season_club_fk",
      columns: [table.seasonId, table.clubId],
      foreignColumns: [footballSeasonClubs.seasonId, footballSeasonClubs.clubId],
    }).onDelete("restrict"),
    rankPositiveCheck: check("standings_rank_positive_check", sql`${table.rank} > 0`),
    statisticsNonnegativeCheck: check(
      "standings_statistics_nonnegative_check",
      sql`${table.played} >= 0
        and ${table.wins} >= 0
        and ${table.draws} >= 0
        and ${table.losses} >= 0
        and ${table.goalsFor} >= 0
        and ${table.goalsAgainst} >= 0
        and ${table.homePlayed} >= 0
        and ${table.homeWins} >= 0
        and ${table.homeDraws} >= 0
        and ${table.homeLosses} >= 0
        and ${table.homeGoalsFor} >= 0
        and ${table.homeGoalsAgainst} >= 0
        and ${table.awayPlayed} >= 0
        and ${table.awayWins} >= 0
        and ${table.awayDraws} >= 0
        and ${table.awayLosses} >= 0
        and ${table.awayGoalsFor} >= 0
        and ${table.awayGoalsAgainst} >= 0`,
    ),
  }),
);
