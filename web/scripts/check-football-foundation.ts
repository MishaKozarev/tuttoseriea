import crypto from "node:crypto";
import { readFileSync } from "node:fs";

import { config as loadEnv } from "dotenv";
import pg from "pg";

import type { ApiFootballClient, ApiFootballResult } from "../src/football/api-football/node";
import {
  currentSerieAClubSlugExists,
  getCurrentSerieAClubPageData,
  listCurrentSerieAClubSlugs,
} from "../src/football/club-page-repository";
import {
  SERIE_A_PLAYER_STATISTICS_IDEMPOTENCY_KEY,
  SERIE_A_PLAYER_STATISTICS_JOB_TYPE,
} from "../src/football/foundation";
import { listCurrentSerieAMatches } from "../src/football/matches-repository";
import {
  currentSerieAPlayerSlugExists,
  getCurrentSerieAPlayerPageData,
  listCurrentSerieAEligiblePlayerSlugs,
} from "../src/football/player-page-repository";
import { listCurrentSerieAClubs } from "../src/football/repository";
import { syncSerieAFoundation } from "../src/football/serie-a-foundation-sync";
import { syncSerieAMatches } from "../src/football/serie-a-matches-sync";
import { syncSerieAPlayerStatistics } from "../src/football/serie-a-player-statistics-sync";
import { syncSerieASquads } from "../src/football/serie-a-squads-sync";
import { syncSerieAStandings } from "../src/football/serie-a-standings-sync";
import { createPlayerSlug } from "../src/football/slug";
import { listCurrentSerieAPlayerAggregates } from "../src/football/statistics-page-repository";
import { listCurrentSerieAStandings } from "../src/football/standings-repository";
import {
  createJobRegistry,
  getJobRunnerConfig,
  JobRepository,
  RUNNER_EXIT_CODES,
  runJobOnce,
  type JobDefinition,
} from "../src/jobs";

const { Pool } = pg;

loadEnv({ path: ".env.local", quiet: true });
loadEnv({ path: ".env", quiet: true });

type CountRow = {
  count: number;
};

type ClubOwnershipRow = {
  slug: string;
  nameRu: string | null;
  nameRuReviewStatus: string | null;
  providerName: string;
};

type LocalizationOwnershipRow = {
  nameRu: string | null;
  nameRuReviewStatus: string | null;
  providerName: string;
};

type IdRow = {
  id: string;
};

type MatchFactsRow = {
  kickoffAt: Date | null;
  referee: string | null;
  providerVenueId: number | null;
  venueName: string | null;
  venueCity: string | null;
  status: string;
  pollingCategory: string;
  homeWinner: boolean | null;
  awayWinner: boolean | null;
  homeGoals: number | null;
  awayGoals: number | null;
  halftimeHome: number | null;
  halftimeAway: number | null;
  fulltimeHome: number | null;
  fulltimeAway: number | null;
  providerRaw: Record<string, unknown>;
};

type DuplicateRow = {
  count: number;
};

type StandingFactsRow = {
  rank: number;
  points: number;
  goalsDiff: number;
  form: string | null;
  description: string | null;
  played: number;
  homeWins: number;
  awayGoalsFor: number;
  providerRaw: Record<string, unknown>;
};

type PlayerFactsRow = {
  id: string;
  slug: string;
  providerName: string;
  nameRu: string | null;
  nameRuReviewStatus: string | null;
  age: number | null;
  providerPhotoUrl: string | null;
};

type SquadMembershipFactsRow = {
  shirtNumber: number | null;
  position: string;
  providerRaw: Record<string, unknown>[];
};

type PlayerStatisticsFactsRow = {
  providerPlayerId: number;
  firstname: string | null;
  birthDate: string | null;
  nationality: string | null;
  injured: boolean | null;
  appearances: number | null;
  minutes: number | null;
  passesAccuracy: number | null;
  penaltyCommitted: number | null;
  playerRaw: Record<string, unknown>;
  statisticsRaw: Record<string, unknown>;
};

type PlayerSlugParityRow = {
  providerPlayerId: number;
  slug: string;
};

function requireEnv(name: string): string {
  const value = process.env[name];

  if (!value) {
    throw new Error(`${name} is required`);
  }

  return value;
}

async function verifyPlayerSlugSqlTypeScriptParity(
  queryable: Pick<pg.Pool | pg.PoolClient, "query">,
): Promise<void> {
  const migration = readFileSync(
    new URL("../drizzle/0010_aberrant_colleen_wing.sql", import.meta.url),
    "utf8",
  );
  const expressionMatch = /SET "slug" = ([\s\S]*?);--> statement-breakpoint/u.exec(
    migration,
  );
  const expression = expressionMatch?.[1]?.trim();

  assertCondition(expression, "Player slug migration backfill expression was not found");

  const cases = [
    { providerName: "Rafael Leao", providerPlayerId: 276 },
    { providerName: "  João Félix & Co.  ", providerPlayerId: 123 },
    { providerName: "Ж", providerPlayerId: 456 },
  ] as const;
  const placeholders = cases
    .map((_, index) => `($${index * 2 + 1}::text, $${index * 2 + 2}::integer)`)
    .join(", ");
  const values = cases.flatMap(({ providerName, providerPlayerId }) => [
    providerName,
    providerPlayerId,
  ]);
  const result = await queryable.query<PlayerSlugParityRow>(
    `
      select
        "provider_player_id" as "providerPlayerId",
        ${expression} as slug
      from (values ${placeholders}) as input("provider_name", "provider_player_id")
      order by "provider_player_id"
    `,
    values,
  );
  const sqlSlugsByProviderId = new Map(
    result.rows.map((row) => [row.providerPlayerId, row.slug]),
  );

  for (const testCase of cases) {
    assertCondition(
      sqlSlugsByProviderId.get(testCase.providerPlayerId) ===
        createPlayerSlug(testCase.providerName, testCase.providerPlayerId),
      `Player slug SQL/TypeScript parity mismatch for provider player ${testCase.providerPlayerId}`,
    );
  }
}

function assertCondition(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function postgresErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object") {
    return undefined;
  }

  const code = (error as { code?: unknown }).code;

  if (typeof code === "string") {
    return code;
  }

  return postgresErrorCode((error as { cause?: unknown }).cause);
}

async function assertCheckConstraintViolation(
  client: pg.PoolClient,
  savepointName: string,
  operation: () => Promise<unknown>,
  message: string,
): Promise<void> {
  assertCondition(
    /^[a-z][a-z0-9_]*$/u.test(savepointName),
    "invalid integration-test savepoint name",
  );

  await client.query(`savepoint ${savepointName}`);
  let checkViolation = false;

  try {
    await operation();
  } catch (error) {
    if (postgresErrorCode(error) !== "23514") {
      throw error;
    }

    checkViolation = true;
  } finally {
    await client.query(`rollback to savepoint ${savepointName}`);
    await client.query(`release savepoint ${savepointName}`);
  }

  assertCondition(checkViolation, message);
}

function createTeams(nameSuffix = "") {
  return Array.from({ length: 20 }, (_, index) => {
    const providerClubId = 900_000 + index;
    const providerName = index === 0 ? `AC Milan${nameSuffix}` : `Serie A Club ${index + 1}`;

    return {
      team: {
        id: providerClubId,
        name: providerName,
        code: index === 0 ? "MIL" : `C${String(index + 1).padStart(2, "0")}`,
        country: "Italy",
        founded: 1900 + index,
        national: false,
        logo: `https://media.example.invalid/clubs/${providerClubId}.png`,
      },
    };
  });
}

function createLeague() {
  return [
    {
      league: {
        id: 135,
        name: "Serie A",
        type: "League",
        logo: "https://media.example.invalid/leagues/135.png",
      },
      country: {
        name: "Italy",
      },
      seasons: [
        {
          year: 2026,
          start: "2026-08-22",
          end: "2027-05-23",
          current: true,
        },
      ],
    },
  ];
}

type FixtureSetOptions = {
  baseFixtureId?: number;
  firstKickoff?: string;
  firstReferee?: string;
  firstVenueName?: string;
  firstSnapshotMarker?: string;
  lastFixtureId?: number;
  unknownClubAtIndex?: number;
};

function createFixtures(options: FixtureSetOptions = {}) {
  const baseFixtureId = options.baseFixtureId ?? 910_000;

  return Array.from({ length: 380 }, (_, index) => {
    const homeIndex = index % 20;
    const awayIndex = (homeIndex + 1 + Math.floor(index / 20)) % 20;
    const isFirst = index === 0;
    const providerFixtureId =
      index === 379 && options.lastFixtureId !== undefined
        ? options.lastFixtureId
        : baseFixtureId + index;
    const homeProviderClubId =
      index === options.unknownClubAtIndex ? 999_998 : 900_000 + homeIndex;

    return {
      fixture: {
        id: providerFixtureId,
        referee: isFirst ? (options.firstReferee ?? "Referee One") : null,
        timezone: "Europe/Rome",
        date:
          index === 379
            ? null
            : isFirst
              ? (options.firstKickoff ?? "2026-08-22T18:45:00+00:00")
              : new Date(Date.UTC(2026, 7, 23 + index, 18, 45)).toISOString(),
        timestamp: index === 379 ? null : 1_777_053_900 + index * 86_400,
        periods: {
          first: isFirst ? 1_777_053_900 : null,
          second: isFirst ? 1_777_057_500 : null,
        },
        venue: {
          id: isFirst ? 12_345 : 20_000 + index,
          name: isFirst ? (options.firstVenueName ?? "San Siro") : `Venue ${index}`,
          city: isFirst ? "Milano" : `City ${index}`,
        },
        status: {
          long: isFirst ? "Match Finished" : "Not Started",
          short: isFirst ? "FT" : "NS",
          elapsed: isFirst ? 90 : null,
          extra: isFirst ? 4 : null,
        },
      },
      league: {
        id: 135,
        season: 2026,
        round: `Regular Season - ${Math.floor(index / 10) + 1}`,
      },
      teams: {
        home: {
          id: homeProviderClubId,
          winner: isFirst ? true : null,
        },
        away: {
          id: 900_000 + awayIndex,
          winner: isFirst ? false : null,
        },
      },
      goals: {
        home: isFirst ? 2 : null,
        away: isFirst ? 1 : null,
      },
      score: {
        halftime: {
          home: isFirst ? 1 : null,
          away: isFirst ? 0 : null,
        },
        fulltime: {
          home: isFirst ? 2 : null,
          away: isFirst ? 1 : null,
        },
        extratime: {
          home: null,
          away: null,
        },
        penalty: {
          home: null,
          away: null,
        },
      },
      coverage: {
        marker: isFirst ? (options.firstSnapshotMarker ?? "initial") : "fixture",
      },
    };
  });
}

type StandingSetOptions = {
  firstDescription?: string | null;
  firstForm?: string | null;
  firstPoints?: number;
  firstSnapshotMarker?: string;
  swapFirstTwoRanks?: boolean;
};

function createStandings(options: StandingSetOptions = {}) {
  const rows = Array.from({ length: 20 }, (_, index) => ({
    rank:
      options.swapFirstTwoRanks && index < 2
        ? index === 0
          ? 2
          : 1
        : index + 1,
    team: {
      id: 900_000 + index,
      name: index === 0 ? "AC Milan" : `Serie A Club ${index + 1}`,
      logo: `https://media.example.invalid/clubs/${900_000 + index}.png`,
    },
    points: index === 0 ? (options.firstPoints ?? 63) : 60 - index,
    goalsDiff: 20 - index,
    group: "Serie A",
    form: index === 0 ? (options.firstForm ?? "WWDLW") : "DWLWW",
    status: "same",
    description:
      index === 0 ? (options.firstDescription ?? "Champions League") : null,
    all: {
      played: 25,
      win: 15,
      draw: 6,
      lose: 4,
      goals: { for: 50, against: 30 },
    },
    home: {
      played: 13,
      win: 9,
      draw: 3,
      lose: 1,
      goals: { for: 30, against: 12 },
    },
    away: {
      played: 12,
      win: 6,
      draw: 3,
      lose: 3,
      goals: { for: 20, against: 18 },
    },
    snapshot: {
      marker: index === 0 ? (options.firstSnapshotMarker ?? "initial") : "standing",
    },
  }));

  return [
    {
      league: {
        id: 135,
        season: 2026,
        standings: [rows],
      },
    },
  ];
}

