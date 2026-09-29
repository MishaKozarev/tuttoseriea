import { isDeepStrictEqual } from "node:util";

import type { Pool, PoolClient } from "pg";

import type { ApiFootballClient, ApiFootballResult } from "./api-football/node";
import {
  SERIE_A_CURRENT_SEASON,
  SERIE_A_EXPECTED_CURRENT_CLUBS,
  SERIE_A_PROVIDER_LEAGUE_ID,
} from "./foundation";
import {
  deleteStalePlayerStatistics,
  getSerieAPlayerStatisticsContext,
  upsertPlayerProfile,
  upsertPlayerStatistics,
  type PlayerProfileInput,
  type PlayerStatisticsValues,
  type SerieAPlayerStatisticsContext,
} from "./player-statistics-repository";

type ProviderOccurrence = {
  page: number;
  responseIndex: number;
  statisticsIndex: number;
};

type ParsedPlayerStatistics = PlayerStatisticsValues & {
  providerPlayerId: number;
  providerClubId: number;
  playerProfile: PlayerProfileInput;
  playerRaw: Record<string, unknown>;
  statisticsRaw: Record<string, unknown>;
  occurrence: ProviderOccurrence;
};

type ResolvedPlayerStatistics = ParsedPlayerStatistics & {
  seasonId: string;
  clubId: string;
};

export type SerieAPlayerStatisticsSyncSuccess = {
  status: "success";
  pageCount: number;
  playerCount: number;
  statisticsCount: number;
};

export type SerieAPlayerStatisticsSyncFailure = {
  status: "retry" | "failed";
  errorCode: string;
  message: string;
  retryDelaySeconds?: number;
};

export type SerieAPlayerStatisticsSyncResult =
  | SerieAPlayerStatisticsSyncSuccess
  | SerieAPlayerStatisticsSyncFailure;

type SerieAPlayerStatisticsDatabaseInput =
  | { pool: Pool; transactionClient?: never }
  | { pool?: never; transactionClient: PoolClient };

export type SerieAPlayerStatisticsSyncInput =
  SerieAPlayerStatisticsDatabaseInput & {
    client: ApiFootballClient;
    heartbeat?: () => Promise<void>;
  };

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function positiveInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value > 0
    ? value
    : null;
}

function nullableInteger(value: unknown): number | null | undefined {
  if (value === null) {
    return null;
  }

  return typeof value === "number" && Number.isInteger(value) ? value : undefined;
}

function nullablePositiveInteger(value: unknown): number | null | undefined {
  if (value === null) {
    return null;
  }

  return positiveInteger(value) ?? undefined;
}

function nullableString(value: unknown): string | null | undefined {
  if (value === null) {
    return null;
  }

  return typeof value === "string" ? value : undefined;
}

function nullableBoolean(value: unknown): boolean | null | undefined {
  if (value === null) {
    return null;
  }

  return typeof value === "boolean" ? value : undefined;
}

function requiredNonemptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function isIsoCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) {
    return false;
  }

  const [yearText, monthText, dayText] = value.split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const date = new Date(Date.UTC(year, month - 1, day));

  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function nullableIsoDate(value: unknown): string | null | undefined {
  if (value === null) {
    return null;
  }

  return typeof value === "string" && isIsoCalendarDate(value)
    ? value
    : undefined;
}

function failed(
  errorCode: string,
  message: string,
): SerieAPlayerStatisticsSyncFailure {
  return { status: "failed", errorCode, message };
}

function invalidData(message: string): SerieAPlayerStatisticsSyncFailure {
  return failed("api_football_invalid_player_statistics", message);
}

function providerFailure(
  page: number,
  result: ApiFootballResult<unknown>,
): SerieAPlayerStatisticsSyncFailure {
  if (result.ok) {
    throw new Error("providerFailure received a successful result");
  }

  const retryDelaySeconds = result.error.retryAfterSeconds;

  return {
    status: result.error.retryable ? "retry" : "failed",
    errorCode: `api_football_${result.error.code}`,
    message: `API-Football players request failed for page ${page}: ${result.error.message}`,
    ...(retryDelaySeconds !== undefined ? { retryDelaySeconds } : {}),
  };
}

