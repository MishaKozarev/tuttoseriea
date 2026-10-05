import crypto from "node:crypto";

import { config as loadEnv } from "dotenv";
import pg, { type PoolClient } from "pg";

import { SERIE_A_MATCH_EVENTS_JOB_TYPE } from "../src/football/foundation";
import { getJobRunnerConfig } from "../src/jobs/config";
import {
  createMatchDataBackfillPlan,
  runMatchDataBackfill,
} from "../src/jobs/match-data-backfill";
import {
  listFinishedMatchBackfillSnapshots,
  MatchDataBackfillRepository,
} from "../src/jobs/match-data-backfill-repository";

const { Pool } = pg;

loadEnv({ path: ".env.local", quiet: true });
loadEnv({ path: ".env", quiet: true });

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`${name} is required`);
  }

  return value;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

async function insertSeason(
  client: PoolClient,
  competitionId: string,
  seasonId: string,
  year: number,
): Promise<string> {
  await client.query(
    `
      insert into football.seasons (
        id, competition_id, provider, provider_season_year,
        provider_current, display_label
      )
      values ($1, $2, 'api-football', $3, true, $4)
      on conflict (competition_id, provider, provider_season_year) do nothing
    `,
    [seasonId, competitionId, year, `Backfill check ${year}`],
  );
  const result = await client.query<{ id: string }>(
    `
      select id
      from football.seasons
      where competition_id = $1
        and provider = 'api-football'
        and provider_season_year = $2
    `,
    [competitionId, year],
  );
  const id = result.rows[0]?.id;
  assert(id, `Season ${year} was not available for backfill DB check`);
  return id;
}

async function insertMatch(
  client: PoolClient,
  input: {
    id: string;
    fixtureId: number;
    seasonId: string;
    homeClubId: string;
    awayClubId: string;
    status: "finished" | "scheduled";
  },
): Promise<void> {
  await client.query(
    `
      insert into football.matches (
        id, provider, provider_fixture_id, slug, season_id,
        home_club_id, away_club_id, round, kickoff_at,
        status, polling_category, provider_status_short, provider_raw
      )
      values (
        $1, 'api-football', $2, $3, $4,
        $5, $6, 'Check Round', '2026-09-01T18:00:00Z',
        $7, $8, $9, '{}'::jsonb
      )
    `,
    [
      input.id,
      input.fixtureId,
      `backfill-check-${input.fixtureId}`,
      input.seasonId,
      input.homeClubId,
      input.awayClubId,
      input.status,
      input.status === "finished" ? "TERMINAL" : "WATCH",
      input.status === "finished" ? "FT" : "NS",
    ],
  );
}