type SquadPlayerOptions = {
  age?: number | null;
  name?: string;
  number?: number | null;
  photo?: string | null;
  position?: string;
  snapshotMarker?: string;
};

function createSquadPlayer(providerPlayerId: number, options: SquadPlayerOptions = {}) {
  return {
    id: providerPlayerId,
    name: options.name ?? `Player ${providerPlayerId}`,
    age: options.age ?? 24,
    number: options.number === undefined ? 10 : options.number,
    position: options.position ?? "Provider Position",
    photo:
      options.photo === undefined
        ? `https://media.example.invalid/players/${providerPlayerId}.png`
        : options.photo,
    snapshot: {
      marker: options.snapshotMarker ?? "initial",
    },
  };
}

function createSquadResponse(
  providerClubId: number,
  players?: ReturnType<typeof createSquadPlayer>[],
) {
  const clubIndex = providerClubId - 900_000;
  const defaultPlayers = [
    createSquadPlayer(1_100_000 + clubIndex * 2),
    createSquadPlayer(1_100_001 + clubIndex * 2),
  ];

  return [
    {
      team: {
        id: providerClubId,
        name: `Serie A Club ${clubIndex + 1}`,
      },
      players: players ?? defaultPlayers,
    },
  ];
}

type PlayerStatisticsFixtureOptions = {
  includeTransfer?: boolean;
  firstAge?: number | null;
  firstMinutes?: number | null;
  marker?: string;
};

function createPlayerStatisticsPages(
  options: PlayerStatisticsFixtureOptions = {},
): unknown[][] {
  const entries = Array.from({ length: 20 }, (_, index) => {
    const providerPlayerId = 1_300_000 + index;
    const providerClubId = 900_000 + index;
    const rawPlayer = {
      id: providerPlayerId,
      name: `Statistics Player ${providerPlayerId}`,
      firstname: index === 0 ? "First" : `First ${index}`,
      lastname: index === 0 ? "Player" : `Player ${index}`,
      age: index === 0 ? (options.firstAge ?? 24) : 24,
      birth: {
        date: index === 0 ? "2002-02-20" : null,
        place: index === 0 ? "Rome" : null,
        country: "Italy",
      },
      nationality: "Italy",
      height: "182 cm",
      weight: "75 kg",
      injured: false,
      photo: `https://media.example.invalid/players/${providerPlayerId}.png`,
      snapshot: { marker: options.marker ?? "initial" },
    };
    const createStatistics = (teamId: number) => ({
      team: { id: teamId, name: `Serie A Club ${teamId - 899_999}` },
      league: { id: 135, season: 2026, name: "Serie A" },
      games: {
        appearences: index === 0 ? 0 : 12,
        lineups: 10,
        minutes: index === 0 ? (options.firstMinutes ?? null) : 900,
        number: 8,
        position: "Midfielder",
        rating: "7.125000",
        captain: false,
      },
      substitutes: { in: 2, out: 4, bench: 3 },
      shots: { total: 18, on: 7 },
      goals: { total: 3, conceded: 0, assists: 4, saves: 9 },
      passes: { total: 540, key: 21, accuracy: 87 },
      tackles: { total: 26, blocks: 3, interceptions: 12 },
      duels: { total: 84, won: 49 },
      dribbles: { attempts: 19, success: 11, past: 5 },
      fouls: { drawn: 14, committed: 10 },
      cards: { yellow: 2, yellowred: 0, red: 0 },
      penalty: { won: 1, commited: 2, scored: 1, missed: 0, saved: 0 },
      snapshot: { marker: options.marker ?? "initial" },
    });
    const statistics = [createStatistics(providerClubId)];

    if (index === 0 && options.includeTransfer !== false) {
      statistics.push(createStatistics(900_001));
    }

    return { player: rawPlayer, statistics };
  });

  return [entries.slice(0, 10), entries.slice(10)];
}

function ok<TResponse>(
  data: TResponse,
  operation: string,
  current = 1,
  total = 1,
): ApiFootballResult<TResponse> {
  return {
    ok: true,
    data,
    results: Array.isArray(data) ? data.length : 1,
    paging: {
      current,
      total,
    },
    operation,
    attempts: 1,
  };
}

function createFakeClient(
  nameSuffix = "",
  fixtures = createFixtures(),
  standings = createStandings(),
  squadForClub: (providerClubId: number) => unknown = createSquadResponse,
  playerStatisticsPages: unknown[][] = createPlayerStatisticsPages(),
): ApiFootballClient {
  return {
    getRequestAttemptCount: () => 0,
    async get<TResponse>(
      pathname: string,
      query: Record<string, string | number | boolean | undefined> = {},
    ): Promise<ApiFootballResult<TResponse>> {
      if (pathname === "/leagues") {
        return ok(createLeague(), "leagues") as ApiFootballResult<TResponse>;
      }

      if (pathname === "/teams") {
        return ok(createTeams(nameSuffix), "teams") as ApiFootballResult<TResponse>;
      }

      if (pathname === "/fixtures") {
        return ok(fixtures, "fixtures") as ApiFootballResult<TResponse>;
      }

      if (pathname === "/standings") {
        return ok(standings, "standings") as ApiFootballResult<TResponse>;
      }

      if (pathname === "/players/squads") {
        const providerClubId = query.team;

        if (typeof providerClubId !== "number") {
          return {
            ok: false,
            error: {
              code: "http_client_error",
              message: "Fake squad request is missing a numeric team id",
              retryable: false,
              attempts: 1,
            },
          };
        }

        return ok(squadForClub(providerClubId), "players/squads") as ApiFootballResult<TResponse>;
      }

      if (pathname === "/players") {
        const page = query.page;

        if (typeof page !== "number" || !Number.isInteger(page) || page <= 0) {
          return {
            ok: false,
            error: {
              code: "http_client_error",
              message: "Fake player statistics request is missing a valid page",
              retryable: false,
              attempts: 1,
            },
          };
        }

        return ok(
          playerStatisticsPages[page - 1] ?? [],
          "players",
          page,
          playerStatisticsPages.length,
        ) as ApiFootballResult<TResponse>;
      }

      return {
        ok: false,
        error: {
          code: "http_client_error",
          message: `Unexpected fake endpoint: ${pathname}`,
          retryable: false,
          attempts: 1,
        },
      };
    },
  };
}

async function countRows(client: pg.PoolClient, tableName: string): Promise<number> {
  const result = await client.query<CountRow>(
    `select count(*)::int as count from football.${tableName}`,
  );

  return result.rows[0]?.count ?? 0;
}

async function countFakeClubs(
  queryable: Pick<pg.Pool | pg.PoolClient, "query">,
): Promise<number> {
  const result = await queryable.query<CountRow>(
    `
      select count(*)::int as count
      from football.clubs
      where provider = 'api-football'
        and provider_club_id >= 900000
        and provider_club_id < 900020
    `,
  );

  return result.rows[0]?.count ?? 0;
}

async function countFakeSeasonClubs(client: pg.PoolClient): Promise<number> {
  const result = await client.query<CountRow>(
    `
      select count(*)::int as count
      from football.season_clubs sc
      join football.clubs c on c.id = sc.club_id
      where c.provider = 'api-football'
        and c.provider_club_id >= 900000
        and c.provider_club_id < 900020
    `,
  );

  return result.rows[0]?.count ?? 0;
}

async function countFakeMatches(client: pg.PoolClient): Promise<number> {
  const result = await client.query<CountRow>(
    `
      select count(*)::int as count
      from football.matches
      where provider = 'api-football'
        and provider_fixture_id >= 910000
        and provider_fixture_id < 920001
    `,
  );

  return result.rows[0]?.count ?? 0;
}

async function countFakeStandings(queryable: Pick<pg.Pool | pg.PoolClient, "query">): Promise<number> {
  const result = await queryable.query<CountRow>(
    `
      select count(*)::int as count
      from football.standings st
      join football.seasons s on s.id = st.season_id
      join football.competitions comp on comp.id = s.competition_id
      where comp.provider = 'api-football'
        and comp.provider_competition_id = 135
        and s.provider = 'api-football'
        and s.provider_season_year = 2026
    `,
  );

  return result.rows[0]?.count ?? 0;
}

async function countFakePlayers(
  queryable: Pick<pg.Pool | pg.PoolClient, "query">,
): Promise<number> {
  const result = await queryable.query<CountRow>(
    `
      select count(*)::int as count
      from football.players
      where provider = 'api-football'
        and provider_player_id >= 1100000
        and provider_player_id < 1300000
    `,
  );

  return result.rows[0]?.count ?? 0;
}

async function countFakeSquadMemberships(
  queryable: Pick<pg.Pool | pg.PoolClient, "query">,
): Promise<number> {
  const result = await queryable.query<CountRow>(
    `
      select count(*)::int as count
      from football.squad_memberships sm
      join football.clubs c on c.id = sm.club_id
      where c.provider = 'api-football'
        and c.provider_club_id >= 900000
        and c.provider_club_id < 900020
    `,
  );

  return result.rows[0]?.count ?? 0;
}

async function countFakePlayerStatistics(
  queryable: Pick<pg.Pool | pg.PoolClient, "query">,
): Promise<number> {
  const result = await queryable.query<CountRow>(
    `
      select count(*)::int as count
      from football.player_statistics ps
      join football.players p on p.id = ps.player_id
      where p.provider = 'api-football'
        and p.provider_player_id >= 1300000
        and p.provider_player_id < 1400000
    `,
  );

  return result.rows[0]?.count ?? 0;
}

async function countDuplicatePlayerStatisticsIdentities(
  queryable: Pick<pg.Pool | pg.PoolClient, "query">,
): Promise<number> {
  const result = await queryable.query<DuplicateRow>(
    `
      select count(*)::int as count
      from (
        select season_id, club_id, player_id
        from football.player_statistics
        group by season_id, club_id, player_id
        having count(*) > 1
      ) duplicates
    `,
  );

  return result.rows[0]?.count ?? 0;
}

async function getFirstPlayerStatisticsFacts(
  queryable: Pick<pg.Pool | pg.PoolClient, "query">,
): Promise<PlayerStatisticsFactsRow> {
  const result = await queryable.query<PlayerStatisticsFactsRow>(
    `
      select
        p.provider_player_id as "providerPlayerId",
        p.firstname,
        p.birth_date::text as "birthDate",
        p.nationality,
        p.injured,
        ps.appearances,
        ps.minutes,
        ps.passes_accuracy as "passesAccuracy",
        ps.penalty_committed as "penaltyCommitted",
        ps.player_raw as "playerRaw",
        ps.statistics_raw as "statisticsRaw"
      from football.player_statistics ps
      join football.players p on p.id = ps.player_id
      join football.clubs c on c.id = ps.club_id
      where p.provider = 'api-football'
        and p.provider_player_id = 1300000
        and c.provider = 'api-football'
        and c.provider_club_id = 900000
    `,
  );
  const row = result.rows[0];

  assertCondition(row, "synced player statistics row was not found");

  return row;
}

async function countDuplicatePlayerIdentities(client: pg.PoolClient): Promise<number> {
  const result = await client.query<DuplicateRow>(
    `
      select count(*)::int as count
      from (
        select provider, provider_player_id
        from football.players
        group by provider, provider_player_id
        having count(*) > 1
      ) duplicates
    `,
  );

  return result.rows[0]?.count ?? 0;
}