function parsePlayerProfile(
  playerRaw: Record<string, unknown>,
): PlayerProfileInput | null {
  const birth = playerRaw.birth;

  if (!isRecord(birth)) {
    return null;
  }

  const providerPlayerId = positiveInteger(playerRaw.id);
  const providerName = requiredNonemptyString(playerRaw.name);
  const firstname = nullableString(playerRaw.firstname);
  const lastname = nullableString(playerRaw.lastname);
  const age = nullablePositiveInteger(playerRaw.age);
  const birthDate = nullableIsoDate(birth.date);
  const birthPlace = nullableString(birth.place);
  const birthCountry = nullableString(birth.country);
  const nationality = nullableString(playerRaw.nationality);
  const height = nullableString(playerRaw.height);
  const weight = nullableString(playerRaw.weight);
  const injured = nullableBoolean(playerRaw.injured);
  const providerPhotoUrl = nullableString(playerRaw.photo);

  if (
    providerPlayerId === null ||
    providerName === null ||
    firstname === undefined ||
    lastname === undefined ||
    age === undefined ||
    birthDate === undefined ||
    birthPlace === undefined ||
    birthCountry === undefined ||
    nationality === undefined ||
    height === undefined ||
    weight === undefined ||
    injured === undefined ||
    providerPhotoUrl === undefined
  ) {
    return null;
  }

  return {
    providerPlayerId,
    providerName,
    firstname,
    lastname,
    age,
    birthDate,
    birthPlace,
    birthCountry,
    nationality,
    height,
    weight,
    injured,
    providerPhotoUrl,
  };
}

function parseStatisticsValues(
  statisticsRaw: Record<string, unknown>,
): (PlayerStatisticsValues & { providerClubId: number }) | null {
  const team = statisticsRaw.team;
  const league = statisticsRaw.league;
  const games = statisticsRaw.games;
  const substitutes = statisticsRaw.substitutes;
  const shots = statisticsRaw.shots;
  const goals = statisticsRaw.goals;
  const passes = statisticsRaw.passes;
  const tackles = statisticsRaw.tackles;
  const duels = statisticsRaw.duels;
  const dribbles = statisticsRaw.dribbles;
  const fouls = statisticsRaw.fouls;
  const cards = statisticsRaw.cards;
  const penalty = statisticsRaw.penalty;

  if (
    !isRecord(team) ||
    !isRecord(league) ||
    !isRecord(games) ||
    !isRecord(substitutes) ||
    !isRecord(shots) ||
    !isRecord(goals) ||
    !isRecord(passes) ||
    !isRecord(tackles) ||
    !isRecord(duels) ||
    !isRecord(dribbles) ||
    !isRecord(fouls) ||
    !isRecord(cards) ||
    !isRecord(penalty)
  ) {
    return null;
  }

  const providerClubId = positiveInteger(team.id);

  if (
    providerClubId === null ||
    league.id !== SERIE_A_PROVIDER_LEAGUE_ID ||
    league.season !== SERIE_A_CURRENT_SEASON
  ) {
    return null;
  }

  const values: PlayerStatisticsValues = {
    appearances: nullableInteger(games.appearences) as number | null,
    lineups: nullableInteger(games.lineups) as number | null,
    minutes: nullableInteger(games.minutes) as number | null,
    shirtNumber: nullableInteger(games.number) as number | null,
    position: nullableString(games.position) as string | null,
    rating: nullableString(games.rating) as string | null,
    captain: nullableBoolean(games.captain) as boolean | null,
    substitutesIn: nullableInteger(substitutes.in) as number | null,
    substitutesOut: nullableInteger(substitutes.out) as number | null,
    substitutesBench: nullableInteger(substitutes.bench) as number | null,
    shotsTotal: nullableInteger(shots.total) as number | null,
    shotsOn: nullableInteger(shots.on) as number | null,
    goalsTotal: nullableInteger(goals.total) as number | null,
    goalsConceded: nullableInteger(goals.conceded) as number | null,
    goalsAssists: nullableInteger(goals.assists) as number | null,
    passesTotal: nullableInteger(passes.total) as number | null,
    passesKey: nullableInteger(passes.key) as number | null,
    passesAccuracy: nullableInteger(passes.accuracy) as number | null,
    tacklesTotal: nullableInteger(tackles.total) as number | null,
    tacklesBlocks: nullableInteger(tackles.blocks) as number | null,
    tacklesInterceptions: nullableInteger(tackles.interceptions) as number | null,
    duelsTotal: nullableInteger(duels.total) as number | null,
    duelsWon: nullableInteger(duels.won) as number | null,
    dribblesAttempts: nullableInteger(dribbles.attempts) as number | null,
    dribblesSuccess: nullableInteger(dribbles.success) as number | null,
    foulsDrawn: nullableInteger(fouls.drawn) as number | null,
    foulsCommitted: nullableInteger(fouls.committed) as number | null,
    cardsYellow: nullableInteger(cards.yellow) as number | null,
    cardsYellowRed: nullableInteger(cards.yellowred) as number | null,
    cardsRed: nullableInteger(cards.red) as number | null,
    penaltyCommitted: nullableInteger(penalty.commited) as number | null,
    penaltyScored: nullableInteger(penalty.scored) as number | null,
    penaltyMissed: nullableInteger(penalty.missed) as number | null,
  };

  if (Object.values(values).some((value) => value === undefined)) {
    return null;
  }

  return { providerClubId, ...values };
}

