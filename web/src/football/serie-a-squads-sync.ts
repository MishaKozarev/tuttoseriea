import { isDeepStrictEqual } from "node:util";

import type { Pool, PoolClient } from "pg";

import type { ApiFootballClient, ApiFootballResult } from "./api-football/node";
import { SERIE_A_EXPECTED_CURRENT_CLUBS } from "./foundation";
import {
  deleteStaleSquadMemberships,
  getSerieASquadScope,
  upsertPlayer,
  upsertSquadMembership,
  type SerieASquadClub,
  type SerieASquadScope,
  type UpsertPlayerInput,
} from "./squads-repository";

type ParsedSquadPlayer = UpsertPlayerInput & {
  shirtNumber: number | null;
  position: string;
  providerRaw: Record<string, unknown>;
};

type ParsedClubSquad = {
  club: SerieASquadClub;
  players: ParsedSquadPlayer[];
};

export type SerieASquadsSyncSuccess = {
  status: "success";
  clubCount: number;
  playerCount: number;
  membershipCount: number;
};

export type SerieASquadsSyncFailure = {
  status: "retry" | "failed";
  errorCode: string;
  message: string;
  retryDelaySeconds?: number;
};

export type SerieASquadsSyncResult = SerieASquadsSyncSuccess | SerieASquadsSyncFailure;

type SerieASquadsDatabaseInput =
  | {
      pool: Pool;
      transactionClient?: never;
    }
  | {
      pool?: never;
      transactionClient: PoolClient;
    };