async function getFakePlayerFacts(
  queryable: Pick<pg.Pool | pg.PoolClient, "query">,
  providerPlayerId = 1_100_000,
): Promise<PlayerFactsRow> {
  const result = await queryable.query<PlayerFactsRow>(
    `
      select
        id,
        slug,
        provider_name as "providerName",
        name_ru as "nameRu",
        name_ru_review_status as "nameRuReviewStatus",
        age,
        provider_photo_url as "providerPhotoUrl"
      from football.players
      where provider = 'api-football'
        and provider_player_id = $1
    `,
    [providerPlayerId],
  );
  const row = result.rows[0];

  assertCondition(row, `synced player ${providerPlayerId} was not found`);

  return row;
}

async function getFakeMembershipFacts(
  queryable: Pick<pg.Pool | pg.PoolClient, "query">,
  providerClubId = 900_000,
  providerPlayerId = 1_100_000,
): Promise<SquadMembershipFactsRow | null> {
  const result = await queryable.query<SquadMembershipFactsRow>(
    `
      select
        sm.shirt_number as "shirtNumber",
        sm.position,
        sm.provider_raw as "providerRaw"
      from football.squad_memberships sm
      join football.clubs c on c.id = sm.club_id
      join football.players p on p.id = sm.player_id
      where c.provider = 'api-football'
        and c.provider_club_id = $1
        and p.provider = 'api-football'
        and p.provider_player_id = $2
    `,
    [providerClubId, providerPlayerId],
  );

  return result.rows[0] ?? null;
}

async function countDuplicateStandingIdentities(client: pg.PoolClient): Promise<number> {
  const result = await client.query<DuplicateRow>(
    `
      select count(*)::int as count
      from (
        select season_id, club_id
        from football.standings
        group by season_id, club_id
        having count(*) > 1
      ) duplicates
    `,
  );

  return result.rows[0]?.count ?? 0;
}

async function countProviderMatchesInRange(
  pool: pg.Pool,
  firstFixtureId: number,
  lastFixtureId: number,
): Promise<number> {
  const result = await pool.query<CountRow>(
    `
      select count(*)::int as count
      from football.matches
      where provider = 'api-football'
        and provider_fixture_id between $1 and $2
    `,
    [firstFixtureId, lastFixtureId],
  );

  return result.rows[0]?.count ?? 0;
}

async function countDuplicateMatchIdentities(client: pg.PoolClient): Promise<number> {
  const result = await client.query<DuplicateRow>(
    `
      select count(*)::int as count
      from (
        select provider, provider_fixture_id
        from football.matches
        group by provider, provider_fixture_id
        having count(*) > 1
      ) duplicates
    `,
  );

  return result.rows[0]?.count ?? 0;
}

async function getFirstMatchFacts(client: pg.PoolClient): Promise<MatchFactsRow> {
  const result = await client.query<MatchFactsRow>(
    `
      select
        kickoff_at as "kickoffAt",
        referee,
        provider_venue_id as "providerVenueId",
        venue_name as "venueName",
        venue_city as "venueCity",
        status,
        polling_category as "pollingCategory",
        home_winner as "homeWinner",
        away_winner as "awayWinner",
        home_goals as "homeGoals",
        away_goals as "awayGoals",
        halftime_home as "halftimeHome",
        halftime_away as "halftimeAway",
        fulltime_home as "fulltimeHome",
        fulltime_away as "fulltimeAway",
        provider_raw as "providerRaw"
      from football.matches
      where provider = 'api-football'
        and provider_fixture_id = 910000
    `,
  );
  const row = result.rows[0];

  assertCondition(row, "synced match was not found");

  return row;
}

async function getFirstStandingFacts(client: pg.PoolClient): Promise<StandingFactsRow> {
  const result = await client.query<StandingFactsRow>(
    `
      select
        st.rank,
        st.points,
        st.goals_diff as "goalsDiff",
        st.form,
        st.description,
        st.played,
        st.home_wins as "homeWins",
        st.away_goals_for as "awayGoalsFor",
        st.provider_raw as "providerRaw"
      from football.standings st
      join football.clubs c on c.id = st.club_id
      where c.provider = 'api-football'
        and c.provider_club_id = 900000
    `,
  );
  const row = result.rows[0];

  assertCondition(row, "synced standing was not found");

  return row;
}

async function assertDeleteDenied(
  pool: pg.Pool,
  tableName: "clubs" | "matches" | "players" | "standings",
): Promise<void> {
  try {
    await pool.query(`delete from football.${tableName} where false`);
  } catch (error) {
    if (postgresErrorCode(error) === "42501") {
      return;
    }

    throw error;
  }

  throw new Error(`Runtime role unexpectedly has DELETE on football.${tableName}`);
}

async function assertDdlDenied(pool: pg.Pool): Promise<void> {
  try {
    await pool.query("create table football.__runtime_ddl_probe (id integer)");
  } catch (error) {
    if (postgresErrorCode(error) === "42501") {
      return;
    }

    throw error;
  }

  throw new Error("Runtime role unexpectedly has DDL access in football schema");
}

