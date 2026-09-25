import type { Pool, PoolClient } from "pg";

import type { ApiFootballClient, ApiFootballResult } from "./api-football/node";
import {
  SERIE_A_CURRENT_SEASON,
  SERIE_A_EXPECTED_CURRENT_CLUBS,
  SERIE_A_PROVIDER_LEAGUE_ID,
} from "./foundation";
import {
  upsertClub,
  upsertSeasonClub,
  upsertSerieACompetition,
  upsertSerieASeason,
  type UpsertClubInput,
} from "./repository";

type Queryable = Pool | PoolClient;

type ApiFootballLeagueResponse = {
  league?: {
    id?: unknown;
    name?: unknown;
    type?: unknown;
    logo?: unknown;
  };
  country?: {
    name?: unknown;
  };
  seasons?: unknown;
};

type ApiFootballLeagueSeason = {
  year?: unknown;
  start?: unknown;
  end?: unknown;
  current?: unknown;
};

type ApiFootballTeamResponse = {
  team?: {
    id?: unknown;
    name?: unknown;
    code?: unknown;
    country?: unknown;
    founded?: unknown;
    national?: unknown;
    logo?: unknown;
  };
};

export type SerieAFoundationSyncSuccess = {
  status: "success";
  competitionCount: 1;
  seasonCount: 1;
  clubCount: number;
};

export type SerieAFoundationSyncFailure = {
  status: "retry" | "failed";
  errorCode: string;
  message: string;
  retryDelaySeconds?: number;
};

export type SerieAFoundationSyncResult =
  | SerieAFoundationSyncSuccess
  | SerieAFoundationSyncFailure;

export type SerieAFoundationSyncInput = {
  client: ApiFootballClient;
  queryable: Queryable;
  heartbeat?: () => Promise<void>;
};

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function asOptionalInteger(value: unknown): number | null {
  return Number.isInteger(value) ? (value as number) : null;
}

function asOptionalBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function asDateString(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) {
    return null;
  }

  return value;
}

function providerFailure(
  endpoint: string,
  result: ApiFootballResult<unknown>,
): SerieAFoundationSyncFailure {
  if (result.ok) {
    throw new Error("providerFailure received a successful result");
  }

  const retryDelaySeconds = result.error.retryAfterSeconds;

  return {
    status: result.error.retryable ? "retry" : "failed",
    errorCode: `api_football_${result.error.code}`,
    message: `API-Football ${endpoint} request failed: ${result.error.message}`,
    ...(retryDelaySeconds !== undefined ? { retryDelaySeconds } : {}),
  };
}

function failed(errorCode: string, message: string): SerieAFoundationSyncFailure {
  return {
    status: "failed",
    errorCode,
    message,
  };
}

function getLeagueSeason(
  league: ApiFootballLeagueResponse,
): ApiFootballLeagueSeason | null {
  if (!Array.isArray(league.seasons)) {
    return null;
  }

  return (
    league.seasons.find((season): season is ApiFootballLeagueSeason => {
      return (
        season !== null &&
        typeof season === "object" &&
        (season as ApiFootballLeagueSeason).year === SERIE_A_CURRENT_SEASON
      );
    }) ?? null
  );
}

function normalizeLeague(data: unknown[]):
  | {
      competition: Parameters<typeof upsertSerieACompetition>[1];
      season: Parameters<typeof upsertSerieASeason>[2];
    }
  | SerieAFoundationSyncFailure {
  if (data.length !== 1) {
    return failed(
      "api_football_unexpected_league_count",
      `Expected exactly one Serie A league response, got ${data.length}.`,
    );
  }

  const [rawLeague] = data as ApiFootballLeagueResponse[];

  if (rawLeague.league?.id !== SERIE_A_PROVIDER_LEAGUE_ID) {
    return failed(
      "api_football_unexpected_league_id",
      "API-Football returned a league outside the approved Serie A scope.",
    );
  }

  const providerName = asString(rawLeague.league.name);
  const season = getLeagueSeason(rawLeague);

  if (!providerName || !season) {
    return failed(
      "api_football_malformed_league_data",
      "API-Football returned incomplete Serie A league or season data.",
    );
  }

  return {
    competition: {
      providerName,
      country: asString(rawLeague.country?.name),
      type: asString(rawLeague.league.type),
      providerLogoUrl: asString(rawLeague.league.logo),
    },
    season: {
      startsOn: asDateString(season.start),
      endsOn: asDateString(season.end),
      providerCurrent: season.current === true,
    },
  };
}

function normalizeClubs(data: unknown[]): UpsertClubInput[] | SerieAFoundationSyncFailure {
  if (data.length !== SERIE_A_EXPECTED_CURRENT_CLUBS) {
    return failed(
      "api_football_unexpected_club_count",
      `Expected ${SERIE_A_EXPECTED_CURRENT_CLUBS} Serie A clubs, got ${data.length}.`,
    );
  }

  const clubs: UpsertClubInput[] = [];

  for (const rawTeam of data as ApiFootballTeamResponse[]) {
    const team = rawTeam.team;
    const providerClubId = asOptionalInteger(team?.id);
    const providerName = asString(team?.name);

    if (!providerClubId || !providerName) {
      return failed(
        "api_football_malformed_team_data",
        "API-Football returned a team without a provider id or name.",
      );
    }

    clubs.push({
      providerClubId,
      providerName,
      code: asString(team?.code),
      country: asString(team?.country),
      founded: asOptionalInteger(team?.founded),
      national: asOptionalBoolean(team?.national),
      providerLogoUrl: asString(team?.logo),
    });
  }

  return clubs;
}

export async function syncSerieAFoundation(
  input: SerieAFoundationSyncInput,
): Promise<SerieAFoundationSyncResult> {
  await input.heartbeat?.();

  const leagueResult = await input.client.get<unknown[]>("/leagues", {
    id: SERIE_A_PROVIDER_LEAGUE_ID,
    season: SERIE_A_CURRENT_SEASON,
  });

  if (!leagueResult.ok) {
    return providerFailure("leagues", leagueResult);
  }

  const league = normalizeLeague(leagueResult.data);

  if ("status" in league) {
    return league;
  }

  const competitionId = await upsertSerieACompetition(
    input.queryable,
    league.competition,
  );
  const seasonId = await upsertSerieASeason(input.queryable, competitionId, league.season);

  await input.heartbeat?.();

  const teamsResult = await input.client.get<unknown[]>("/teams", {
    league: SERIE_A_PROVIDER_LEAGUE_ID,
    season: SERIE_A_CURRENT_SEASON,
  });

  if (!teamsResult.ok) {
    return providerFailure("teams", teamsResult);
  }

  const clubs = normalizeClubs(teamsResult.data);

  if (!Array.isArray(clubs)) {
    return clubs;
  }

  for (const club of clubs) {
    const clubId = await upsertClub(input.queryable, club);

    await upsertSeasonClub(input.queryable, seasonId, clubId);
  }

  await input.heartbeat?.();

  return {
    status: "success",
    competitionCount: 1,
    seasonCount: 1,
    clubCount: clubs.length,
  };
}