export type SerieASquadsSyncInput = SerieASquadsDatabaseInput & {
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

function optionalPositiveInteger(value: unknown): number | null | undefined {
  if (value === null || value === undefined) {
    return null;
  }

  return positiveInteger(value) ?? undefined;
}

function nullableNonnegativeInteger(value: unknown): number | null | undefined {
  if (value === null) {
    return null;
  }

  return typeof value === "number" && Number.isInteger(value) && value >= 0
    ? value
    : undefined;
}

function optionalNonemptyString(value: unknown): string | null | undefined {
  if (value === null || value === undefined) {
    return null;
  }

  return typeof value === "string" && value.trim() ? value : undefined;
}

function requiredNonemptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function failed(errorCode: string, message: string): SerieASquadsSyncFailure {
  return { status: "failed", errorCode, message };
}

function providerFailure(
  providerClubId: number,
  result: ApiFootballResult<unknown>,
): SerieASquadsSyncFailure {
  if (result.ok) {
    throw new Error("providerFailure received a successful result");
  }

  const retryDelaySeconds = result.error.retryAfterSeconds;

  return {
    status: result.error.retryable ? "retry" : "failed",
    errorCode: `api_football_${result.error.code}`,
    message: `API-Football players/squads request failed for team ${providerClubId}: ${result.error.message}`,
    ...(retryDelaySeconds !== undefined ? { retryDelaySeconds } : {}),
  };
}

function parsePlayer(rawPlayer: unknown): ParsedSquadPlayer | SerieASquadsSyncFailure {
  if (!isRecord(rawPlayer)) {
    return failed(
      "api_football_malformed_squad_player",
      "API-Football returned a squad player that is not an object.",
    );
  }

  const providerPlayerId = positiveInteger(rawPlayer.id);
  const providerName = requiredNonemptyString(rawPlayer.name);
  const age = optionalPositiveInteger(rawPlayer.age);
  const shirtNumber = nullableNonnegativeInteger(rawPlayer.number);
  const position = requiredNonemptyString(rawPlayer.position);
  const providerPhotoUrl = optionalNonemptyString(rawPlayer.photo);

  if (
    providerPlayerId === null ||
    providerName === null ||
    age === undefined ||
    shirtNumber === undefined ||
    position === null ||
    providerPhotoUrl === undefined
  ) {
    return failed(
      "api_football_malformed_squad_player",
      "API-Football returned malformed current squad player data.",
    );
  }

  return {
    providerPlayerId,
    providerName,
    age,
    providerPhotoUrl,
    shirtNumber,
    position,
    providerRaw: rawPlayer,
  };
}

function parseSquadResponse(
  data: unknown,
  club: SerieASquadClub,
): ParsedClubSquad | SerieASquadsSyncFailure {
  if (!Array.isArray(data) || data.length !== 1 || !isRecord(data[0])) {
    return failed(
      "api_football_malformed_squad_response",
      "API-Football returned an unexpected current squad response structure.",
    );
  }

  const team = data[0].team;
  const players = data[0].players;

  if (!isRecord(team) || positiveInteger(team.id) !== club.providerClubId) {
    return failed(
      "api_football_squad_team_mismatch",
      "API-Football returned a current squad for an unexpected team.",
    );
  }

  if (!Array.isArray(players)) {
    return failed(
      "api_football_malformed_squad_response",
      "API-Football returned a current squad without a players array.",
    );
  }

  if (players.length === 0) {
    return failed(
      "api_football_empty_squad",
      "API-Football returned an empty current squad.",
    );
  }

  const playersByProviderId = new Map<number, Record<string, unknown>>();
  const parsedPlayers: ParsedSquadPlayer[] = [];

  for (const rawPlayer of players) {
    const providerPlayerId = isRecord(rawPlayer) ? positiveInteger(rawPlayer.id) : null;
    const existingPlayer =
      providerPlayerId === null ? undefined : playersByProviderId.get(providerPlayerId);

    if (existingPlayer) {
      if (isDeepStrictEqual(existingPlayer, rawPlayer)) {
        continue;
      }

      console.error("api_football_duplicate_squad_player", {
        team_id: club.providerClubId,
        player_id: providerPlayerId,
        first_player: existingPlayer,
        conflicting_player: rawPlayer,
      });

      return failed(
        "api_football_duplicate_squad_player",
        "API-Football returned conflicting duplicate player data inside one current squad.",
      );
    }

    const parsed = parsePlayer(rawPlayer);

    if ("errorCode" in parsed) {
      return parsed;
    }

    playersByProviderId.set(parsed.providerPlayerId, parsed.providerRaw);
    parsedPlayers.push(parsed);
  }

  return { club, players: parsedPlayers };
}

async function fetchSquads(
  client: ApiFootballClient,
  scope: SerieASquadScope,
  heartbeat?: () => Promise<void>,
): Promise<ParsedClubSquad[] | SerieASquadsSyncFailure> {
  const squads: ParsedClubSquad[] = [];

  for (const club of scope.clubs) {
    await heartbeat?.();

    const result = await client.get<unknown>("/players/squads", {
      team: club.providerClubId,
    });

    if (!result.ok) {
      return providerFailure(club.providerClubId, result);
    }

    const squad = parseSquadResponse(result.data, club);

    if ("errorCode" in squad) {
      return squad;
    }

    squads.push(squad);
  }

  return squads;
}

async function persistSquads(
  client: PoolClient,
  squads: ParsedClubSquad[],
  heartbeat?: () => Promise<void>,
): Promise<SerieASquadsSyncSuccess> {
  const providerPlayerIds = new Set<number>();
  let membershipCount = 0;

  for (const squad of squads) {
    const currentPlayerIds: string[] = [];

    for (const player of squad.players) {
      const playerId = await upsertPlayer(client, player);

      await upsertSquadMembership(client, {
        clubId: squad.club.clubId,
        playerId,
        shirtNumber: player.shirtNumber,
        position: player.position,
        providerRaw: player.providerRaw,
      });

      providerPlayerIds.add(player.providerPlayerId);
      currentPlayerIds.push(playerId);
      membershipCount += 1;
    }

    await deleteStaleSquadMemberships(client, squad.club.clubId, currentPlayerIds);
    await heartbeat?.();
  }

  return {
    status: "success",
    clubCount: squads.length,
    playerCount: providerPlayerIds.size,
    membershipCount,
  };
}

export async function syncSerieASquads(
  input: SerieASquadsSyncInput,
): Promise<SerieASquadsSyncResult> {
  await input.heartbeat?.();

  const queryable = input.transactionClient ?? input.pool;
  const scope = await getSerieASquadScope(queryable);

  if (!scope || scope.clubs.length !== SERIE_A_EXPECTED_CURRENT_CLUBS) {
    return failed(
      "football_season_membership_incomplete",
      `Persisted Serie A season membership must contain exactly ${SERIE_A_EXPECTED_CURRENT_CLUBS} clubs before syncing current squads.`,
    );
  }

  const squads = await fetchSquads(input.client, scope, input.heartbeat);

  if ("status" in squads) {
    return squads;
  }

  await input.heartbeat?.();

  if (input.transactionClient) {
    return persistSquads(input.transactionClient, squads, input.heartbeat);
  }

  const client = await input.pool.connect();
  let transactionStarted = false;

  try {
    await client.query("begin");
    transactionStarted = true;

    const result = await persistSquads(client, squads, input.heartbeat);

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