async function verifySyncWithMigrationRole(migrationPool: pg.Pool): Promise<void> {
  const client = await migrationPool.connect();
  let transactionStarted = false;

  try {
    await client.query("begin");
    transactionStarted = true;

    await verifyPlayerSlugSqlTypeScriptParity(client);

    const firstSync = await syncSerieAFoundation({
      client: createFakeClient(),
      queryable: client,
    });

    assertCondition(firstSync.status === "success", "initial fake sync failed");
    assertCondition(await countRows(client, "competitions") === 1, "competition count mismatch");
    assertCondition(await countRows(client, "seasons") === 1, "season count mismatch");
    assertCondition(await countFakeClubs(client) === 20, "club count mismatch");
    assertCondition(await countFakeSeasonClubs(client) === 20, "season membership count mismatch");

    const initialCompetitionLocalization = await client.query<LocalizationOwnershipRow>(
      `
        select
          provider_name as "providerName",
          name_ru as "nameRu",
          name_ru_review_status as "nameRuReviewStatus"
        from football.competitions
        where provider = 'api-football'
          and provider_competition_id = 135
      `,
    );

    assertCondition(
      initialCompetitionLocalization.rows[0]?.nameRu === null &&
        initialCompetitionLocalization.rows[0]?.nameRuReviewStatus === null,
      "foundation sync automatically created competition localization",
    );

    const localizationConstraints = await client.query<CountRow>(
      `
        select count(*)::int as count
        from pg_constraint
        where conname in (
          'competitions_name_ru_review_consistency_check',
          'clubs_name_ru_review_consistency_check',
          'players_name_ru_review_consistency_check'
        )
      `,
    );

    assertCondition(
      localizationConstraints.rows[0]?.count === 3,
      "Football proper-name review consistency constraints are missing",
    );

    const playerSlugContract = await client.query<CountRow>(
      `
        select count(*)::int as count
        from information_schema.columns
        where table_schema = 'football'
          and table_name = 'players'
          and column_name = 'slug'
          and is_nullable = 'NO'
      `,
    );
    const playerSlugUniqueIndex = await client.query<CountRow>(
      `
        select count(*)::int as count
        from pg_indexes
        where schemaname = 'football'
          and tablename = 'players'
          and indexname = 'players_slug_unique'
          and indexdef ilike 'create unique index%'
      `,
    );

    assertCondition(
      playerSlugContract.rows[0]?.count === 1 &&
        playerSlugUniqueIndex.rows[0]?.count === 1,
      "Player slug non-null/unique contract is missing",
    );

    await client.query(
      `
        update football.competitions
        set name_ru = 'Серия А', name_ru_review_status = 'reviewed'
        where provider = 'api-football'
          and provider_competition_id = 135
      `,
    );
    await client.query(
      `
        update football.clubs
        set name_ru = 'Милан', name_ru_review_status = 'reviewed', slug = 'milan-manual'
        where provider = 'api-football'
          and provider_club_id = 900000
      `,
    );
    await client.query(
      `
        update football.clubs
        set name_ru = 'Черновик клуба', name_ru_review_status = 'unreviewed'
        where provider = 'api-football'
          and provider_club_id = 900001
      `,
    );

    const repeatedSync = await syncSerieAFoundation({
      client: createFakeClient(),
      queryable: client,
    });

    assertCondition(repeatedSync.status === "success", "repeated fake sync failed");
    assertCondition(
      await countFakeClubs(client) === 20,
      "repeated sync created duplicate clubs",
    );
    assertCondition(
      await countFakeSeasonClubs(client) === 20,
      "repeated sync created duplicate memberships",
    );

    const repeatedCompetitionLocalization = await client.query<LocalizationOwnershipRow>(
      `
        select
          provider_name as "providerName",
          name_ru as "nameRu",
          name_ru_review_status as "nameRuReviewStatus"
        from football.competitions
        where provider = 'api-football'
          and provider_competition_id = 135
      `,
    );

    assertCondition(
      repeatedCompetitionLocalization.rows[0]?.nameRu === "Серия А" &&
        repeatedCompetitionLocalization.rows[0]?.nameRuReviewStatus === "reviewed",
      "foundation sync overwrote competition localization or review status",
    );

    const seasonId = (
      await client.query<IdRow>(
        `
          select s.id
          from football.competitions comp
          join football.seasons s on s.competition_id = comp.id
          where comp.provider = 'api-football'
            and comp.provider_competition_id = 135
            and s.provider = 'api-football'
            and s.provider_season_year = 2026
        `,
      )
    ).rows[0]?.id;

    assertCondition(seasonId, "synced season was not found");

    const standingsConstraint = await client.query<CountRow>(
      `
        select count(*)::int as count
        from pg_constraint
        where conname = 'standings_season_club_fk'
          and conrelid = 'football.standings'::regclass
      `,
    );

    assertCondition(
      standingsConstraint.rows[0]?.count === 1,
      "standings exact-season membership constraint is missing",
    );

    const playerStatisticsConstraint = await client.query<CountRow>(
      `
        select count(*)::int as count
        from pg_constraint
        where conname = 'player_statistics_season_club_fk'
          and conrelid = 'football.player_statistics'::regclass
      `,
    );

    assertCondition(
      playerStatisticsConstraint.rows[0]?.count === 1,
      "player statistics exact-season membership constraint is missing",
    );

    const initialStandingsSync = await syncSerieAStandings({
      client: createFakeClient(),
      transactionClient: client,
    });

    assertCondition(
      initialStandingsSync.status === "success" &&
        initialStandingsSync.standingCount === 20,
      "initial standings sync failed",
    );
    assertCondition(await countFakeStandings(client) === 20, "standings count mismatch");
    assertCondition(
      await countDuplicateStandingIdentities(client) === 0,
      "standings season/club identities are not unique",
    );

    const initialStandingFacts = await getFirstStandingFacts(client);

    assertCondition(
      initialStandingFacts.rank === 1 &&
        initialStandingFacts.points === 63 &&
        initialStandingFacts.goalsDiff === 20,
      "standing rank, points or goal difference was not persisted",
    );
    assertCondition(
      initialStandingFacts.form === "WWDLW" &&
        initialStandingFacts.description === "Champions League",
      "standing provider text was not persisted",
    );
    assertCondition(
      initialStandingFacts.played === 25 &&
        initialStandingFacts.homeWins === 9 &&
        initialStandingFacts.awayGoalsFor === 20,
      "standing statistics were not persisted",
    );
    assertCondition(
      (initialStandingFacts.providerRaw.snapshot as { marker?: unknown } | undefined)
        ?.marker === "initial",
      "complete standings provider snapshot was not persisted",
    );

    const repeatedStandingsSync = await syncSerieAStandings({
      client: createFakeClient(),
      transactionClient: client,
    });

    assertCondition(
      repeatedStandingsSync.status === "success" &&
        (await countFakeStandings(client)) === 20,
      "repeated standings sync was not idempotent",
    );

    const updatedStandingsSync = await syncSerieAStandings({
      client: createFakeClient(
        "",
        createFixtures(),
        createStandings({
          firstDescription: "  Europa League  ",
          firstForm: "LWWWW",
          firstPoints: 66,
          firstSnapshotMarker: "updated",
          swapFirstTwoRanks: true,
        }),
      ),
      transactionClient: client,
    });

    assertCondition(updatedStandingsSync.status === "success", "standings update sync failed");

    const updatedStandingFacts = await getFirstStandingFacts(client);

    assertCondition(
      updatedStandingFacts.rank === 2 &&
        updatedStandingFacts.points === 66 &&
        updatedStandingFacts.form === "LWWWW",
      "standing rank swap or provider-owned values did not update",
    );
    assertCondition(
      updatedStandingFacts.description === "  Europa League  ",
      "standing provider description was not preserved exactly",
    );
    assertCondition(
      (updatedStandingFacts.providerRaw.snapshot as { marker?: unknown } | undefined)
        ?.marker === "updated",
      "standings provider snapshot was not replaced on update",
    );

    const initialSquadsSync = await syncSerieASquads({
      client: createFakeClient(),
      transactionClient: client,
    });

    assertCondition(
      initialSquadsSync.status === "success" &&
        initialSquadsSync.clubCount === 20 &&
        initialSquadsSync.playerCount === 40 &&
        initialSquadsSync.membershipCount === 40,
      "initial current squads sync failed",
    );
    assertCondition(await countFakePlayers(client) === 40, "player count mismatch");
    assertCondition(
      await countFakeSquadMemberships(client) === 40,
      "current squad membership count mismatch",
    );
    assertCondition(
      await countDuplicatePlayerIdentities(client) === 0,
      "player provider identities are not unique",
    );

    const initialPlayerFacts = await getFakePlayerFacts(client);
    const initialMembershipFacts = await getFakeMembershipFacts(client);

    assertCondition(
      initialPlayerFacts.providerName === "Player 1100000" &&
        initialPlayerFacts.slug === "player-1100000-1100000" &&
        initialPlayerFacts.age === 24 &&
        initialPlayerFacts.providerPhotoUrl?.endsWith("/1100000.png") === true,
      "player provider-owned profile fields were not persisted",
    );
    assertCondition(
      initialMembershipFacts?.shirtNumber === 10 &&
        initialMembershipFacts.position === "Provider Position" &&
        initialMembershipFacts.providerRaw.length === 1 &&
        (initialMembershipFacts.providerRaw[0]?.snapshot as
          | { marker?: unknown }
          | undefined)?.marker === "initial",
      "current squad membership fields or raw player snapshot were not persisted",
    );

    await client.query(
      `
        update football.players
        set name_ru = 'Игрок состава', name_ru_review_status = 'reviewed'
        where provider = 'api-football'
          and provider_player_id = 1100000
      `,
    );

    const repeatedSquadsSync = await syncSerieASquads({
      client: createFakeClient(),
      transactionClient: client,
    });

    assertCondition(
      repeatedSquadsSync.status === "success" &&
        (await countFakePlayers(client)) === 40 &&
        (await countFakeSquadMemberships(client)) === 40,
      "repeated current squads sync was not idempotent",
    );

    const sharedUpdatedPlayer = createSquadPlayer(1_100_000, {
      age: 25,
      name: "Player 1100000 Updated",
      number: null,
      photo: "https://media.example.invalid/players/1100000-updated.png",
      position: "  Provider Owned Position  ",
      snapshotMarker: "updated",
    });
    const updatedSquadsSync = await syncSerieASquads({
      client: createFakeClient(
        "",
        createFixtures(),
        createStandings(),
        (providerClubId) => {
          if (providerClubId === 900_000) {
            return createSquadResponse(providerClubId, [
              sharedUpdatedPlayer,
              createSquadPlayer(1_200_000, { snapshotMarker: "new" }),
            ]);
          }

          if (providerClubId === 900_001) {
            return createSquadResponse(providerClubId, [
              ...createSquadResponse(providerClubId)[0]!.players,
              sharedUpdatedPlayer,
            ]);
          }

          return createSquadResponse(providerClubId);
        },
      ),
      transactionClient: client,
    });

    assertCondition(updatedSquadsSync.status === "success", "current squads update failed");
    assertCondition(
      (await countFakePlayers(client)) === 41,
      "player upsert created a duplicate or removed a stable player",
    );
    assertCondition(
      (await countFakeSquadMemberships(client)) === 41,
      "current squad reconciliation count mismatch",
    );

    const updatedPlayerFacts = await getFakePlayerFacts(client);
    const updatedMembershipFacts = await getFakeMembershipFacts(client);

    assertCondition(
      updatedPlayerFacts.providerName === "Player 1100000 Updated" &&
        updatedPlayerFacts.slug === "player-1100000-1100000" &&
        updatedPlayerFacts.age === 25 &&
        updatedPlayerFacts.providerPhotoUrl?.endsWith("/1100000-updated.png") === true,
      "existing player provider-owned profile fields did not update",
    );
    assertCondition(
      updatedPlayerFacts.nameRu === "Игрок состава" &&
        updatedPlayerFacts.nameRuReviewStatus === "reviewed",
      "squads sync overwrote player localization or review status",
    );
    assertCondition(
      updatedMembershipFacts?.shirtNumber === null &&
        updatedMembershipFacts.position === "  Provider Owned Position  " &&
        updatedMembershipFacts.providerRaw.length === 1 &&
        (updatedMembershipFacts.providerRaw[0]?.snapshot as
          | { marker?: unknown }
          | undefined)?.marker === "updated",
      "membership provider-owned fields or raw snapshot did not update exactly",
    );
    assertCondition(
      (await getFakeMembershipFacts(client, 900_000, 1_100_001)) === null,
      "stale current squad membership was not deleted",
    );
    assertCondition(
      (await getFakePlayerFacts(client, 1_100_001)).providerName === "Player 1100001",
      "stale membership deletion removed the stable player entity",
    );
    assertCondition(
      (await getFakeMembershipFacts(client, 900_001, 1_100_000)) !== null,
      "one player was not allowed to belong to two current club squads",
    );
    assertCondition(
      await countDuplicatePlayerIdentities(client) === 0,
      "shared membership created a duplicate player entity",
    );

    const initialPlayerStatisticsSync = await syncSerieAPlayerStatistics({
      client: createFakeClient(),
      transactionClient: client,
    });

    assertCondition(
      initialPlayerStatisticsSync.status === "success" &&
        initialPlayerStatisticsSync.pageCount === 2 &&
        initialPlayerStatisticsSync.playerCount === 20 &&
        initialPlayerStatisticsSync.statisticsCount === 21,
      "initial paginated player statistics sync failed",
    );
    assertCondition(
      (await countFakePlayerStatistics(client)) === 21,
      "player statistics snapshot count mismatch",
    );
    assertCondition(
      (await countDuplicatePlayerStatisticsIdentities(client)) === 0,
      "player statistics season/club/player identities are not unique",
    );

    const initialPlayerStatisticsFacts = await getFirstPlayerStatisticsFacts(client);

    assertCondition(
      initialPlayerStatisticsFacts.firstname === "First" &&
        initialPlayerStatisticsFacts.birthDate === "2002-02-20" &&
        initialPlayerStatisticsFacts.nationality === "Italy" &&
        initialPlayerStatisticsFacts.injured === false,
      "extended player profile fields were not persisted",
    );
    assertCondition(
      initialPlayerStatisticsFacts.appearances === 0 &&
        initialPlayerStatisticsFacts.minutes === null &&
        initialPlayerStatisticsFacts.passesAccuracy === 87 &&
        initialPlayerStatisticsFacts.penaltyCommitted === 2,
      "typed player statistics or provider typo mappings were not persisted",
    );
    assertCondition(
      (initialPlayerStatisticsFacts.playerRaw.snapshot as
        | { marker?: unknown }
        | undefined)?.marker === "initial" &&
        (initialPlayerStatisticsFacts.statisticsRaw.snapshot as
          | { marker?: unknown }
          | undefined)?.marker === "initial" &&
        (initialPlayerStatisticsFacts.statisticsRaw.goals as
          | { saves?: unknown }
          | undefined)?.saves === 9,
      "complete player/statistics raw snapshots were not persisted",
    );

    const initialStatisticsPageAggregates =
      await listCurrentSerieAPlayerAggregates(client);
    const transferAggregate = initialStatisticsPageAggregates.find(
      (aggregate) => aggregate.player.providerPlayerId === 1_300_000,
    );

    assertCondition(
      initialStatisticsPageAggregates.length === 20 &&
        transferAggregate?.clubs.length === 2 &&
        transferAggregate.goals === 6 &&
        transferAggregate.assists === 8 &&
        transferAggregate.appearances === 0 &&
        transferAggregate.minutes === null,
      "General Statistics aggregation did not preserve transfer or conservative NULL semantics",
    );

    await assertCheckConstraintViolation(
      client,
      "competition_status_without_name",
      () =>
        client.query(
          `
            update football.competitions
            set name_ru = null, name_ru_review_status = 'reviewed'
            where provider = 'api-football'
              and provider_competition_id = 135
          `,
        ),
      "competition accepted review status without a Russian name",
    );
    await assertCheckConstraintViolation(
      client,
      "competition_name_without_status",
      () =>
        client.query(
          `
            update football.competitions
            set name_ru = 'Серия А', name_ru_review_status = null
            where provider = 'api-football'
              and provider_competition_id = 135
          `,
        ),
      "competition accepted a Russian name without review status",
    );
    await assertCheckConstraintViolation(
      client,
      "club_status_without_name",
      () =>
        client.query(
          `
            update football.clubs
            set name_ru = null, name_ru_review_status = 'reviewed'
            where provider = 'api-football'
              and provider_club_id = 900000
          `,
        ),
      "club accepted review status without a Russian name",
    );
    await assertCheckConstraintViolation(
      client,
      "club_name_without_status",
      () =>
        client.query(
          `
            update football.clubs
            set name_ru = 'Милан', name_ru_review_status = null
            where provider = 'api-football'
              and provider_club_id = 900000
          `,
        ),
      "club accepted a Russian name without review status",
    );
    await assertCheckConstraintViolation(
      client,
      "player_status_without_name",
      () =>
        client.query(
          `
            update football.players
            set name_ru = null, name_ru_review_status = 'reviewed'
            where provider = 'api-football'
              and provider_player_id = 1300000
          `,
        ),
      "player accepted review status without a Russian name",
    );
    await assertCheckConstraintViolation(
      client,
      "player_name_without_status",
      () =>
        client.query(
          `
            update football.players
            set name_ru = 'Игрок статистики', name_ru_review_status = null
            where provider = 'api-football'
              and provider_player_id = 1300000
          `,
        ),
      "player accepted a Russian name without review status",
    );

    await client.query(
      `
        update football.players
        set name_ru = 'Игрок статистики', name_ru_review_status = 'reviewed'
        where provider = 'api-football'
          and provider_player_id = 1300000
      `,
    );

    const repeatedPlayerStatisticsSync = await syncSerieAPlayerStatistics({
      client: createFakeClient(),
      transactionClient: client,
    });

    assertCondition(
      repeatedPlayerStatisticsSync.status === "success" &&
        (await countFakePlayerStatistics(client)) === 21,
      "repeated player statistics sync was not idempotent",
    );

    const snapshotBeforeEmptyResponse = await getFirstPlayerStatisticsFacts(client);
    const emptyPlayerStatisticsSync = await syncSerieAPlayerStatistics({
      client: createFakeClient(
        "",
        createFixtures(),
        createStandings(),
        createSquadResponse,
        [[]],
      ),
      transactionClient: client,
    });

    assertCondition(
      emptyPlayerStatisticsSync.status === "failed" &&
        emptyPlayerStatisticsSync.errorCode ===
          "api_football_invalid_player_statistics",
      "empty player statistics snapshot was not rejected terminally",
    );
    assertCondition(
      (await countFakePlayerStatistics(client)) === 21,
      "empty player statistics snapshot changed the prior snapshot count",
    );

    const snapshotAfterEmptyResponse = await getFirstPlayerStatisticsFacts(client);

    assertCondition(
      snapshotAfterEmptyResponse.minutes === snapshotBeforeEmptyResponse.minutes &&
        JSON.stringify(snapshotAfterEmptyResponse.playerRaw) ===
          JSON.stringify(snapshotBeforeEmptyResponse.playerRaw) &&
        JSON.stringify(snapshotAfterEmptyResponse.statisticsRaw) ===
          JSON.stringify(snapshotBeforeEmptyResponse.statisticsRaw),
      "empty player statistics snapshot changed prior typed or raw facts",
    );

    const updatedPlayerStatisticsSync = await syncSerieAPlayerStatistics({
      client: createFakeClient(
        "",
        createFixtures(),
        createStandings(),
        createSquadResponse,
        createPlayerStatisticsPages({
          includeTransfer: false,
          firstAge: 25,
          firstMinutes: 45,
          marker: "updated",
        }),
      ),
      transactionClient: client,
    });

    assertCondition(
      updatedPlayerStatisticsSync.status === "success" &&
        updatedPlayerStatisticsSync.statisticsCount === 20 &&
        (await countFakePlayerStatistics(client)) === 20,
      "player statistics snapshot reconciliation failed",
    );

    const updatedPlayerStatisticsFacts = await getFirstPlayerStatisticsFacts(client);

    assertCondition(
      updatedPlayerStatisticsFacts.minutes === 45 &&
        (updatedPlayerStatisticsFacts.playerRaw.snapshot as
          | { marker?: unknown }
          | undefined)?.marker === "updated" &&
        (updatedPlayerStatisticsFacts.statisticsRaw.snapshot as
          | { marker?: unknown }
          | undefined)?.marker === "updated",
      "player profile/statistics provider snapshots did not update",
    );

    const localizedStatisticsPlayer = await getFakePlayerFacts(client, 1_300_000);

    assertCondition(
      localizedStatisticsPlayer.nameRu === "Игрок статистики" &&
        localizedStatisticsPlayer.nameRuReviewStatus === "reviewed",
      "player-statistics sync overwrote player localization or review status",
    );
    assertCondition(
      (await client.query<CountRow>(
        `
          select count(*)::int as count
          from football.players
          where provider = 'api-football'
            and provider_player_id >= 1300000
            and provider_player_id < 1400000
        `,
      )).rows[0]?.count === 20,
      "stale player statistics reconciliation deleted stable player entities",
    );

    const missingProviderClubId = crypto.randomUUID();

    await client.query(
      `
        insert into football.clubs (
          id,
          provider,
          provider_club_id,
          provider_name,
          code,
          country,
          founded,
          national,
          provider_logo_url,
          slug
        )
        values ($1, 'api-football', 999999, 'Missing Provider Club', 'MPC', 'Italy', 1900, false, null, 'missing-provider-club-999999')
      `,
      [missingProviderClubId],
    );
    await client.query(
      `
        insert into football.season_clubs (season_id, club_id)
        values ($1, $2)
      `,
      [seasonId, missingProviderClubId],
    );

    const missingProviderSync = await syncSerieAFoundation({
      client: createFakeClient(),
      queryable: client,
    });

    assertCondition(
      missingProviderSync.status === "success",
      "missing-provider preservation sync failed",
    );

    const missingProviderRows = await client.query<CountRow>(
      `
        select count(*)::int as count
        from football.clubs
        where provider = 'api-football'
          and provider_club_id = 999999
      `,
    );

    assertCondition(
      missingProviderRows.rows[0]?.count === 1,
      "sync deleted a club that was missing from the provider response",
    );

    await client.query(
      `
        update football.clubs
        set slug = 'milan-manual'
        where provider = 'api-football'
          and provider_club_id = 900000
      `,
    );

    const updatedProviderSync = await syncSerieAFoundation({
      client: createFakeClient(" Updated"),
      queryable: client,
    });

    assertCondition(
      updatedProviderSync.status === "success",
      "provider update fake sync failed",
    );

    const ownership = await client.query<ClubOwnershipRow>(
      `
        select
          slug,
          name_ru as "nameRu",
          name_ru_review_status as "nameRuReviewStatus",
          provider_name as "providerName"
        from football.clubs
        where provider = 'api-football'
          and provider_club_id = 900000
      `,
    );
    const row = ownership.rows[0];

    assertCondition(row?.slug === "milan-manual", "club slug was overwritten");
    assertCondition(row.nameRu === "Милан", "club name_ru was overwritten");
    assertCondition(
      row.nameRuReviewStatus === "reviewed",
      "club name_ru_review_status was overwritten",
    );
    assertCondition(
      row.providerName === "AC Milan Updated",
      "provider-owned club name did not update",
    );

    const competitionOwnership = await client.query<LocalizationOwnershipRow>(
      `
        select
          provider_name as "providerName",
          name_ru as "nameRu",
          name_ru_review_status as "nameRuReviewStatus"
        from football.competitions
        where provider = 'api-football'
          and provider_competition_id = 135
      `,
    );

    assertCondition(
      competitionOwnership.rows[0]?.nameRu === "Серия А" &&
        competitionOwnership.rows[0]?.nameRuReviewStatus === "reviewed",
      "foundation sync overwrote competition localization or review status",
    );

    const listedClubs = await listCurrentSerieAClubs(client);

    assertCondition(
      listedClubs.some((club) => club.displayName === "Милан"),
      "public club listing did not use application display name",
    );
    assertCondition(
      listedClubs.some((club) => club.displayName === "Serie A Club 2") &&
        !listedClubs.some((club) => club.displayName === "Черновик клуба"),
      "public club listing exposed unreviewed application localization",
    );

    const listedStandings = await listCurrentSerieAStandings(client);

    assertCondition(listedStandings.length === 20, "public standings listing count mismatch");
    const listedMilanStanding = listedStandings.find(
      (standing) => standing.club.displayName === "Милан",
    );

    assertCondition(
      listedMilanStanding,
      "public standings listing did not use application-owned club display name",
    );
    assertCondition(
      listedMilanStanding.description === "  Europa League  ",
      "public standings listing changed provider description",
    );

    const initialMatchesSync = await syncSerieAMatches({
      client: createFakeClient(),
      transactionClient: client,
    });

    assertCondition(initialMatchesSync.status === "success", "initial matches sync failed");
    assertCondition(
      initialMatchesSync.matchCount === 380,
      "initial matches sync count mismatch",
    );
    assertCondition(await countFakeMatches(client) === 380, "match count mismatch");
    assertCondition(
      await countDuplicateMatchIdentities(client) === 0,
      "match provider identities are not unique",
    );

    const initialMatchFacts = await getFirstMatchFacts(client);

    assertCondition(
      initialMatchFacts.kickoffAt?.toISOString() === "2026-08-22T18:45:00.000Z",
      "match kickoff was not persisted",
    );
    assertCondition(initialMatchFacts.referee === "Referee One", "match referee mismatch");
    assertCondition(initialMatchFacts.providerVenueId === 12_345, "venue id mismatch");
    assertCondition(initialMatchFacts.venueName === "San Siro", "venue name mismatch");
    assertCondition(initialMatchFacts.venueCity === "Milano", "venue city mismatch");
    assertCondition(initialMatchFacts.status === "finished", "status mapping mismatch");
    assertCondition(
      initialMatchFacts.pollingCategory === "TERMINAL",
      "polling category mapping mismatch",
    );
    assertCondition(
      initialMatchFacts.homeWinner === true && initialMatchFacts.awayWinner === false,
      "winner facts were not persisted independently",
    );
    assertCondition(
      initialMatchFacts.homeGoals === 2 && initialMatchFacts.awayGoals === 1,
      "match goals were not persisted",
    );
    assertCondition(
      initialMatchFacts.halftimeHome === 1 &&
        initialMatchFacts.halftimeAway === 0 &&
        initialMatchFacts.fulltimeHome === 2 &&
        initialMatchFacts.fulltimeAway === 1,
      "match score breakdown was not persisted",
    );
    assertCondition(
      (initialMatchFacts.providerRaw.coverage as { marker?: unknown } | undefined)
        ?.marker === "initial",
      "complete provider snapshot was not persisted",
    );

    const repeatedMatchesSync = await syncSerieAMatches({
      client: createFakeClient(),
      transactionClient: client,
    });

    assertCondition(repeatedMatchesSync.status === "success", "repeated matches sync failed");
    assertCondition(
      await countFakeMatches(client) === 380,
      "repeated matches sync created duplicate rows",
    );

    const updatedMatchesSync = await syncSerieAMatches({
      client: createFakeClient(
        "",
        createFixtures({
          firstKickoff: "2026-08-23T19:45:00+00:00",
          firstReferee: "Referee Updated",
          firstVenueName: "Giuseppe Meazza",
          firstSnapshotMarker: "updated",
        }),
      ),
      transactionClient: client,
    });

    assertCondition(updatedMatchesSync.status === "success", "match update sync failed");

    const updatedMatchFacts = await getFirstMatchFacts(client);

    assertCondition(
      updatedMatchFacts.kickoffAt?.toISOString() === "2026-08-23T19:45:00.000Z",
      "kickoff reschedule was not persisted",
    );
    assertCondition(
      updatedMatchFacts.referee === "Referee Updated" &&
        updatedMatchFacts.venueName === "Giuseppe Meazza",
      "provider-owned referee or venue did not update",
    );
    assertCondition(
      (updatedMatchFacts.providerRaw.coverage as { marker?: unknown } | undefined)
        ?.marker === "updated",
      "provider snapshot was not replaced on update",
    );

    const missingProviderMatchSync = await syncSerieAMatches({
      client: createFakeClient(
        "",
        createFixtures({
          firstKickoff: "2026-08-23T19:45:00+00:00",
          firstReferee: "Referee Updated",
          firstVenueName: "Giuseppe Meazza",
          firstSnapshotMarker: "updated",
          lastFixtureId: 920_000,
        }),
      ),
      transactionClient: client,
    });

    assertCondition(
      missingProviderMatchSync.status === "success",
      "missing-provider match preservation sync failed",
    );
    assertCondition(
      await countFakeMatches(client) === 381,
      "a match missing from the latest provider response was deleted",
    );

    const invalidClubSync = await syncSerieAMatches({
      client: createFakeClient(
        "",
        createFixtures({
          firstVenueName: "Must Not Persist",
          unknownClubAtIndex: 200,
        }),
      ),
      transactionClient: client,
    });

    assertCondition(
      invalidClubSync.status === "failed" &&
        invalidClubSync.errorCode === "api_football_fixture_club_not_found",
      "unknown season club did not fail the matches sync",
    );
    assertCondition(
      (await getFirstMatchFacts(client)).venueName === "Giuseppe Meazza",
      "failed all-or-nothing sync persisted a partial match update",
    );
    assertCondition(
      await countFakeMatches(client) === 381,
      "failed all-or-nothing sync changed persisted match count",
    );

    const listedMatches = await listCurrentSerieAMatches(client);

    assertCondition(listedMatches.length === 381, "public match listing count mismatch");
    assertCondition(
      listedMatches.some(
        (match) =>
          match.homeClub.displayName === "Милан" &&
          match.homeClub.slug === "milan-manual" &&
          Boolean(match.awayClub.slug),
      ),
      "public match listing did not expose canonical Club identities",
    );

    const clubPageData = await getCurrentSerieAClubPageData(client, "milan-manual");

    assertCondition(clubPageData, "current Serie A Club Page read model was not found");
    assertCondition(
      clubPageData.club.displayName === "Милан" &&
        clubPageData.competition.displayName === "Серия А" &&
        clubPageData.season.displayLabel === "2026/27",
      "Club Page profile did not preserve reviewed localization or current season scope",
    );
    assertCondition(
      clubPageData.standing?.rank === listedMilanStanding.rank,
      "Club Page standing mismatch",
    );
    assertCondition(
      clubPageData.recentMatches.length > 0 && clubPageData.upcomingMatches.length > 0,
      "Club Page bounded match sections were not populated",
    );
    assertCondition(
      [...clubPageData.recentMatches, ...clubPageData.upcomingMatches].every(
        (match) => Boolean(match.homeClub.slug) && Boolean(match.awayClub.slug),
      ),
      "Club Page matches did not expose canonical Club identities",
    );
    assertCondition(clubPageData.squad.length > 0, "Club Page current squad was not populated");
    assertCondition(
      clubPageData.squad.every((player) => Boolean(player.publicPlayerSlug)),
      "Club Page eligible current squad did not expose canonical Player identities",
    );
    assertCondition(
      await getCurrentSerieAClubPageData(client, "unknown-club") === null,
      "unknown Club Page slug did not return null",
    );
    assertCondition(
      await currentSerieAClubSlugExists(client, "milan-manual"),
      "current Serie A Club Page slug existence check failed",
    );
    assertCondition(
      !(await currentSerieAClubSlugExists(client, "unknown-club")),
      "unknown Club Page slug passed the existence check",
    );

    const clubPageSlugs = await listCurrentSerieAClubSlugs(client);

    assertCondition(
      clubPageSlugs.length === listedClubs.length &&
        clubPageSlugs.includes("milan-manual") &&
        clubPageSlugs.includes("missing-provider-club-999999"),
      "Club Page sitemap slug scope mismatch",
    );

    await client.query(
      `
        insert into football.players (
          id,
          provider,
          provider_player_id,
          provider_name,
          slug
        )
        values ($1, 'api-football', 1999999, 'Stale Player', 'stale-player-1999999')
      `,
      [crypto.randomUUID()],
    );

    const membershipOnlyPlayer = await getCurrentSerieAPlayerPageData(
      client,
      "player-1100000-1100000",
    );
    const statisticsOnlyPlayer = await getCurrentSerieAPlayerPageData(
      client,
      "statistics-player-1300000-1300000",
    );

    assertCondition(
      membershipOnlyPlayer?.memberships.length === 2 &&
        membershipOnlyPlayer.statistics.length === 0 &&
        membershipOnlyPlayer.player.displayName === "Игрок состава",
      "Player Page membership-only eligibility/read model mismatch",
    );
    assertCondition(
      statisticsOnlyPlayer?.memberships.length === 0 &&
        statisticsOnlyPlayer.statistics.length === 1 &&
        statisticsOnlyPlayer.player.displayName === "Игрок статистики",
      "Player Page statistics-only eligibility/read model mismatch",
    );
    assertCondition(
      (await getCurrentSerieAPlayerPageData(client, "stale-player-1999999")) === null,
      "stale Player Page slug was treated as eligible",
    );
    assertCondition(
      await currentSerieAPlayerSlugExists(client, "player-1100000-1100000"),
      "membership-only Player Page slug existence check failed",
    );
    assertCondition(
      await currentSerieAPlayerSlugExists(
        client,
        "statistics-player-1300000-1300000",
      ),
      "statistics-only Player Page slug existence check failed",
    );
    assertCondition(
      !(await currentSerieAPlayerSlugExists(client, "stale-player-1999999")),
      "stale Player Page slug passed the existence check",
    );

    const eligiblePlayerSlugs = await listCurrentSerieAEligiblePlayerSlugs(client);

    assertCondition(
      eligiblePlayerSlugs.includes("player-1100000-1100000") &&
        eligiblePlayerSlugs.includes("statistics-player-1300000-1300000") &&
        !eligiblePlayerSlugs.includes("stale-player-1999999") &&
        new Set(eligiblePlayerSlugs).size === eligiblePlayerSlugs.length,
      "Player Page sitemap eligibility scope mismatch",
    );
  } finally {
    if (transactionStarted) {
      await client.query("rollback");
    }

    client.release();
  }
}