function occurrenceLabel(occurrence: ProviderOccurrence) {
  return {
    page: occurrence.page,
    response_index: occurrence.responseIndex,
    statistics_index: occurrence.statisticsIndex,
  };
}

function parsePage(
  data: unknown,
  page: number,
): ParsedPlayerStatistics[] | SerieAPlayerStatisticsSyncFailure {
  if (!Array.isArray(data)) {
    return invalidData("API-Football returned a players response that is not an array.");
  }

  const rows: ParsedPlayerStatistics[] = [];

  for (const [responseIndex, rawEntry] of data.entries()) {
    if (!isRecord(rawEntry) || !isRecord(rawEntry.player) || !Array.isArray(rawEntry.statistics)) {
      return invalidData("API-Football returned a malformed player statistics entry.");
    }

    const playerRaw = rawEntry.player;
    const playerProfile = parsePlayerProfile(playerRaw);

    if (!playerProfile || rawEntry.statistics.length === 0) {
      return invalidData("API-Football returned invalid player profile or statistics data.");
    }

    for (const [statisticsIndex, rawStatistics] of rawEntry.statistics.entries()) {
      if (!isRecord(rawStatistics)) {
        return invalidData("API-Football returned a statistics entry that is not an object.");
      }

      const parsed = parseStatisticsValues(rawStatistics);

      if (!parsed) {
        return invalidData("API-Football returned malformed or out-of-scope player statistics.");
      }

      rows.push({
        ...parsed,
        providerPlayerId: playerProfile.providerPlayerId,
        playerProfile,
        playerRaw,
        statisticsRaw: rawStatistics,
        occurrence: { page, responseIndex, statisticsIndex },
      });
    }
  }

  return rows;
}

function validateGlobalConsistency(
  rows: ParsedPlayerStatistics[],
): ParsedPlayerStatistics[] | SerieAPlayerStatisticsSyncFailure {
  const playerProfiles = new Map<
    number,
    { playerRaw: Record<string, unknown>; occurrence: ProviderOccurrence }
  >();
  const statistics = new Map<
    string,
    {
      row: ParsedPlayerStatistics;
    }
  >();

  for (const row of rows) {
    const existingPlayer = playerProfiles.get(row.providerPlayerId);

    if (existingPlayer && !isDeepStrictEqual(existingPlayer.playerRaw, row.playerRaw)) {
      console.error("api_football_conflicting_player", {
        player_id: row.providerPlayerId,
        first_occurrence: occurrenceLabel(existingPlayer.occurrence),
        conflicting_occurrence: occurrenceLabel(row.occurrence),
        first_player: existingPlayer.playerRaw,
        conflicting_player: row.playerRaw,
      });

      return failed(
        "api_football_conflicting_player",
        "API-Football returned conflicting complete profiles for one player.",
      );
    }

    if (!existingPlayer) {
      playerProfiles.set(row.providerPlayerId, {
        playerRaw: row.playerRaw,
        occurrence: row.occurrence,
      });
    }

    const identity = `${row.providerPlayerId}:${row.providerClubId}:${SERIE_A_PROVIDER_LEAGUE_ID}:${SERIE_A_CURRENT_SEASON}`;
    const existingStatistics = statistics.get(identity);

    if (existingStatistics) {
      if (
        !isDeepStrictEqual(existingStatistics.row.playerRaw, row.playerRaw) ||
        !isDeepStrictEqual(existingStatistics.row.statisticsRaw, row.statisticsRaw)
      ) {
        console.error("api_football_duplicate_player_statistics", {
          player_id: row.providerPlayerId,
          team_id: row.providerClubId,
          first_occurrence: occurrenceLabel(existingStatistics.row.occurrence),
          conflicting_occurrence: occurrenceLabel(row.occurrence),
          first_player: existingStatistics.row.playerRaw,
          first_statistics: existingStatistics.row.statisticsRaw,
          conflicting_player: row.playerRaw,
          conflicting_statistics: row.statisticsRaw,
        });

        return failed(
          "api_football_duplicate_player_statistics",
          "API-Football returned conflicting duplicate player statistics.",
        );
      }

      continue;
    }

    statistics.set(identity, { row });
  }

  return [...statistics.values()].map(({ row }) => row);
}

async function fetchAllPages(
  client: ApiFootballClient,
  heartbeat?: () => Promise<void>,
): Promise<
  | { rows: ParsedPlayerStatistics[]; pageCount: number }
  | SerieAPlayerStatisticsSyncFailure
