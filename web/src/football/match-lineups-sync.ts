import type { Pool, PoolClient } from "pg";

import type { ApiFootballClient, ApiFootballResult } from "./api-football/node";
import {
  isMatchActivityExpectedState,
  type NormalizedFixtureState,
} from "./api-football/fixture-status";
import {
  getCurrentSerieAMatchLineupContext,
  replaceMatchLineups,
  resolveApiFootballLineupPlayerIds,
  type InsertMatchLineupEntryInput,
  type MatchLineupContext,
  type MatchLineupRole,
  type ReplaceMatchLineupInput,
} from "./match-lineups-repository";

type ParsedLineupEntry = Omit<InsertMatchLineupEntryInput, "playerId">;

type ParsedMatchLineup = Omit<ReplaceMatchLineupInput, "clubId" | "entries"> & {
  providerClubId: number;
  entries: ParsedLineupEntry[];
  starterCount: number;
  substituteCount: number;
};

export type MatchLineupsEmptySnapshotAnomaly = {
  code: "api_football_empty_match_lineups";
  matchId: string;
  providerFixtureId: number;
  matchStatus: NormalizedFixtureState;
  providerResultCount: 0;
  persistedSides: Array<"home" | "away">;
};

export type MatchLineupsPartialSnapshotAnomaly = {
  code: "api_football_partial_match_lineups";
  matchId: string;
  providerFixtureId: number;
  receivedProviderTeamIds: number[];
  missingSide: "home" | "away";
  missingProviderTeamId: number;
};

export type MatchLineupsStarterCountAnomaly = {
  code: "api_football_unexpected_match_lineup_starter_count";
  matchId: string;
  providerFixtureId: number;
  teams: Array<{
    providerTeamId: number;
    starterCount: number;
  }>;
};

export type MatchLineupsSyncAnomaly =
  | MatchLineupsEmptySnapshotAnomaly
  | MatchLineupsPartialSnapshotAnomaly
  | MatchLineupsStarterCountAnomaly;

export type MatchLineupsSyncSuccess = {
  status: "success";
  matchId: string;
  providerFixtureId: number;
  receivedTeamCount: number;
  starterCount: number;
  substituteCount: number;
  entryCount: number;
  resolvedPlayerCount: number;
  unresolvedPlayerCount: number;
  anomalies: MatchLineupsSyncAnomaly[];
};

export type MatchLineupsSyncFailure = {
  status: "retry" | "failed";
  errorCode: string;
  message: string;
  retryDelaySeconds?: number;
};

export type MatchLineupsSyncResult =
  | MatchLineupsSyncSuccess
  | MatchLineupsSyncFailure;

type MatchLineupsDatabaseInput =
  | {
      pool: Pool;
      transactionClient?: never;
    }
  | {
      pool?: never;
      transactionClient: PoolClient;
    };

export type MatchLineupsSyncInput = MatchLineupsDatabaseInput & {
  client: ApiFootballClient;
  matchId: string;
  heartbeat?: () => Promise<void>;
};

type ParseResult<T> = { ok: true; value: T } | { ok: false };

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function parseNullableString(value: unknown): ParseResult<string | null> {
  if (value === undefined || value === null) {
    return { ok: true, value: null };
  }

  return typeof value === "string"
    ? { ok: true, value }
    : { ok: false };
}

function parseNullablePositiveInteger(
  value: unknown,
): ParseResult<number | null> {
  if (value === undefined || value === null) {
    return { ok: true, value: null };
  }

  return isPositiveInteger(value)
    ? { ok: true, value }
    : { ok: false };
}

function parseNullableInteger(value: unknown): ParseResult<number | null> {
  if (value === undefined || value === null) {
    return { ok: true, value: null };
  }

  return typeof value === "number" && Number.isInteger(value)
    ? { ok: true, value }
    : { ok: false };
}

function failed(errorCode: string, message: string): MatchLineupsSyncFailure {
  return { status: "failed", errorCode, message };
}

function invalidData(message: string): MatchLineupsSyncFailure {
  return failed("api_football_invalid_match_lineups", message);
}

function providerFailure(
  result: ApiFootballResult<unknown>,
): MatchLineupsSyncFailure {
  if (result.ok) {
    throw new Error("providerFailure received a successful result");
  }

  return {
    status: result.error.retryable ? "retry" : "failed",
    errorCode: `api_football_${result.error.code}`,
    message: `API-Football fixtures/lineups request failed: ${result.error.message}`,
    ...(result.error.retryAfterSeconds !== undefined
      ? { retryDelaySeconds: result.error.retryAfterSeconds }
      : {}),
  };
}