async function verifyProductionPoolRollback(
  runtimeDatabaseUrl: string,
  migrationPool: pg.Pool,
): Promise<void> {
  const firstFixtureId = 1_930_000;
  const lastFixtureId = firstFixtureId + 379;
  const forcedFailureMessage = "stage43_forced_failure_after_match_insert";
  const rollbackTestPool = new Pool({
    connectionString: runtimeDatabaseUrl,
    max: 1,
  });
  const originalConnect = rollbackTestPool.connect.bind(rollbackTestPool);
  let insertedMatchMutations = 0;
  let firstMutationObserved = false;
  let rollbackObserved = false;
  let expectedFailureObserved = false;

  assertCondition(
    (await countProviderMatchesInRange(
      migrationPool,
      firstFixtureId,
      lastFixtureId,
    )) === 0,
    "rollback test fixture identity range is not empty",
  );

  rollbackTestPool.connect = (async () => {
    const client = await originalConnect();
    const executeQuery = client.query.bind(client) as unknown as (
      queryText: string,
      values?: unknown[],
    ) => Promise<pg.QueryResult>;

    const instrumentedQuery = async (queryText: unknown, values?: unknown[]) => {
      assertCondition(
        typeof queryText === "string",
        "rollback test received an unsupported PostgreSQL query shape",
      );

      const normalizedQuery = queryText.trim().toLowerCase();

      if (normalizedQuery === "begin") {
        const result = await executeQuery(queryText, values);
        const foundationResult = await syncSerieAFoundation({
          client: createFakeClient(),
          queryable: client,
        });

        assertCondition(
          foundationResult.status === "success",
          "rollback test could not prepare Football foundation rows",
        );

        return result;
      }

      if (queryText.includes("insert into football.matches")) {
        if (insertedMatchMutations >= 1) {
          throw new Error(forcedFailureMessage);
        }

        const result = await executeQuery(queryText, values);

        insertedMatchMutations += 1;

        const observedMutation = await client.query<CountRow>(
          `
            select count(*)::int as count
            from football.matches
            where provider = 'api-football'
              and provider_fixture_id = $1
          `,
          [firstFixtureId],
        );

        firstMutationObserved = observedMutation.rows[0]?.count === 1;

        return result;
      }

      if (normalizedQuery === "rollback") {
        const result = await executeQuery(queryText, values);

        rollbackObserved = true;

        return result;
      }

      return executeQuery(queryText, values);
    };

    return new Proxy(client, {
      get(target, property) {
        if (property === "query") {
          return instrumentedQuery;
        }

        const value = Reflect.get(target, property, target);

        return typeof value === "function" ? value.bind(target) : value;
      },
    });
  }) as typeof rollbackTestPool.connect;

  try {
    try {
      await syncSerieAMatches({
        client: createFakeClient(
          "",
          createFixtures({ baseFixtureId: firstFixtureId }),
        ),
        pool: rollbackTestPool,
      });
    } catch (error) {
      if (error instanceof Error && error.message === forcedFailureMessage) {
        expectedFailureObserved = true;
      } else {
        throw error;
      }
    }

    assertCondition(expectedFailureObserved, "rollback test sync did not fail as expected");
    assertCondition(
      insertedMatchMutations === 1 && firstMutationObserved,
      "rollback test did not observe a persisted match mutation before failure",
    );
    assertCondition(rollbackObserved, "production Pool path did not execute rollback");
    assertCondition(
      (await countProviderMatchesInRange(
        migrationPool,
        firstFixtureId,
        lastFixtureId,
      )) === 0,
      "production Pool rollback left partial match rows persisted",
    );
  } finally {
    await rollbackTestPool.end();
  }
}

