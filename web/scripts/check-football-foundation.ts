import crypto from "node:crypto";

import { config as loadEnv } from "dotenv";
import pg from "pg";

import type { ApiFootballClient, ApiFootballResult } from "../src/football/api-football/node";
import {
  SERIE_A_FOUNDATION_IDEMPOTENCY_KEY,
  SERIE_A_FOUNDATION_JOB_TYPE,
} from "../src/football/foundation";
import { listCurrentSerieAClubs } from "../src/football/repository";
import { syncSerieAFoundation } from "../src/football/serie-a-foundation-sync";
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

function createFakeClient(nameSuffix = ""): ApiFootballClient {
  return {
    async get<TResponse>(pathname: string): Promise<ApiFootballResult<TResponse>> {
      if (pathname === "/leagues") {
        return ok(createLeague(), "leagues") as ApiFootballResult<TResponse>;
      }

      if (pathname === "/teams") {
        return ok(createTeams(nameSuffix), "teams") as ApiFootballResult<TResponse>;
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

async function assertDeleteDenied(pool: pg.Pool): Promise<void> {
  try {
    await pool.query("delete from football.clubs where false");
  } catch (error) {
    if (postgresErrorCode(error) === "42501") {
      return;
    }

    throw error;
  }

  throw new Error("Runtime role unexpectedly has DELETE on football.clubs");
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
  } finally {
    if (transactionStarted) {
      await client.query("rollback");
    }

    client.release();
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
  } finally {
    if (transactionStarted) {
      await client.query("rollback");
    }

    client.release();
  }

  await assertDeleteDenied(runtimePool);
  await assertDdlDenied(runtimePool);
}

async function verifyJobRunnerPath(runtimePool: pg.Pool, migrationPool: pg.Pool): Promise<void> {
  const type = `stage42-football-check-${crypto.randomUUID()}`;
  const repository = new JobRepository(getJobRunnerConfig());
  const definition: JobDefinition = {
    type,
    parseArguments: (args) => {
      assertCondition(args.length === 0, "check job unexpectedly received args");

      return {
        idempotencyKey: SERIE_A_FOUNDATION_IDEMPOTENCY_KEY,
        payload: {
          type: SERIE_A_FOUNDATION_JOB_TYPE,
          check: "football-foundation",
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

        const result = await syncSerieAFoundation({
          client: createFakeClient(),
          queryable: client,
          heartbeat: context.heartbeat,
        });

        return result.status === "success" ? { status: "success" } : result;
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
      runnerId: "stage42-football-check",
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
    await verifyRuntimeGrants(runtimePool);
    await verifyJobRunnerPath(runtimePool, migrationPool);

    console.log("Football foundation check passed.");
    console.log("football_fake_provider_sync=true");
    console.log("football_repeated_sync_idempotent=true");
    console.log("football_application_owned_fields_protected=true");
    console.log("football_provider_owned_fields_update=true");
    console.log("football_missing_provider_rows_preserved=true");
    console.log("football_public_listing_reads_postgres=true");
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