function parseEntry(
  rawEntry: unknown,
  role: MatchLineupRole,
  providerOrder: number,
): ParsedLineupEntry | MatchLineupsSyncFailure {
  if (!isRecord(rawEntry) || !isRecord(rawEntry.player)) {
    return invalidData("API-Football returned a malformed Match Lineup entry.");
  }

  const player = rawEntry.player;
  const providerPlayerId = parseNullablePositiveInteger(player.id);
  const providerPlayerName = parseNullableString(player.name);
  const shirtNumber = parseNullableInteger(player.number);
  const providerPosition = parseNullableString(player.pos);
  const grid = parseNullableString(player.grid);

  if (
    !providerPlayerId.ok ||
    !providerPlayerName.ok ||
    !shirtNumber.ok ||
    !providerPosition.ok ||
    !grid.ok ||
    (providerPlayerName.value !== null && !providerPlayerName.value.trim()) ||
    (providerPlayerId.value === null && providerPlayerName.value === null)
  ) {
    return invalidData("API-Football returned malformed Match Lineup player data.");
  }

  return {
    role,
    providerPlayerId: providerPlayerId.value,
    providerPlayerName: providerPlayerName.value,
    shirtNumber: shirtNumber.value,
    providerPosition: providerPosition.value,
    grid: grid.value,
    providerOrder,
    providerRaw: rawEntry,
  };
}

function parseEntries(
  rawEntries: unknown[],
  role: MatchLineupRole,
): ParsedLineupEntry[] | MatchLineupsSyncFailure {
  const entries: ParsedLineupEntry[] = [];

  for (const [providerOrder, rawEntry] of rawEntries.entries()) {
    const parsed = parseEntry(rawEntry, role, providerOrder);

    if ("errorCode" in parsed) {
      return parsed;
    }

    entries.push(parsed);
  }

  return entries;
}

function parseLineup(
  rawLineup: unknown,
): ParsedMatchLineup | MatchLineupsSyncFailure {
  if (!isRecord(rawLineup) || !isRecord(rawLineup.team)) {
    return invalidData("API-Football returned a Match Lineup that is not an object.");
  }

  const team = rawLineup.team;
  const providerClubId = team.id;
  const teamName = parseNullableString(team.name);
  const teamLogo = parseNullableString(team.logo);
  const formation = parseNullableString(rawLineup.formation);

  if (
    !isPositiveInteger(providerClubId) ||
    !teamName.ok ||
    !teamLogo.ok ||
    !formation.ok ||
    !Array.isArray(rawLineup.startXI) ||
    !Array.isArray(rawLineup.substitutes)
  ) {
    return invalidData("API-Football returned malformed Match Lineup team data.");
  }

  let providerColors: Record<string, unknown> | null = null;

  if (team.colors !== undefined && team.colors !== null) {
    if (!isRecord(team.colors)) {
      return invalidData("API-Football returned malformed Match Lineup colors.");
    }

    providerColors = team.colors;
  }

  let providerCoachId: number | null = null;
  let providerCoachName: string | null = null;
  let providerCoachPhotoUrl: string | null = null;

  if (rawLineup.coach !== undefined && rawLineup.coach !== null) {
    if (!isRecord(rawLineup.coach)) {
      return invalidData("API-Football returned malformed Match Lineup coach data.");
    }

    const coachId = parseNullablePositiveInteger(rawLineup.coach.id);
    const coachName = parseNullableString(rawLineup.coach.name);
    const coachPhoto = parseNullableString(rawLineup.coach.photo);

    if (!coachId.ok || !coachName.ok || !coachPhoto.ok) {
      return invalidData("API-Football returned malformed Match Lineup coach fields.");
    }

    providerCoachId = coachId.value;
    providerCoachName = coachName.value;
    providerCoachPhotoUrl = coachPhoto.value;
  }

  const starters = parseEntries(rawLineup.startXI, "starter");

  if ("errorCode" in starters) {
    return starters;
  }

  const substitutes = parseEntries(rawLineup.substitutes, "substitute");

  if ("errorCode" in substitutes) {
    return substitutes;
  }

  return {
    providerClubId,
    formation: formation.value,
    providerCoachId,
    providerCoachName,
    providerCoachPhotoUrl,
    providerColors,
    providerRaw: rawLineup,
    entries: [...starters, ...substitutes],
    starterCount: starters.length,
    substituteCount: substitutes.length,
  };
}