async function verifyStandingsProductionPoolRollback(
  runtimeDatabaseUrl: string,
  migrationPool: pg.Pool,
): Promise<void> {
  const forcedFailureMessage = "stage44_forced_failure_after_standing_insert";
  const rollbackTestPool = new Pool({
    connectionString: runtimeDatabaseUrl,
    max: 1,
  });
  const originalConnect = rollbackTestPool.connect.bind(rollbackTestPool);
  let insertedStandingMutations = 0;
  let firstMutationObserved = false;
  let rollbackObserved = false;
  let expectedFailureObserved = false;

  assertCondition(
    (await countFakeStandings(migrationPool)) === 0,
    "standings rollback test requires an empty current table",
  );

  rollbackTestPool.connect = (async () => {
    const client = await originalConnect();
    const executeQuery = client.query.bind(client) as unknown as (
      queryText: string,
      values?: unknown[],
    ) => Promise<pg.QueryResult>;

    const instrumentedQuery = async (queryText: unknown, values?: unknown[]) => {
      assertCondition(
        typeof queryText === "string",
        "standings rollback test received an unsupported PostgreSQL query shape",
      );

      const normalizedQuery = queryText.trim().toLowerCase();

      if (normalizedQuery === "begin") {
        const result = await executeQuery(queryText, values);
        const foundationResult = await syncSerieAFoundation({
          client: createFakeClient(),
          queryable: client,
        });

        assertCondition(
          foundationResult.status === "success",
          "standings rollback test could not prepare Football foundation rows",
        );

        return result;
      }

      if (queryText.includes("insert into football.standings")) {
        if (insertedStandingMutations >= 1) {
          throw new Error(forcedFailureMessage);
        }

        const result = await executeQuery(queryText, values);

        insertedStandingMutations += 1;

        const observedMutation = await client.query<CountRow>(
          "select count(*)::int as count from football.standings",
        );

        firstMutationObserved = observedMutation.rows[0]?.count === 1;

        return result;
      }

      if (normalizedQuery === "rollback") {
        const result = await executeQuery(queryText, values);

        rollbackObserved = true;

        return result;
      }

      return executeQuery(queryText, values);
    };

    return new Proxy(client, {
      get(target, property) {
        if (property === "query") {
          return instrumentedQuery;
        }

        const value = Reflect.get(target, property, target);

        return typeof value === "function" ? value.bind(target) : value;
      },
    });
  }) as typeof rollbackTestPool.connect;

  try {
    try {
      await syncSerieAStandings({
        client: createFakeClient(),
        pool: rollbackTestPool,
      });
    } catch (error) {
      if (error instanceof Error && error.message === forcedFailureMessage) {
        expectedFailureObserved = true;
      } else {
        throw error;
      }
    }

    assertCondition(
      expectedFailureObserved,
      "standings rollback test sync did not fail as expected",
    );
    assertCondition(
      insertedStandingMutations === 1 && firstMutationObserved,
      "standings rollback test did not observe a mutation before failure",
    );
    assertCondition(
      rollbackObserved,
      "standings production Pool path did not execute rollback",
    );
    assertCondition(
      (await countFakeStandings(migrationPool)) === 0,
      "standings production Pool rollback left partial rows persisted",
    );
  } finally {
    await rollbackTestPool.end();
  }
}

async function cleanupSquadsRollbackFixture(
  migrationPool: pg.Pool,
  options: {
    removeCompetition: boolean;
    removeSeason: boolean;
  },
): Promise<void> {
  const client = await migrationPool.connect();
  let transactionStarted = false;

  try {
    await client.query("begin");
    transactionStarted = true;

    await client.query(`
      delete from football.player_statistics ps
      using football.players p
      where ps.player_id = p.id
        and p.provider = 'api-football'
        and p.provider_player_id >= 1300000
        and p.provider_player_id < 1400000
    `);
    await client.query(`
      delete from football.squad_memberships sm
      using football.clubs c
      where sm.club_id = c.id
        and c.provider = 'api-football'
        and c.provider_club_id >= 900000
        and c.provider_club_id < 900020
    `);
    await client.query(`
      delete from football.players
      where provider = 'api-football'
        and provider_player_id >= 1100000
        and provider_player_id < 1400000
    `);
    await client.query(`
      delete from football.season_clubs sc
      using football.clubs c
      where sc.club_id = c.id
        and c.provider = 'api-football'
        and c.provider_club_id >= 900000
        and c.provider_club_id < 900020
    `);
    await client.query(`
      delete from football.clubs
      where provider = 'api-football'
        and provider_club_id >= 900000
        and provider_club_id < 900020
    `);

    if (options.removeSeason) {
      await client.query(`
        delete from football.seasons s
        using football.competitions comp
        where s.competition_id = comp.id
          and comp.provider = 'api-football'
          and comp.provider_competition_id = 135
          and s.provider = 'api-football'
          and s.provider_season_year = 2026
          and not exists (
            select 1 from football.season_clubs sc where sc.season_id = s.id
          )
          and not exists (
            select 1 from football.matches m where m.season_id = s.id
          )
          and not exists (
            select 1 from football.standings st where st.season_id = s.id
          )
          and not exists (
            select 1 from football.player_statistics ps where ps.season_id = s.id
          )
      `);
    }

    if (options.removeCompetition) {
      await client.query(`
        delete from football.competitions comp
        where comp.provider = 'api-football'
          and comp.provider_competition_id = 135
          and not exists (
            select 1 from football.seasons s where s.competition_id = comp.id
          )
      `);
    }

    await client.query("commit");
    transactionStarted = false;
  } finally {
    if (transactionStarted) {
      await client.query("rollback");
    }

    client.release();
  }
}

