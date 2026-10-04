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
    nameRu: text("name_ru"),
    nameRuReviewStatus: text("name_ru_review_status"),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
  },
  (table) => ({
    providerCompetitionUnique: uniqueIndex(
      "competitions_provider_competition_id_unique",
    ).on(table.provider, table.providerCompetitionId),
    slugUnique: uniqueIndex("competitions_slug_unique").on(table.slug),
    nameRuReviewConsistencyCheck: check(
      "competitions_name_ru_review_consistency_check",
      sql`(
        (${table.nameRu} is null and ${table.nameRuReviewStatus} is null)
        or
        (
          ${table.nameRu} is not null
          and ${table.nameRuReviewStatus} is not null
          and ${table.nameRuReviewStatus} in ('unreviewed', 'reviewed')
        )
      )`,
    ),
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
    nameRuReviewStatus: text("name_ru_review_status"),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
  },
  (table) => ({
    providerClubUnique: uniqueIndex("clubs_provider_club_id_unique").on(
      table.provider,
      table.providerClubId,
    ),
    slugUnique: uniqueIndex("clubs_slug_unique").on(table.slug),
    nameRuReviewConsistencyCheck: check(
      "clubs_name_ru_review_consistency_check",
      sql`(
        (${table.nameRu} is null and ${table.nameRuReviewStatus} is null)
        or
        (
          ${table.nameRu} is not null
          and ${table.nameRuReviewStatus} is not null
          and ${table.nameRuReviewStatus} in ('unreviewed', 'reviewed')
        )
      )`,
    ),
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
    slug: text("slug").notNull(),
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
    slugUnique: uniqueIndex("matches_slug_unique").on(table.slug),
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

export const footballPlayers = footballSchema.table(
  "players",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    provider: text("provider").notNull(),
    providerPlayerId: integer("provider_player_id").notNull(),
    providerName: text("provider_name").notNull(),
    slug: text("slug").notNull(),
    nameRu: text("name_ru"),
    nameRuReviewStatus: text("name_ru_review_status"),
    firstname: text("firstname"),
    lastname: text("lastname"),
    age: integer("age"),
    birthDate: date("birth_date", { mode: "string" }),
    birthPlace: text("birth_place"),
    birthCountry: text("birth_country"),
    nationality: text("nationality"),
    height: text("height"),
    weight: text("weight"),
    injured: boolean("injured"),
    providerPhotoUrl: text("provider_photo_url"),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
  },
  (table) => ({
    providerPlayerUnique: uniqueIndex("players_provider_player_id_unique").on(
      table.provider,
      table.providerPlayerId,
    ),
    slugUnique: uniqueIndex("players_slug_unique").on(table.slug),
    agePositiveCheck: check(
      "players_age_positive_check",
      sql`${table.age} is null or ${table.age} > 0`,
    ),
    nameRuReviewConsistencyCheck: check(
      "players_name_ru_review_consistency_check",
      sql`(
        (${table.nameRu} is null and ${table.nameRuReviewStatus} is null)
        or
        (
          ${table.nameRu} is not null
          and ${table.nameRuReviewStatus} is not null
          and ${table.nameRuReviewStatus} in ('unreviewed', 'reviewed')
        )
      )`,
    ),
  }),
);

export const footballMatchEvents = footballSchema.table(
  "match_events",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    matchId: text("match_id")
      .notNull()
      .references(() => footballMatches.id, { onDelete: "restrict" }),
    providerOrder: integer("provider_order").notNull(),
    elapsed: integer("elapsed").notNull(),
    extra: integer("extra"),
    clubId: text("club_id")
      .notNull()
      .references(() => footballClubs.id, { onDelete: "restrict" }),
    providerPlayerId: integer("provider_player_id"),
    providerPlayerName: text("provider_player_name"),
    playerId: text("player_id").references(() => footballPlayers.id, {
      onDelete: "set null",
    }),
    providerRelatedPlayerId: integer("provider_related_player_id"),
    providerRelatedPlayerName: text("provider_related_player_name"),
    relatedPlayerId: text("related_player_id").references(
      () => footballPlayers.id,
      { onDelete: "set null" },
    ),
    providerType: text("provider_type").notNull(),
    providerDetail: text("provider_detail").notNull(),
    comments: text("comments"),
    providerRaw: jsonb("provider_raw").$type<Record<string, unknown>>().notNull(),
  },
  (table) => ({
    matchOrderUnique: uniqueIndex("match_events_match_order_unique").on(
      table.matchId,
      table.providerOrder,
    ),
    clubIndex: index("match_events_club_id_idx").on(table.clubId),
    playerIndex: index("match_events_player_id_idx").on(table.playerId),
    relatedPlayerIndex: index("match_events_related_player_id_idx").on(
      table.relatedPlayerId,
    ),
    providerOrderNonnegativeCheck: check(
      "match_events_provider_order_nonnegative_check",
      sql`${table.providerOrder} >= 0`,
    ),
    elapsedNonnegativeCheck: check(
      "match_events_elapsed_nonnegative_check",
      sql`${table.elapsed} >= 0`,
    ),
    extraNonnegativeCheck: check(
      "match_events_extra_nonnegative_check",
      sql`${table.extra} is null or ${table.extra} >= 0`,
    ),
    providerPlayerIdPositiveCheck: check(
      "match_events_provider_player_id_positive_check",
      sql`${table.providerPlayerId} is null or ${table.providerPlayerId} > 0`,
    ),
    providerRelatedPlayerIdPositiveCheck: check(
      "match_events_provider_related_player_id_positive_check",
      sql`${table.providerRelatedPlayerId} is null or ${table.providerRelatedPlayerId} > 0`,
    ),
  }),
);

export const footballMatchLineups = footballSchema.table(
  "match_lineups",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    matchId: text("match_id")
      .notNull()
      .references(() => footballMatches.id, { onDelete: "restrict" }),
    clubId: text("club_id")
      .notNull()
      .references(() => footballClubs.id, { onDelete: "restrict" }),
    formation: text("formation"),
    providerCoachId: integer("provider_coach_id"),
    providerCoachName: text("provider_coach_name"),
    providerCoachPhotoUrl: text("provider_coach_photo_url"),
    providerColors: jsonb("provider_colors").$type<Record<string, unknown>>(),
    providerRaw: jsonb("provider_raw").$type<Record<string, unknown>>().notNull(),
    observedAt: timestamp("observed_at", { mode: "date", withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    matchClubUnique: uniqueIndex("match_lineups_match_club_unique").on(
      table.matchId,
      table.clubId,
    ),
    clubIndex: index("match_lineups_club_id_idx").on(table.clubId),
    providerCoachIdPositiveCheck: check(
      "match_lineups_provider_coach_id_positive_check",
      sql`${table.providerCoachId} is null or ${table.providerCoachId} > 0`,
    ),
  }),
);

export const footballMatchLineupEntries = footballSchema.table(
  "match_lineup_entries",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    lineupId: text("lineup_id")
      .notNull()
      .references(() => footballMatchLineups.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    providerPlayerId: integer("provider_player_id"),
    providerPlayerName: text("provider_player_name"),
    playerId: text("player_id").references(() => footballPlayers.id, {
      onDelete: "set null",
    }),
    shirtNumber: integer("shirt_number"),
    providerPosition: text("provider_position"),
    grid: text("grid"),
    providerOrder: integer("provider_order").notNull(),
    providerRaw: jsonb("provider_raw").$type<Record<string, unknown>>().notNull(),
  },
  (table) => ({
    roleOrderUnique: uniqueIndex("match_lineup_entries_role_order_unique").on(
      table.lineupId,
      table.role,
      table.providerOrder,
    ),
    providerPlayerUnique: uniqueIndex(
      "match_lineup_entries_provider_player_unique",
    )
      .on(table.lineupId, table.providerPlayerId)
      .where(sql`${table.providerPlayerId} is not null`),
    playerIndex: index("match_lineup_entries_player_id_idx").on(table.playerId),
    roleCheck: check(
      "match_lineup_entries_role_check",
      sql`${table.role} in ('starter', 'substitute')`,
    ),
    providerOrderNonnegativeCheck: check(
      "match_lineup_entries_provider_order_nonnegative_check",
      sql`${table.providerOrder} >= 0`,
    ),
    providerPlayerIdPositiveCheck: check(
      "match_lineup_entries_provider_player_id_positive_check",
      sql`${table.providerPlayerId} is null or ${table.providerPlayerId} > 0`,
    ),
    providerPlayerNameCheck: check(
      "match_lineup_entries_provider_player_name_check",
      sql`${table.providerPlayerName} is null or btrim(${table.providerPlayerName}) <> ''`,
    ),
    providerPlayerIdentityCheck: check(
      "match_lineup_entries_provider_player_identity_check",
      sql`${table.providerPlayerId} is not null or ${table.providerPlayerName} is not null`,
    ),
  }),
);

export const footballPlayerStatistics = footballSchema.table(
  "player_statistics",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    seasonId: text("season_id").notNull(),
    clubId: text("club_id").notNull(),
    playerId: text("player_id")
      .notNull()
      .references(() => footballPlayers.id, { onDelete: "restrict" }),
    appearances: integer("appearances"),
    lineups: integer("lineups"),
    minutes: integer("minutes"),
    shirtNumber: integer("shirt_number"),
    position: text("position"),
    rating: text("rating"),
    captain: boolean("captain"),
    substitutesIn: integer("substitutes_in"),
    substitutesOut: integer("substitutes_out"),
    substitutesBench: integer("substitutes_bench"),
    shotsTotal: integer("shots_total"),
    shotsOn: integer("shots_on"),
    goalsTotal: integer("goals_total"),
    goalsConceded: integer("goals_conceded"),
    goalsAssists: integer("goals_assists"),
    passesTotal: integer("passes_total"),
    passesKey: integer("passes_key"),
    passesAccuracy: integer("passes_accuracy"),
    tacklesTotal: integer("tackles_total"),
    tacklesBlocks: integer("tackles_blocks"),
    tacklesInterceptions: integer("tackles_interceptions"),
    duelsTotal: integer("duels_total"),
    duelsWon: integer("duels_won"),
    dribblesAttempts: integer("dribbles_attempts"),
    dribblesSuccess: integer("dribbles_success"),
    foulsDrawn: integer("fouls_drawn"),
    foulsCommitted: integer("fouls_committed"),
    cardsYellow: integer("cards_yellow"),
    cardsYellowRed: integer("cards_yellow_red"),
    cardsRed: integer("cards_red"),
    penaltyCommitted: integer("penalty_committed"),
    penaltyScored: integer("penalty_scored"),
    penaltyMissed: integer("penalty_missed"),
    playerRaw: jsonb("player_raw").$type<Record<string, unknown>>().notNull(),
    statisticsRaw: jsonb("statistics_raw")
      .$type<Record<string, unknown>>()
      .notNull(),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
  },
  (table) => ({
    seasonClubPlayerUnique: uniqueIndex(
      "player_statistics_season_club_player_unique",
    ).on(table.seasonId, table.clubId, table.playerId),
    playerIndex: index("player_statistics_player_id_idx").on(table.playerId),
    clubIndex: index("player_statistics_club_id_idx").on(table.clubId),
    seasonFk: foreignKey({
      name: "player_statistics_season_id_seasons_id_fk",
      columns: [table.seasonId],
      foreignColumns: [footballSeasons.id],
    }).onDelete("restrict"),
    seasonClubFk: foreignKey({
      name: "player_statistics_season_club_fk",
      columns: [table.seasonId, table.clubId],
      foreignColumns: [footballSeasonClubs.seasonId, footballSeasonClubs.clubId],
    }).onDelete("restrict"),
  }),
);

export const footballSquadMemberships = footballSchema.table(
  "squad_memberships",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    clubId: text("club_id")
      .notNull()
      .references(() => footballClubs.id, { onDelete: "restrict" }),
    playerId: text("player_id")
      .notNull()
      .references(() => footballPlayers.id, { onDelete: "restrict" }),
    shirtNumber: integer("shirt_number"),
    position: text("position").notNull(),
    providerRaw: jsonb("provider_raw").$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
  },
  (table) => ({
    clubPlayerUnique: uniqueIndex("squad_memberships_club_player_unique").on(
      table.clubId,
      table.playerId,
    ),
    playerIndex: index("squad_memberships_player_id_idx").on(table.playerId),
    shirtNumberNonnegativeCheck: check(
      "squad_memberships_shirt_number_nonnegative_check",
      sql`${table.shirtNumber} is null or ${table.shirtNumber} >= 0`,
    ),
  }),
);