function resolveClubId(
  context: MatchLineupContext,
  providerClubId: number,
): string | null {
  if (providerClubId === context.homeClub.providerClubId) {
    return context.homeClub.id;
  }

  if (providerClubId === context.awayClub.providerClubId) {
    return context.awayClub.id;
  }

  return null;
}

function parseLineups(
  data: unknown,
  results: number,
  paging: { current: number; total: number },
  context: MatchLineupContext,
): ParsedMatchLineup[] | MatchLineupsSyncFailure {
  if (!Array.isArray(data)) {
    return invalidData("API-Football returned a Match Lineups response that is not an array.");
  }

  if (
    !Number.isInteger(results) ||
    results < 0 ||
    results !== data.length ||
    !Number.isInteger(paging.current) ||
    paging.current < 0 ||
    !Number.isInteger(paging.total) ||
    paging.total < 0
  ) {
    return invalidData("API-Football returned an inconsistent Match Lineups envelope.");
  }

  const lineups: ParsedMatchLineup[] = [];
  const seenTeams = new Set<number>();
  const playerTeams = new Map<number, number>();

  for (const rawLineup of data) {
    const parsed = parseLineup(rawLineup);

    if ("errorCode" in parsed) {
      return parsed;
    }

    if (!resolveClubId(context, parsed.providerClubId)) {
      return failed(
        "api_football_match_lineup_team_mismatch",
        `API-Football returned Match Lineup team ${parsed.providerClubId} outside the Match participants.`,
      );
    }

    if (seenTeams.has(parsed.providerClubId)) {
      return failed(
        "api_football_duplicate_match_lineup_team",
        `API-Football returned duplicate Match Lineup team ${parsed.providerClubId}.`,
      );
    }

    seenTeams.add(parsed.providerClubId);
    const teamPlayers = new Set<number>();

    for (const entry of parsed.entries) {
      const providerPlayerId = entry.providerPlayerId;

      if (providerPlayerId === null) {
        continue;
      }

      if (teamPlayers.has(providerPlayerId)) {
        return failed(
          "api_football_duplicate_match_lineup_player",
          `API-Football returned duplicate Player ${providerPlayerId} for Match Lineup team ${parsed.providerClubId}.`,
        );
      }

      const previousTeam = playerTeams.get(providerPlayerId);

      if (previousTeam !== undefined && previousTeam !== parsed.providerClubId) {
        return failed(
          "api_football_match_lineup_player_team_conflict",
          `API-Football returned Player ${providerPlayerId} for both Match participants.`,
        );
      }

      teamPlayers.add(providerPlayerId);
      playerTeams.set(providerPlayerId, parsed.providerClubId);
    }

    lineups.push(parsed);
  }

  return lineups;
}

function persistedSides(
  context: MatchLineupContext,
): Array<"home" | "away"> {
  const persisted = new Set(context.persistedLineupClubIds);
  const sides: Array<"home" | "away"> = [];

  if (persisted.has(context.homeClub.id)) {
    sides.push("home");
  }

  if (persisted.has(context.awayClub.id)) {
    sides.push("away");
  }

  return sides;
}

function buildAnomalies(
  context: MatchLineupContext,
  lineups: readonly ParsedMatchLineup[],
): MatchLineupsSyncAnomaly[] {
  const anomalies: MatchLineupsSyncAnomaly[] = [];

  if (lineups.length === 0) {
    const existingSides = persistedSides(context);

    if (
      existingSides.length > 0 ||
      isMatchActivityExpectedState(context.status)
    ) {
      anomalies.push({
        code: "api_football_empty_match_lineups",
        matchId: context.matchId,
        providerFixtureId: context.providerFixtureId,
        matchStatus: context.status,
        providerResultCount: 0,
        persistedSides: existingSides,
      });
    }

    return anomalies;
  }

  if (lineups.length === 1) {
    const received = lineups[0]!;
    const missingHome = received.providerClubId !== context.homeClub.providerClubId;

    anomalies.push({
      code: "api_football_partial_match_lineups",
      matchId: context.matchId,
      providerFixtureId: context.providerFixtureId,
      receivedProviderTeamIds: [received.providerClubId],
      missingSide: missingHome ? "home" : "away",
      missingProviderTeamId: missingHome
        ? context.homeClub.providerClubId
        : context.awayClub.providerClubId,
    });
  }

  const unexpectedStarterCounts = lineups
    .filter((lineup) => lineup.starterCount !== 11)
    .map((lineup) => ({
      providerTeamId: lineup.providerClubId,
      starterCount: lineup.starterCount,
    }));

  if (unexpectedStarterCounts.length > 0) {
    anomalies.push({
      code: "api_football_unexpected_match_lineup_starter_count",
      matchId: context.matchId,
      providerFixtureId: context.providerFixtureId,
      teams: unexpectedStarterCounts,
    });
  }

  return anomalies;
}