async function verifySquadsProductionPoolRollback(
  runtimeDatabaseUrl: string,
  migrationPool: pg.Pool,
): Promise<void> {
  const forcedFailureMessage = "stage45_forced_failure_after_player_update";
  const rollbackTestPool = new Pool({
    connectionString: runtimeDatabaseUrl,
    max: 1,
  });
  const originalConnect = rollbackTestPool.connect.bind(rollbackTestPool);
  let setupTransactionStarted = false;
  let playerMutationObserved = false;
  let rollbackObserved = false;
  let expectedFailureObserved = false;
  const staleFixtureCounts = await migrationPool.query<{
    clubCount: number;
    membershipCount: number;
    playerCount: number;
    seasonClubCount: number;
  }>(`
    select
      (
        select count(*)::int
        from football.clubs
        where provider = 'api-football'
          and provider_club_id >= 900000
          and provider_club_id < 900020
      ) as "clubCount",
      (
        select count(*)::int
        from football.players
        where provider = 'api-football'
          and provider_player_id >= 1100000
          and provider_player_id < 1300000
      ) as "playerCount",
      (
        select count(*)::int
        from football.squad_memberships sm
        join football.clubs c on c.id = sm.club_id
        where c.provider = 'api-football'
          and c.provider_club_id >= 900000
          and c.provider_club_id < 900020
      ) as "membershipCount",
      (
        select count(*)::int
        from football.season_clubs sc
        join football.clubs c on c.id = sc.club_id
        where c.provider = 'api-football'
          and c.provider_club_id >= 900000
          and c.provider_club_id < 900020
      ) as "seasonClubCount"
  `);
  const staleFixture = staleFixtureCounts.rows[0];
  const hasStaleFixture =
    (staleFixture?.clubCount ?? 0) > 0 ||
    (staleFixture?.playerCount ?? 0) > 0 ||
    (staleFixture?.membershipCount ?? 0) > 0 ||
    (staleFixture?.seasonClubCount ?? 0) > 0;

  if (hasStaleFixture) {
    assertCondition(
      staleFixture?.clubCount === 20 &&
        staleFixture.playerCount === 40 &&
        staleFixture.membershipCount === 40 &&
        staleFixture.seasonClubCount === 20,
      "squads rollback fixture range contains an unexpected partial data set",
    );
    await cleanupSquadsRollbackFixture(migrationPool, {
      removeCompetition: true,
      removeSeason: true,
    });
  }

  const initialScopeState = await migrationPool.query<{
    competitionCount: number;
    seasonCount: number;
  }>(`
    select
      count(distinct comp.id)::int as "competitionCount",
      count(distinct s.id)::int as "seasonCount"
    from football.competitions comp
    left join football.seasons s
      on s.competition_id = comp.id
      and s.provider = 'api-football'
      and s.provider_season_year = 2026
    where comp.provider = 'api-football'
      and comp.provider_competition_id = 135
  `);
  const competitionExisted = (initialScopeState.rows[0]?.competitionCount ?? 0) > 0;
  const seasonExisted = (initialScopeState.rows[0]?.seasonCount ?? 0) > 0;

  assertCondition(
    (await countFakeClubs(migrationPool)) === 0 &&
      (await countFakePlayers(migrationPool)) === 0 &&
      (await countFakeSquadMemberships(migrationPool)) === 0,
    "squads rollback fixture identities must be absent before setup",
  );

  const setupClient = await migrationPool.connect();

  try {
    await setupClient.query("begin");
    setupTransactionStarted = true;

    const foundationResult = await syncSerieAFoundation({
      client: createFakeClient(),
      queryable: setupClient,
    });
    assertCondition(
      foundationResult.status === "success",
      "squads rollback test could not prepare Football foundation rows",
    );

    const squadsResult = await syncSerieASquads({
      client: createFakeClient(),
      transactionClient: setupClient,
    });
    assertCondition(
      squadsResult.status === "success",
      "squads rollback test could not prepare the complete prior snapshot",
    );

    await setupClient.query("commit");
    setupTransactionStarted = false;
  } finally {
    if (setupTransactionStarted) {
      await setupClient.query("rollback");
    }

    setupClient.release();
  }

  rollbackTestPool.query = (async (queryText: unknown, values?: unknown[]) => {
    assertCondition(
      typeof queryText === "string",
      "squads rollback preflight received an unsupported PostgreSQL query shape",
    );

    const client = await originalConnect();

    try {
      return await client.query(queryText, values);
    } finally {
      client.release();
    }
  }) as typeof rollbackTestPool.query;

  rollbackTestPool.connect = (async () => {
    const client = await originalConnect();
    const executeQuery = client.query.bind(client) as unknown as (
      queryText: string,
      values?: unknown[],
    ) => Promise<pg.QueryResult>;
    let transactionActive = false;

    const instrumentedQuery = async (queryText: unknown, values?: unknown[]) => {
      assertCondition(
        typeof queryText === "string",
        "squads rollback test received an unsupported PostgreSQL query shape",
      );

      const normalizedQuery = queryText.trim().toLowerCase();

      if (normalizedQuery === "begin") {
        const result = await executeQuery(queryText, values);
        transactionActive = true;

        return result;
      }

      if (transactionActive && queryText.includes("insert into football.players")) {
        const result = await executeQuery(queryText, values);
        const observedMutation = await executeQuery(
          `
            select count(*)::int as count
            from football.players
            where provider = 'api-football'
              and provider_player_id = 1100000
              and provider_name = 'Rollback Updated Player'
          `,
        );

        playerMutationObserved =
          (observedMutation.rows[0] as CountRow | undefined)?.count === 1;

        return result;
      }

      if (
        transactionActive &&
        playerMutationObserved &&
        queryText.includes("insert into football.squad_memberships")
      ) {
        throw new Error(forcedFailureMessage);
      }

      if (normalizedQuery === "rollback") {
        const result = await executeQuery(queryText, values);
        rollbackObserved = true;
        transactionActive = false;

        return result;
      }

      return executeQuery(queryText, values);
    };

    return new Proxy(client, {
      get(target, property) {
        if (property === "query") {
          return instrumentedQuery;
        }

        const value = Reflect.get(target, property, target);

        return typeof value === "function" ? value.bind(target) : value;
      },
    });
  }) as typeof rollbackTestPool.connect;

  try {
    try {
      await syncSerieASquads({
        client: createFakeClient(
          "",
          createFixtures(),
          createStandings(),
          (providerClubId) => {
            const response = createSquadResponse(providerClubId);

            if (providerClubId === 900_000) {
              response[0]!.players[0] = createSquadPlayer(1_100_000, {
                name: "Rollback Updated Player",
                position: "Rollback Provider Position",
                snapshotMarker: "rollback-attempt",
              });
            }

            return response;
          },
        ),
        pool: rollbackTestPool,
      });
    } catch (error) {
      if (error instanceof Error && error.message === forcedFailureMessage) {
        expectedFailureObserved = true;
      } else {
        throw error;
      }
    }

    assertCondition(
      expectedFailureObserved,
      "squads rollback test sync did not fail as expected",
    );
    assertCondition(
      playerMutationObserved,
      "squads rollback test did not observe a player update before failure",
    );
    assertCondition(
      rollbackObserved,
      "squads production Pool path did not execute rollback",
    );
    assertCondition(
      (await countFakePlayers(migrationPool)) === 40 &&
        (await countFakeSquadMemberships(migrationPool)) === 40,
      "squads production Pool rollback changed the complete prior snapshot",
    );

    const playerAfterRollback = await getFakePlayerFacts(migrationPool);
    const membershipAfterRollback = await getFakeMembershipFacts(migrationPool);

    assertCondition(
      playerAfterRollback.providerName === "Player 1100000",
      "squads production Pool rollback left a partial player update",
    );
    assertCondition(
      membershipAfterRollback?.position === "Provider Position" &&
        membershipAfterRollback.providerRaw.length === 1 &&
        (membershipAfterRollback.providerRaw[0]?.snapshot as
          | { marker?: unknown }
          | undefined)?.marker === "initial",
      "squads production Pool rollback changed the prior membership snapshot",
    );
  } finally {
    await rollbackTestPool.end();
    await cleanupSquadsRollbackFixture(
      migrationPool,
      {
        removeCompetition: !competitionExisted,
        removeSeason: !seasonExisted,
      },
    );
  }
}