> {
  const rows: ParsedPlayerStatistics[] = [];
  let expectedTotalPages: number | null = null;

  for (let page = 1; expectedTotalPages === null || page <= expectedTotalPages; page += 1) {
    await heartbeat?.();

    const result = await client.get<unknown>("/players", {
      league: SERIE_A_PROVIDER_LEAGUE_ID,
      season: SERIE_A_CURRENT_SEASON,
      page,
    });

    if (!result.ok) {
      return providerFailure(page, result);
    }

    if (
      result.paging.current !== page ||
      !Number.isInteger(result.paging.total) ||
      result.paging.total <= 0 ||
      (expectedTotalPages !== null && result.paging.total !== expectedTotalPages)
    ) {
      return failed(
        "api_football_player_statistics_paging",
        "API-Football returned inconsistent player statistics paging metadata.",
      );
    }

    expectedTotalPages ??= result.paging.total;

    const pageRows = parsePage(result.data, page);

    if ("status" in pageRows) {
      return pageRows;
    }

    rows.push(...pageRows);
  }

  const consistentRows = validateGlobalConsistency(rows);

  if ("status" in consistentRows) {
    return consistentRows;
  }

  return { rows: consistentRows, pageCount: expectedTotalPages ?? 0 };
}

function resolveStatistics(
  context: SerieAPlayerStatisticsContext,
  rows: ParsedPlayerStatistics[],
): ResolvedPlayerStatistics[] | SerieAPlayerStatisticsSyncFailure {
  if (context.clubIdsByProviderId.size !== SERIE_A_EXPECTED_CURRENT_CLUBS) {
    return failed(
      "football_season_membership_incomplete",
      `Persisted Serie A season membership must contain exactly ${SERIE_A_EXPECTED_CURRENT_CLUBS} clubs before syncing player statistics.`,
    );
  }

  const resolved: ResolvedPlayerStatistics[] = [];

  for (const row of rows) {
    const clubId = context.clubIdsByProviderId.get(row.providerClubId);

    if (!clubId) {
      return failed(
        "api_football_unknown_statistics_team",
        `API-Football returned player statistics for unknown team ${row.providerClubId}.`,
      );
    }

    resolved.push({ ...row, seasonId: context.seasonId, clubId });
  }

  return resolved;
}

async function persistSnapshot(
  client: PoolClient,
  seasonId: string,
  rows: ResolvedPlayerStatistics[],
  pageCount: number,
  heartbeat?: () => Promise<void>,
): Promise<SerieAPlayerStatisticsSyncSuccess> {
  const playerIds = new Map<number, string>();
  const identities: { clubId: string; playerId: string }[] = [];

  for (const [index, row] of rows.entries()) {
    let playerId = playerIds.get(row.providerPlayerId);

    if (!playerId) {
      playerId = await upsertPlayerProfile(client, row.playerProfile);
      playerIds.set(row.providerPlayerId, playerId);
    }

    await upsertPlayerStatistics(client, {
      ...row,
      playerId,
    });
    identities.push({ clubId: row.clubId, playerId });

    if ((index + 1) % 100 === 0) {
      await heartbeat?.();
    }
  }

  await heartbeat?.();

  await deleteStalePlayerStatistics(client, seasonId, identities);

  return {
    status: "success",
    pageCount,
    playerCount: playerIds.size,
    statisticsCount: rows.length,
  };
}

export async function syncSerieAPlayerStatistics(
  input: SerieAPlayerStatisticsSyncInput,
): Promise<SerieAPlayerStatisticsSyncResult> {
  const fetched = await fetchAllPages(input.client, input.heartbeat);

  if ("status" in fetched) {
    return fetched;
  }

  if (fetched.rows.length === 0) {
    return invalidData(
      "API-Football returned an empty complete player statistics snapshot.",
    );
  }

  await input.heartbeat?.();

  const queryable = input.transactionClient ?? input.pool;
  const context = await getSerieAPlayerStatisticsContext(queryable);

  if (!context) {
    return failed(
      "football_season_not_found",
      "Persisted Serie A competition, season and clubs are required before syncing player statistics.",
    );
  }

  const resolved = resolveStatistics(context, fetched.rows);

  if ("status" in resolved) {
    return resolved;
  }

  await input.heartbeat?.();

  if (input.transactionClient) {
    return persistSnapshot(
      input.transactionClient,
      context.seasonId,
      resolved,
      fetched.pageCount,
      input.heartbeat,
    );
  }

  const client = await input.pool.connect();
  let transactionStarted = false;

  try {
    await client.query("begin");
    transactionStarted = true;

    const result = await persistSnapshot(
      client,
      context.seasonId,
      resolved,
      fetched.pageCount,
      input.heartbeat,
    );

    await client.query("commit");
    transactionStarted = false;

    return result;
  } catch (error) {
    if (transactionStarted) {
      await client.query("rollback");
    }

    throw error;
  } finally {
    client.release();
  }
}