async function resolveLineups(
  queryable: Pick<Pool | PoolClient, "query">,
  context: MatchLineupContext,
  lineups: readonly ParsedMatchLineup[],
): Promise<ReplaceMatchLineupInput[]> {
  const providerPlayerIds = [
    ...new Set(
      lineups.flatMap((lineup) =>
        lineup.entries.flatMap((entry) =>
          entry.providerPlayerId === null ? [] : [entry.providerPlayerId],
        ),
      ),
    ),
  ].sort((left, right) => left - right);
  const playerIds = await resolveApiFootballLineupPlayerIds(
    queryable,
    providerPlayerIds,
  );

  return lineups.map((lineup) => ({
    clubId: resolveClubId(context, lineup.providerClubId)!,
    formation: lineup.formation,
    providerCoachId: lineup.providerCoachId,
    providerCoachName: lineup.providerCoachName,
    providerCoachPhotoUrl: lineup.providerCoachPhotoUrl,
    providerColors: lineup.providerColors,
    providerRaw: lineup.providerRaw,
    entries: lineup.entries.map((entry) => ({
      ...entry,
      playerId:
        entry.providerPlayerId === null
          ? null
          : playerIds.get(entry.providerPlayerId) ?? null,
    })),
  }));
}

function success(
  context: MatchLineupContext,
  lineups: readonly ReplaceMatchLineupInput[],
  anomalies: MatchLineupsSyncAnomaly[],
): MatchLineupsSyncSuccess {
  const entries = lineups.flatMap((lineup) => lineup.entries);

  return {
    status: "success",
    matchId: context.matchId,
    providerFixtureId: context.providerFixtureId,
    receivedTeamCount: lineups.length,
    starterCount: entries.filter((entry) => entry.role === "starter").length,
    substituteCount: entries.filter((entry) => entry.role === "substitute").length,
    entryCount: entries.length,
    resolvedPlayerCount: entries.filter((entry) => entry.playerId !== null).length,
    unresolvedPlayerCount: entries.filter((entry) => entry.playerId === null).length,
    anomalies,
  };
}

export async function syncMatchLineups(
  input: MatchLineupsSyncInput,
): Promise<MatchLineupsSyncResult> {
  const queryable = input.transactionClient ?? input.pool;
  const context = await getCurrentSerieAMatchLineupContext(
    queryable,
    input.matchId,
  );

  if (!context) {
    return failed(
      "football_match_not_found",
      "The requested current Serie A Match was not found.",
    );
  }

  const providerResult = await input.client.get<unknown>("/fixtures/lineups", {
    fixture: context.providerFixtureId,
  });

  if (!providerResult.ok) {
    return providerFailure(providerResult);
  }

  const parsed = parseLineups(
    providerResult.data,
    providerResult.results,
    providerResult.paging,
    context,
  );

  if ("errorCode" in parsed) {
    return parsed;
  }

  const anomalies = buildAnomalies(context, parsed);
  const resolved = await resolveLineups(queryable, context, parsed);

  await input.heartbeat?.();

  if (resolved.length === 0) {
    return success(context, resolved, anomalies);
  }

  if (input.transactionClient) {
    await replaceMatchLineups(input.transactionClient, context.matchId, resolved);
    return success(context, resolved, anomalies);
  }

  const client = await input.pool.connect();
  let transactionStarted = false;

  try {
    await client.query("begin");
    transactionStarted = true;

    await replaceMatchLineups(client, context.matchId, resolved);

    await client.query("commit");
    transactionStarted = false;

    return success(context, resolved, anomalies);
  } catch (error) {
    if (transactionStarted) {
      await client.query("rollback");
    }

    throw error;
  } finally {
    client.release();
  }
}