async function verifyPlayerStatisticsProductionPoolRollback(
  runtimeDatabaseUrl: string,
  migrationPool: pg.Pool,
): Promise<void> {
  const forcedFailureMessage =
    "stage46_forced_failure_after_player_statistics_mutation";
  const rollbackTestPool = new Pool({
    connectionString: runtimeDatabaseUrl,
    max: 1,
  });
  const originalConnect = rollbackTestPool.connect.bind(rollbackTestPool);
  let setupTransactionStarted = false;
  let firstMutationObserved = false;
  let rollbackObserved = false;
  let expectedFailureObserved = false;

  const initialScopeState = await migrationPool.query<{
    competitionCount: number;
    seasonCount: number;
  }>(`
    select
      count(distinct comp.id)::int as "competitionCount",
      count(distinct s.id)::int as "seasonCount"
    from football.competitions comp
    left join football.seasons s
      on s.competition_id = comp.id
      and s.provider = 'api-football'
      and s.provider_season_year = 2026
    where comp.provider = 'api-football'
      and comp.provider_competition_id = 135
  `);
  const competitionExisted = (initialScopeState.rows[0]?.competitionCount ?? 0) > 0;
  const seasonExisted = (initialScopeState.rows[0]?.seasonCount ?? 0) > 0;

  if (
    (await countFakeClubs(migrationPool)) > 0 ||
    (await countFakePlayerStatistics(migrationPool)) > 0
  ) {
    await cleanupSquadsRollbackFixture(migrationPool, {
      removeCompetition: true,
      removeSeason: true,
    });
  }

  const setupClient = await migrationPool.connect();

  try {
    await setupClient.query("begin");
    setupTransactionStarted = true;

    const foundationResult = await syncSerieAFoundation({
      client: createFakeClient(),
      queryable: setupClient,
    });
    assertCondition(
      foundationResult.status === "success",
      "player statistics rollback test could not prepare Football foundation rows",
    );

    const statisticsResult = await syncSerieAPlayerStatistics({
      client: createFakeClient(),
      transactionClient: setupClient,
    });
    assertCondition(
      statisticsResult.status === "success" &&
        statisticsResult.statisticsCount === 21,
      "player statistics rollback test could not prepare the prior snapshot",
    );

    await setupClient.query("commit");
    setupTransactionStarted = false;
  } finally {
    if (setupTransactionStarted) {
      await setupClient.query("rollback");
    }

    setupClient.release();
  }

  rollbackTestPool.query = (async (queryText: unknown, values?: unknown[]) => {
    assertCondition(
      typeof queryText === "string",
      "player statistics rollback preflight received an unsupported query shape",
    );
    const client = await originalConnect();

    try {
      return await client.query(queryText, values);
    } finally {
      client.release();
    }
  }) as typeof rollbackTestPool.query;

  rollbackTestPool.connect = (async () => {
    const client = await originalConnect();
    const executeQuery = client.query.bind(client) as unknown as (
      queryText: string,
      values?: unknown[],
    ) => Promise<pg.QueryResult>;
    let transactionActive = false;
    let statisticsMutations = 0;

    const instrumentedQuery = async (queryText: unknown, values?: unknown[]) => {
      assertCondition(
        typeof queryText === "string",
        "player statistics rollback test received an unsupported query shape",
      );
      const normalizedQuery = queryText.trim().toLowerCase();

      if (normalizedQuery === "begin") {
        const result = await executeQuery(queryText, values);
        transactionActive = true;
        return result;
      }

      if (
        transactionActive &&
        queryText.includes("insert into football.player_statistics")
      ) {
        if (statisticsMutations >= 1) {
          throw new Error(forcedFailureMessage);
        }

        const result = await executeQuery(queryText, values);
        statisticsMutations += 1;
        const observed = await executeQuery(
          `
            select count(*)::int as count
            from football.player_statistics ps
            join football.players p on p.id = ps.player_id
            where p.provider = 'api-football'
              and p.provider_player_id = 1300000
              and ps.statistics_raw->'snapshot'->>'marker' = 'rollback-attempt'
          `,
        );
        firstMutationObserved =
          (observed.rows[0] as CountRow | undefined)?.count === 1;
        return result;
      }

      if (normalizedQuery === "rollback") {
        const result = await executeQuery(queryText, values);
        rollbackObserved = true;
        transactionActive = false;
        return result;
      }

      return executeQuery(queryText, values);
    };

    return new Proxy(client, {
      get(target, property) {
        if (property === "query") {
          return instrumentedQuery;
        }

        const value = Reflect.get(target, property, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
  }) as typeof rollbackTestPool.connect;

  try {
    try {
      await syncSerieAPlayerStatistics({
        client: createFakeClient(
          "",
          createFixtures(),
          createStandings(),
          createSquadResponse,
          createPlayerStatisticsPages({
            firstAge: 25,
            firstMinutes: 77,
            marker: "rollback-attempt",
          }),
        ),
        pool: rollbackTestPool,
      });
    } catch (error) {
      if (error instanceof Error && error.message === forcedFailureMessage) {
        expectedFailureObserved = true;
      } else {
        throw error;
      }
    }

    assertCondition(
      expectedFailureObserved,
      "player statistics rollback sync did not fail as expected",
    );
    assertCondition(
      firstMutationObserved,
      "player statistics rollback test did not observe a mutation before failure",
    );
    assertCondition(
      rollbackObserved,
      "player statistics production Pool path did not execute rollback",
    );
    assertCondition(
      (await countFakePlayerStatistics(migrationPool)) === 21,
      "player statistics rollback changed the prior snapshot count",
    );

    const factsAfterRollback = await getFirstPlayerStatisticsFacts(migrationPool);

    assertCondition(
      factsAfterRollback.minutes === null &&
        (factsAfterRollback.statisticsRaw.snapshot as
          | { marker?: unknown }
          | undefined)?.marker === "initial",
      "player statistics production Pool rollback left partial snapshot changes",
    );
  } finally {
    await rollbackTestPool.end();
    await cleanupSquadsRollbackFixture(migrationPool, {
      removeCompetition: !competitionExisted,
      removeSeason: !seasonExisted,
    });
  }
}

async function verifyRuntimeGrants(runtimePool: pg.Pool): Promise<void> {
  const client = await runtimePool.connect();
  let transactionStarted = false;

  try {
    await client.query("begin");
    transactionStarted = true;

    const result = await syncSerieAFoundation({
      client: createFakeClient(),
      queryable: client,
    });

    assertCondition(result.status === "success", "runtime role fake sync failed");

    const matchesResult = await syncSerieAMatches({
      client: createFakeClient(),
      transactionClient: client,
    });

    assertCondition(
      matchesResult.status === "success",
      "runtime role matches fake sync failed",
    );

    const standingsResult = await syncSerieAStandings({
      client: createFakeClient(),
      transactionClient: client,
    });

    assertCondition(
      standingsResult.status === "success",
      "runtime role standings fake sync failed",
    );

    const squadsResult = await syncSerieASquads({
      client: createFakeClient(),
      transactionClient: client,
    });

    assertCondition(
      squadsResult.status === "success",
      "runtime role current squads fake sync failed",
    );

    const playerStatisticsResult = await syncSerieAPlayerStatistics({
      client: createFakeClient(),
      transactionClient: client,
    });

    assertCondition(
      playerStatisticsResult.status === "success",
      "runtime role player statistics fake sync failed",
    );
  } finally {
    if (transactionStarted) {
      await client.query("rollback");
    }

    client.release();
  }

  await assertDeleteDenied(runtimePool, "clubs");
  await assertDeleteDenied(runtimePool, "matches");
  await assertDeleteDenied(runtimePool, "players");
  await assertDeleteDenied(runtimePool, "standings");
  await runtimePool.query("delete from football.squad_memberships where false");
  await runtimePool.query("delete from football.player_statistics where false");
  await assertDdlDenied(runtimePool);
}

async function verifyJobRunnerPath(runtimePool: pg.Pool, migrationPool: pg.Pool): Promise<void> {
  const type = `stage46-football-check-${crypto.randomUUID()}`;
  const repository = new JobRepository(getJobRunnerConfig());
  const definition: JobDefinition = {
    type,
    parseArguments: (args) => {
      assertCondition(args.length === 0, "check job unexpectedly received args");

      return {
        idempotencyKey: SERIE_A_PLAYER_STATISTICS_IDEMPOTENCY_KEY,
        payload: {
          type: SERIE_A_PLAYER_STATISTICS_JOB_TYPE,
          check: "football-player-statistics",
        },
      };
    },
    handle: async (context) => {
      const client = await runtimePool.connect();
      let transactionStarted = false;

      try {
        await client.query("begin");
        transactionStarted = true;

        await context.heartbeat();

        const foundationResult = await syncSerieAFoundation({
          client: createFakeClient(),
          queryable: client,
          heartbeat: context.heartbeat,
        });

        if (foundationResult.status !== "success") {
          return foundationResult;
        }

        const matchesResult = await syncSerieAMatches({
          client: createFakeClient(),
          transactionClient: client,
          heartbeat: context.heartbeat,
        });

        if (matchesResult.status !== "success") {
          return matchesResult;
        }

        const standingsResult = await syncSerieAStandings({
          client: createFakeClient(),
          transactionClient: client,
          heartbeat: context.heartbeat,
        });

        if (standingsResult.status !== "success") {
          return standingsResult;
        }

        const squadsResult = await syncSerieASquads({
          client: createFakeClient(),
          transactionClient: client,
          heartbeat: context.heartbeat,
        });

        if (squadsResult.status !== "success") {
          return squadsResult;
        }

        const playerStatisticsResult = await syncSerieAPlayerStatistics({
          client: createFakeClient(),
          transactionClient: client,
          heartbeat: context.heartbeat,
        });

        return playerStatisticsResult.status === "success"
          ? { status: "success" }
          : playerStatisticsResult;
      } finally {
        if (transactionStarted) {
          await client.query("rollback");
        }

        client.release();
      }
    },
  };

  try {
    const result = await runJobOnce({
      type,
      args: [],
      registry: createJobRegistry([definition]),
      config: getJobRunnerConfig(),
      repository,
      runnerId: "stage46-football-check",
    });

    assertCondition(result.exitCode === RUNNER_EXIT_CODES.success, "check job did not succeed");
    assertCondition(result.outcome.status === "success", "check job outcome was not success");
  } finally {
    await migrationPool.query("delete from jobs.executions where type = $1", [type]);
    await repository.close();
  }
}

async function main(): Promise<void> {
  const migrationPool = new Pool({
    connectionString: requireEnv("MIGRATION_DATABASE_URL"),
    max: 2,
  });
  const runtimePool = new Pool({
    connectionString: requireEnv("DATABASE_URL"),
    max: 2,
  });

  try {
    await verifySyncWithMigrationRole(migrationPool);
    await verifyProductionPoolRollback(requireEnv("DATABASE_URL"), migrationPool);
    await verifyStandingsProductionPoolRollback(requireEnv("DATABASE_URL"), migrationPool);
    await verifySquadsProductionPoolRollback(requireEnv("DATABASE_URL"), migrationPool);
    await verifyPlayerStatisticsProductionPoolRollback(
      requireEnv("DATABASE_URL"),
      migrationPool,
    );
    await verifyRuntimeGrants(runtimePool);
    await verifyJobRunnerPath(runtimePool, migrationPool);

    console.log(
      "Football foundation, matches, standings, squads and player statistics check passed.",
    );
    console.log("football_fake_provider_sync=true");
    console.log("football_repeated_sync_idempotent=true");
    console.log("football_application_owned_fields_protected=true");
    console.log("football_localization_review_constraints=true");
    console.log("football_localization_reviewed_display=true");
    console.log("football_localization_unreviewed_fallback=true");
    console.log("football_provider_owned_fields_update=true");
    console.log("football_missing_provider_rows_preserved=true");
    console.log("football_public_listing_reads_postgres=true");
    console.log("football_matches_full_season_count=380");
    console.log("football_matches_provider_identity_unique=true");
    console.log("football_matches_repeated_sync_idempotent=true");
    console.log("football_matches_provider_fields_update=true");
    console.log("football_matches_complete_raw_snapshot=true");
    console.log("football_matches_missing_provider_rows_preserved=true");
    console.log("football_matches_all_or_nothing=true");
    console.log("football_matches_production_pool_rollback=true");
    console.log("football_calendar_query_reads_postgres=true");
    console.log("football_standings_current_rows=20");
    console.log("football_standings_repeated_sync_idempotent=true");
    console.log("football_standings_provider_fields_update=true");
    console.log("football_standings_description_preserved=true");
    console.log("football_standings_complete_raw_snapshot=true");
    console.log("football_standings_exact_season_membership=true");
    console.log("football_standings_production_pool_rollback=true");
    console.log("football_table_query_reads_postgres=true");
    console.log("football_squads_current_clubs=20");
    console.log("football_squads_repeated_sync_idempotent=true");
    console.log("football_squads_player_identity_unique=true");
    console.log("football_squads_provider_fields_update=true");
    console.log("football_squads_position_preserved=true");
    console.log("football_squads_current_membership_reconciled=true");
    console.log("football_squads_shared_player_membership=true");
    console.log("football_squads_production_pool_rollback=true");
    console.log("football_player_statistics_pages=2");
    console.log("football_player_statistics_transfer_rows=true");
    console.log("football_player_statistics_repeated_sync_idempotent=true");
    console.log("football_player_statistics_empty_snapshot_rejected=true");
    console.log("football_player_statistics_snapshot_reconciled=true");
    console.log("football_player_statistics_complete_raw_snapshot=true");
    console.log("football_player_statistics_production_pool_rollback=true");
    console.log("football_general_statistics_aggregation=true");
    console.log("football_club_page_read_model=true");
    console.log("football_club_page_sitemap_scope=true");
    console.log("football_player_slug_stable=true");
    console.log("football_player_slug_sql_typescript_parity=true");
    console.log("football_player_page_read_model=true");
    console.log("football_player_page_membership_or_statistics_eligibility=true");
    console.log("football_player_page_sitemap_scope=true");
    console.log("football_runtime_grants_exact=true");
    console.log("football_runtime_membership_delete=true");
    console.log("football_runtime_player_statistics_delete=true");
    console.log("football_runtime_delete_denied=true");
    console.log("football_runtime_ddl_denied=true");
    console.log("football_job_runner_path=true");
  } finally {
    await runtimePool.end();
    await migrationPool.end();
  }
}

main().catch((error: unknown) => {
  if (error instanceof Error) {
    console.error(error.stack ?? error.message);
  } else {
    console.error(error);
  }

  process.exitCode = 1;
});
