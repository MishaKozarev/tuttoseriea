import crypto from "node:crypto";

import { config as loadEnv } from "dotenv";
import pg from "pg";

import type { ApiFootballClient, ApiFootballResult } from "../src/football/api-football/node";
import {
  SERIE_A_MATCHES_IDEMPOTENCY_KEY,
  SERIE_A_MATCHES_JOB_TYPE,
} from "../src/football/foundation";
import { listCurrentSerieAMatches } from "../src/football/matches-repository";
import { listCurrentSerieAClubs } from "../src/football/repository";
import { syncSerieAFoundation } from "../src/football/serie-a-foundation-sync";
import { syncSerieAMatches } from "../src/football/serie-a-matches-sync";
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

function requireEnv(name: string): string {
  const value = process.env[name];

  if (!value) {
    throw new Error(`${name} is required`);
  }

  return value;
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

function ok<TResponse>(data: TResponse, operation: string): ApiFootballResult<TResponse> {
  return {
    ok: true,
    data,
    results: Array.isArray(data) ? data.length : 1,
    paging: {
      current: 1,
      total: 1,
    },
    operation,
    attempts: 1,
  };
}

function createFakeClient(
  nameSuffix = "",
  fixtures = createFixtures(),
): ApiFootballClient {
  return {
    async get<TResponse>(pathname: string): Promise<ApiFootballResult<TResponse>> {
      if (pathname === "/leagues") {
        return ok(createLeague(), "leagues") as ApiFootballResult<TResponse>;
      }

      if (pathname === "/teams") {
        return ok(createTeams(nameSuffix), "teams") as ApiFootballResult<TResponse>;
      }

      if (pathname === "/fixtures") {
        return ok(fixtures, "fixtures") as ApiFootballResult<TResponse>;
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

async function countFakeClubs(client: pg.PoolClient): Promise<number> {
  const result = await client.query<CountRow>(
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

async function assertDeleteDenied(pool: pg.Pool, tableName: "clubs" | "matches"): Promise<void> {
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

    const firstSync = await syncSerieAFoundation({
      client: createFakeClient(),
      queryable: client,
    });

    assertCondition(firstSync.status === "success", "initial fake sync failed");
    assertCondition(await countRows(client, "competitions") === 1, "competition count mismatch");
    assertCondition(await countRows(client, "seasons") === 1, "season count mismatch");
    assertCondition(await countFakeClubs(client) === 20, "club count mismatch");
    assertCondition(await countFakeSeasonClubs(client) === 20, "season membership count mismatch");

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
        set name_ru = 'Милан', slug = 'milan-manual'
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
        select slug, name_ru as "nameRu", provider_name as "providerName"
        from football.clubs
        where provider = 'api-football'
          and provider_club_id = 900000
      `,
    );
    const row = ownership.rows[0];

    assertCondition(row?.slug === "milan-manual", "club slug was overwritten");
    assertCondition(row.nameRu === "Милан", "club name_ru was overwritten");
    assertCondition(
      row.providerName === "AC Milan Updated",
      "provider-owned club name did not update",
    );

    const listedClubs = await listCurrentSerieAClubs(client);

    assertCondition(
      listedClubs.some((club) => club.displayName === "Милан"),
      "public club listing did not use application display name",
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
      listedMatches.some((match) => match.homeClub.displayName === "Милан"),
      "public match listing did not use application-owned club display name",
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
  } finally {
    if (transactionStarted) {
      await client.query("rollback");
    }

    client.release();
  }

  await assertDeleteDenied(runtimePool, "clubs");
  await assertDeleteDenied(runtimePool, "matches");
  await assertDdlDenied(runtimePool);
}

async function verifyJobRunnerPath(runtimePool: pg.Pool, migrationPool: pg.Pool): Promise<void> {
  const type = `stage43-football-check-${crypto.randomUUID()}`;
  const repository = new JobRepository(getJobRunnerConfig());
  const definition: JobDefinition = {
    type,
    parseArguments: (args) => {
      assertCondition(args.length === 0, "check job unexpectedly received args");

      return {
        idempotencyKey: SERIE_A_MATCHES_IDEMPOTENCY_KEY,
        payload: {
          type: SERIE_A_MATCHES_JOB_TYPE,
          check: "football-matches",
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

        return matchesResult.status === "success"
          ? { status: "success" }
          : matchesResult;
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
      runnerId: "stage43-football-check",
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
    await verifyRuntimeGrants(runtimePool);
    await verifyJobRunnerPath(runtimePool, migrationPool);

    console.log("Football foundation and matches check passed.");
    console.log("football_fake_provider_sync=true");
    console.log("football_repeated_sync_idempotent=true");
    console.log("football_application_owned_fields_protected=true");
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
    console.log("football_runtime_grants_select_insert_update=true");
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