async function main(): Promise<void> {
  const jobConfig = getJobRunnerConfig();
  const migrationPool = new Pool({
    connectionString: requireEnv("MIGRATION_DATABASE_URL"),
    max: 1,
  });
  const client = await migrationPool.connect();
  const suffix = crypto.randomUUID();
  const fixtureBase = 1_900_000_000 + Math.floor(Math.random() * 10_000);

  try {
    await client.query("begin");

    await client.query(
      `
        insert into football.competitions (
          id, provider, provider_competition_id, provider_name, slug
        )
        values ($1, 'api-football', 135, 'Serie A Backfill Check', $2)
        on conflict (provider, provider_competition_id) do nothing
      `,
      [`backfill-check-competition-${suffix}`, `serie-a-backfill-check-${suffix}`],
    );
    const competition = await client.query<{ id: string }>(
      `
        select id from football.competitions
        where provider = 'api-football' and provider_competition_id = 135
      `,
    );
    const competitionId = competition.rows[0]?.id;
    assert(competitionId, "Serie A competition was not available for backfill DB check");

    const currentSeasonId = await insertSeason(
      client,
      competitionId,
      `backfill-check-season-current-${suffix}`,
      2026,
    );
    const otherSeasonId = await insertSeason(
      client,
      competitionId,
      `backfill-check-season-other-${suffix}`,
      2025,
    );
    const otherCompetitionId = `backfill-check-other-competition-${suffix}`;
    await client.query(
      `
        insert into football.competitions (
          id, provider, provider_competition_id, provider_name, slug
        )
        values ($1, 'api-football', $2, 'Other Competition Backfill Check', $3)
      `,
      [
        otherCompetitionId,
        fixtureBase + 500,
        `other-competition-backfill-check-${suffix}`,
      ],
    );
    const otherCompetitionSeasonId = await insertSeason(
      client,
      otherCompetitionId,
      `backfill-check-other-competition-season-${suffix}`,
      2026,
    );
    const homeClubId = `backfill-check-home-${suffix}`;
    const awayClubId = `backfill-check-away-${suffix}`;

    await client.query(
      `
        insert into football.clubs (
          id, provider, provider_club_id, provider_name, slug
        )
        values
          ($1, 'api-football', $3, 'Backfill Home', $5),
          ($2, 'api-football', $4, 'Backfill Away', $6)
      `,
      [
        homeClubId,
        awayClubId,
        fixtureBase + 100,
        fixtureBase + 101,
        `backfill-home-${suffix}`,
        `backfill-away-${suffix}`,
      ],
    );
    await client.query(
      `
        insert into football.season_clubs (season_id, club_id)
        values
          ($1, $4), ($1, $5),
          ($2, $4), ($2, $5),
          ($3, $4), ($3, $5)
      `,
      [
        currentSeasonId,
        otherSeasonId,
        otherCompetitionSeasonId,
        homeClubId,
        awayClubId,
      ],
    );

    const completeMatchId = crypto.randomUUID();
    const partialMatchId = crypto.randomUUID();
    const scheduledMatchId = crypto.randomUUID();
    const otherSeasonMatchId = crypto.randomUUID();
    const otherCompetitionMatchId = crypto.randomUUID();

    await insertMatch(client, {
      id: completeMatchId,
      fixtureId: fixtureBase,
      seasonId: currentSeasonId,
      homeClubId,
      awayClubId,
      status: "finished",
    });
    await insertMatch(client, {
      id: partialMatchId,
      fixtureId: fixtureBase + 1,
      seasonId: currentSeasonId,
      homeClubId,
      awayClubId,
      status: "finished",
    });
    await insertMatch(client, {
      id: scheduledMatchId,
      fixtureId: fixtureBase + 2,
      seasonId: currentSeasonId,
      homeClubId,
      awayClubId,
      status: "scheduled",
    });
    await insertMatch(client, {
      id: otherSeasonMatchId,
      fixtureId: fixtureBase + 3,
      seasonId: otherSeasonId,
      homeClubId,
      awayClubId,
      status: "finished",
    });
    await insertMatch(client, {
      id: otherCompetitionMatchId,
      fixtureId: fixtureBase + 4,
      seasonId: otherCompetitionSeasonId,
      homeClubId,
      awayClubId,
      status: "finished",
    });

    await client.query(
      `
        insert into jobs.executions (
          id, type, idempotency_key, status, payload, max_attempts,
          started_at, finished_at
        )
        values ($1, $2, $3, 'succeeded', $4::jsonb, 3, now(), now())
      `,
      [
        crypto.randomUUID(),
        SERIE_A_MATCH_EVENTS_JOB_TYPE,
        `backfill-check-events-${suffix}`,
        JSON.stringify({ matchId: completeMatchId }),
      ],
    );
    await client.query(
      `
        insert into football.match_lineups (
          id, match_id, club_id, provider_raw
        )
        values
          ($1, $3, $4, '{}'::jsonb),
          ($2, $3, $5, '{}'::jsonb),
          ($6, $7, $4, '{}'::jsonb)
      `,
      [
        crypto.randomUUID(),
        crypto.randomUUID(),
        completeMatchId,
        homeClubId,
        awayClubId,
        crypto.randomUUID(),
        partialMatchId,
      ],
    );
    await client.query(
      `
        insert into football.match_statistics (
          id, match_id, club_id, scope, provider_raw
        )
        values
          ($1, $3, $4, 'full_match', '{}'::jsonb),
          ($2, $3, $5, 'full_match', '{}'::jsonb),
          ($6, $7, $4, 'full_match', '{}'::jsonb)
      `,
      [
        crypto.randomUUID(),
        crypto.randomUUID(),
        completeMatchId,
        homeClubId,
        awayClubId,
        crypto.randomUUID(),
        partialMatchId,
      ],
    );

    const before = await client.query<{ executions: number; datasets: number }>(
      `
        select
          (select count(*)::int from jobs.executions) as executions,
          (
            (select count(*) from football.match_events) +
            (select count(*) from football.match_lineups) +
            (select count(*) from football.match_statistics)
          )::int as datasets
      `,
    );
    const fixtureMatchIds: string[] = [
      completeMatchId,
      partialMatchId,
      scheduledMatchId,
      otherSeasonMatchId,
      otherCompetitionMatchId,
    ];
    const fixtureRows = (
      await listFinishedMatchBackfillSnapshots(client, jobConfig.jobsSchema)
    ).filter((match) => fixtureMatchIds.includes(match.matchId));

    assert(fixtureRows.length === 2, "Selector did not retain exact finished season scope");
    const complete = fixtureRows.find((match) => match.matchId === completeMatchId);
    const partial = fixtureRows.find((match) => match.matchId === partialMatchId);
    assert(complete?.eventsComplete, "Successful zero-event execution was not complete");
    assert(
      complete?.lineupsComplete && complete.statisticsComplete,
      "Two-sided snapshots were not complete",
    );
    assert(
      partial &&
        !partial.eventsComplete &&
        !partial.lineupsComplete &&
        !partial.statisticsComplete,
      "Partial or absent snapshots were incorrectly complete",
    );
    assert(
      partial.statusChangedAt === null,
      "Historical null status marker was not preserved",
    );

    const plan = createMatchDataBackfillPlan(fixtureRows);
    assert(
      plan.candidateMatches === 1 && plan.datasetOperations === 3,
      "Backfill plan counts did not match repository completeness",
    );
    const dryRun = await runMatchDataBackfill({
      repository: {
        listFinishedMatches: async () => fixtureRows,
        tryAcquireRunLock: async () => {
          throw new Error("Dry-run attempted to acquire run lock");
        },
      },
      mode: "dry-run",
      runJob: async () => {
        throw new Error("Dry-run attempted to invoke a job");
      },
    });
    assert(dryRun.status === "dry_run", "Dry-run did not complete safely");

    const after = await client.query<{ executions: number; datasets: number }>(
      `
        select
          (select count(*)::int from jobs.executions) as executions,
          (
            (select count(*) from football.match_events) +
            (select count(*) from football.match_lineups) +
            (select count(*) from football.match_statistics)
          )::int as datasets
      `,
    );
    assert(
      JSON.stringify(before.rows[0]) === JSON.stringify(after.rows[0]),
      "Dry-run changed executions or Football datasets",
    );

    await client.query("rollback");

    const runtimeRepository = new MatchDataBackfillRepository(jobConfig);
    try {
      await runtimeRepository.listFinishedMatches();
    } finally {
      await runtimeRepository.close();
    }

    console.log("match_data_backfill_fixed_scope=true");
    console.log("match_data_backfill_events_zero_row_success=true");
    console.log("match_data_backfill_two_sided_snapshots=true");
    console.log("match_data_backfill_null_status_marker_allowed=true");
    console.log("match_data_backfill_dry_run_mutations=0");
    console.log("match_data_backfill_runtime_read=passed");
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
    await migrationPool.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? (error.stack ?? error.message) : error);
  process.exitCode = 1;
});
