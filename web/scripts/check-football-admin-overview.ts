import { randomInt, randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { config as loadEnv } from "dotenv";
import { Pool } from "pg";

import { loadFootballOverview, readFootballOverview } from "../src/admin/football-overview-repository";
import { buildFootballOverview } from "../src/admin/football-overview";
import { closeDbConnection } from "../src/db";
import { quoteIdentifier } from "../src/jobs/config";

loadEnv({ path: ".env.local", quiet: true });
loadEnv({ path: ".env", quiet: true });

async function main() {
  // The fixture transaction must never be used against a remote/shared deployment DB.
  const url = new URL(process.env.MIGRATION_DATABASE_URL ?? "");
  const runtimeUrl = new URL(process.env.DATABASE_URL ?? "");
  assert(["127.0.0.1", "localhost", "[::1]"].includes(url.hostname), "Only loopback PostgreSQL is allowed");
  assert(url.port === "15432" || (process.env.CI === "true" && url.port === "5432" && url.pathname === "/tuttoseriea_ci"), "Only LOCAL or exact CI PostgreSQL is allowed");
  assert.equal(runtimeUrl.host, url.host, "Runtime and fixture DB hosts must match");
  assert.equal(runtimeUrl.pathname, url.pathname, "Runtime and fixture databases must match");
  const jobsSchema = process.env.DATABASE_JOBS_SCHEMA?.trim() || "jobs";
  const executions = `${quoteIdentifier(jobsSchema)}.executions`;
  const pool = new Pool({ connectionString: url.toString(), max: 1 });
  const client = await pool.connect();
  const suffix = randomUUID();
  const base = randomInt(1_800_000_000, 1_900_000_000);
  try {
    await client.query("begin");
    await client.query(`insert into football.competitions (id, provider, provider_competition_id, provider_name, slug)
      values ($1, 'api-football', 135, 'Overview fixture', $1) on conflict do nothing`, [`overview-${suffix}`]);
    const competitionId = (await client.query<{ id: string }>("select id from football.competitions where provider = 'api-football' and provider_competition_id = 135")).rows[0].id;
    const seasonIds: string[] = [];
    for (const year of [2026, 2099]) {
      await client.query(`insert into football.seasons (id, competition_id, provider, provider_season_year, provider_current, display_label)
        values ($1, $2, 'api-football', $3, true, 'Overview fixture') on conflict do nothing`, [`overview-${year}-${suffix}`, competitionId, year]);
      seasonIds.push((await client.query<{ id: string }>("select id from football.seasons where competition_id = $1 and provider = 'api-football' and provider_season_year = $2", [competitionId, year])).rows[0].id);
    }
    const before = await readFootballOverview(client, jobsSchema);
    const clubs = [randomUUID(), randomUUID()];
    for (const [index, club] of clubs.entries()) {
      await client.query(`insert into football.clubs (id, provider, provider_club_id, provider_name, slug)
        values ($1, 'api-football', $2, 'Overview fixture club', $1)`, [club, base + index]);
      for (const seasonId of seasonIds) {
        await client.query("insert into football.season_clubs (season_id, club_id) values ($1, $2)", [seasonId, club]);
      }
    }
    const matches = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
    for (const [index, match] of matches.entries()) {
      await client.query(`insert into football.matches (id, provider, provider_fixture_id, slug, season_id,
        home_club_id, away_club_id, round, status, polling_category, provider_status_short, provider_raw)
        values ($1, 'api-football', $2, $1, $3, $4, $5, 'Overview fixture', $6, $7, $8, '{}')`,
      [match, base + index, seasonIds[index === 3 ? 1 : 0], ...clubs,
        index === 2 ? "scheduled" : "finished", index === 2 ? "WATCH" : "TERMINAL", index === 2 ? "NS" : "FT"]);
    }
    for (const [index, match] of matches.slice(0, 2).entries()) {
      for (const club of clubs.slice(0, index === 0 ? 2 : 1)) {
        await client.query(`insert into football.match_lineups (id, match_id, club_id, provider_raw, observed_at)
          values ($1, $2, $3, '{}', '2026-09-01T12:00:00Z')`, [randomUUID(), match, club]);
        await client.query(`insert into football.match_statistics (id, match_id, club_id, scope, provider_raw, observed_at)
          values ($1, $2, $3, 'full_match', '{}', '2026-09-02T12:00:00Z')`, [randomUUID(), match, club]);
      }
    }

    const insertExecution = async (input: { match: string; dataset: string; status: string; age?: number; wrongKey?: boolean }) => {
      const id = randomUUID();
      const key = `api-football:league:135:season:2026:match:${input.match}:${input.dataset}${input.wrongKey ? ":invalid" : ""}`;
      await client.query(`insert into ${executions} (id, type, idempotency_key, status, payload, attempt_count,
        max_attempts, claimed_by, lease_expires_at, created_at, available_at, finished_at, last_error_code, last_error_message)
        values ($1, $2, $3, $4, $5, 1, 3,
          case when $4 = 'running' then 'fixture-owner' end,
          case when $4 = 'running' then now() - interval '1 minute' end,
          now() + ($6::int * interval '1 second'), now() + interval '5 minutes',
          case when $4 in ('succeeded', 'failed') then now() end,
          case when $4 in ('failed', 'pending') then 'fixture_safe_code' end, 'PRIVATE MESSAGE')`,
      [id, `football.sync-serie-a-match-${input.dataset}`, key, input.status, { matchId: input.match }, input.age ?? 0]);
      return id;
    };
    await insertExecution({ match: matches[0], dataset: "events", status: "failed", age: -60 });
    const successId = await insertExecution({ match: matches[0], dataset: "events", status: "succeeded", age: -30 });
    await insertExecution({ match: matches[1], dataset: "events", status: "failed" });
    await insertExecution({ match: matches[1], dataset: "lineups", status: "succeeded" });
    await insertExecution({ match: matches[0], dataset: "statistics", status: "running" });
    await insertExecution({ match: matches[1], dataset: "statistics", status: "pending" });
    const outsideId = await insertExecution({ match: matches[3], dataset: "events", status: "failed" });
    const invalidId = await insertExecution({ match: matches[0], dataset: "events", status: "failed", wrongKey: true });
    await insertExecution({ match: matches[1], dataset: "events", status: "succeeded", wrongKey: true });

    const data = await readFootballOverview(client, jobsSchema);
    assert.equal(data.facts.clubs, before.facts.clubs + 2);
    assert.equal(data.facts.matches, before.facts.matches + 3, "Other season leaked into match counts");
    assert.equal(data.finishedMatches.length, before.finishedMatches.length + 2, "Upcoming/other-season Matches entered completeness denominator");
    const complete = data.finishedMatches.find((match) => match.matchId === matches[0])!;
    const partial = data.finishedMatches.find((match) => match.matchId === matches[1])!;
    assert(complete.eventsComplete && complete.lineupsComplete && complete.statisticsComplete, "Zero-row successful Events snapshot was not confirmed");
    assert(!partial.eventsComplete && !partial.lineupsComplete && !partial.statisticsComplete, "Partial/empty success incorrectly proved completeness");
    assert.equal(data.facts.events, before.facts.events, "Fixture must use a zero-row Events snapshot");
    const summary = (type: string) => data.jobs.find((row) => row.type === `football.sync-serie-a-match-${type}`)!;
    const previous = (type: string) => before.jobs.find((row) => row.type === `football.sync-serie-a-match-${type}`);
    assert.equal(summary("events").failed_scopes, (previous("events")?.failed_scopes ?? 0) + 1, "Resolved historical or noncanonical failures were treated as current problems");
    assert.equal(summary("statistics").expired, (previous("statistics")?.expired ?? 0) + 1);
    assert.equal(summary("statistics").retries, (previous("statistics")?.retries ?? 0) + 1);
    assert(!data.recentExecutions.some((execution) => execution.id === outsideId || execution.id === invalidId), "Wrong season/canonical key entered history");
    const execution = data.recentExecutions.find((execution) => execution.id === successId)!;
    assert(execution && !execution.admin_requested, "Non-Admin executions must be included");
    assert(!("payload" in execution) && !("last_error_message" in execution) && !("claimed_by" in execution), "Unsafe execution fields escaped projection");
    assert.equal(buildFootballOverview(data).datasets.find((dataset) => dataset.id === "lineups")!.gap, true);

    const newestIds: string[] = [];
    for (let index = 0; index < 25; index++) {
      newestIds.push(await insertExecution({ match: matches[0], dataset: "lineups", status: "succeeded", age: 1000 + index }));
    }
    const bounded = await readFootballOverview(client, jobsSchema);
    assert.equal(bounded.recentExecutions.length, 20);
    assert.deepEqual(bounded.recentExecutions.map((execution) => execution.id), newestIds.reverse().slice(0, 20), "History ordering/limit is unstable");
    await client.query("rollback");
    // The actual loader uses runtime-role SELECT grants and a read-only consistent snapshot.
    const runtimeData = await loadFootballOverview();
    assert(!runtimeData.recentExecutions.some((execution) => newestIds.includes(execution.id)), "Fixtures were not rolled back");
    console.log("PASS Football Admin Overview PostgreSQL: scope, completeness, zero-row Events, retries, leases, safe bounded history, runtime read and fixture rollback");
  } finally {
    await client.query("rollback").catch(() => undefined);
    client.release();
    await pool.end();
    await closeDbConnection();
  }
}

main().catch((error: unknown) => {
  console.error("FAIL Football Admin Overview PostgreSQL check", error instanceof assert.AssertionError
    ? error.message : { name: error instanceof Error ? error.name : "UnknownError",
      code: (error as { code?: string })?.code });
  process.exitCode = 1;
});
