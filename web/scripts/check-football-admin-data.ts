import assert from "node:assert/strict";
import { createFixtureFootballTags } from "./fixtures/football-tags";
import { randomUUID } from "node:crypto";
import { config as loadEnv } from "dotenv";
import pg from "pg";
import { readFootballData, readMatchDatasetEvidence, loadFootballData } from "../src/admin/football-data-repository";
import { parseFootballDataQuery, matchDatasetAvailability } from "../src/admin/football-data";
import { upsertClub, upsertSerieACompetition } from "../src/football/repository";
import { upsertPlayer } from "../src/football/squads-repository";
import { upsertStanding } from "../src/football/standings-repository";
import { quoteIdentifier } from "../src/jobs/config";
import { closeDbConnection } from "../src/db";

loadEnv({ path: ".env.local", quiet: true }); loadEnv({ path: ".env", quiet: true });
type Queryable = Pick<pg.Pool | pg.PoolClient, "query">;
async function main() {
  const migration = new URL(process.env.MIGRATION_DATABASE_URL ?? "");
  const runtime = new URL(process.env.DATABASE_URL ?? "");
  for (const target of [migration, runtime]) assert(["127.0.0.1", "localhost"].includes(target.hostname) &&
    (target.port === "15432" || process.env.CI === "true" && target.port === "5432" && target.pathname === "/tuttoseriea_ci"), "Only LOCAL/exact CI PostgreSQL allowed");
  assert.equal(migration.host, runtime.host); assert.equal(migration.pathname, runtime.pathname);
  const owner = new pg.Pool({ connectionString: migration.toString(), max: 1 });
  const restricted = new pg.Pool({ connectionString: runtime.toString(), max: 1 });
  const schema = `data_check_${randomUUID().replaceAll("-", "")}`;
  const quoted = quoteIdentifier(schema);
  const tables = ["competitions", "seasons", "clubs", "season_clubs", "matches", "standings", "players", "squad_memberships", "player_statistics",
    "match_events", "match_lineups", "match_lineup_entries", "match_statistics", "match_statistic_items", "coaches"];
  const scope = (db: Queryable, readOnly = false): Queryable => ({ query: ((sql: string, values?: unknown[]) => {
    assert.equal(typeof sql, "string");
    if (readOnly) assert(/^\s*(select|with)\b/i.test(sql), "Admin read projections may issue SELECT only");
    const scoped = sql.replace(/\b(?:football|taxonomy)\./g, `${quoted}.`);
    assert(!/\b(?:football|taxonomy)\./.test(scoped)); return db.query(scoped, values);
  }) as Queryable["query"] });
  let created = false; let reader: pg.PoolClient | undefined;
  const fetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("Provider/network calls forbidden in Admin Data reads"); };
  try {
    await owner.query(`create schema ${quoted}`); created = true;
    for (const table of tables) await owner.query(`create table ${quoted}.${table} (like football.${table} including all)`);
    await owner.query(`create table ${quoted}.executions (like jobs.executions including all)`);
    const role = (await restricted.query<{ current_user: string }>("select current_user")).rows[0].current_user;
    assert.notEqual(role, migration.username);
    await owner.query(`grant usage on schema ${quoted} to ${quoteIdentifier(role)}`);
    await owner.query(`grant select on all tables in schema ${quoted} to ${quoteIdentifier(role)}`);
    await createFixtureFootballTags(owner, quoted, quoteIdentifier(role));
    const db = scope(owner);
    const competition = await upsertSerieACompetition(db, { providerName: "Data Serie A", country: "Italy", type: "League", providerLogoUrl: null });
    const seasons = [randomUUID(), randomUUID()];
    for (const [i, id] of seasons.entries()) await owner.query(`insert into ${quoted}.seasons (id,competition_id,provider,provider_season_year,provider_current,display_label)
      values ($1,$2,'api-football',$3,true,$4)`, [id, competition, i ? 2099 : 2026, i ? "2099/2100" : "2026/27"]);
    const clubs: string[] = [];
    for (const [i, name] of ["Data Home", "Data Away", "Other season club"].entries()) {
      clubs.push(await upsertClub(db, { providerClubId: i + 1, providerName: name, code: `D${i}`, country: "Italy", founded: 1900, national: false, providerLogoUrl: null }));
      await owner.query(`insert into ${quoted}.season_clubs (season_id,club_id) values ($1,$2)`, [i < 2 ? seasons[0] : seasons[1], clubs[i]]);
    }
    await owner.query(`update ${quoted}.clubs set name_ru='Домашний клуб',name_ru_review_status='reviewed' where id=$1`, [clubs[0]]);
    const players: string[] = [];
    for (let i = 0; i < 26; i++) players.push(await upsertPlayer(db, { providerPlayerId: i + 1, providerName: i === 25 ? "Literal %_!" : `Data Player ${String(i).padStart(2, "0")}`, age: 20, providerPhotoUrl: null }));
    await owner.query(`update ${quoted}.players set name_ru='Русское имя',name_ru_review_status='reviewed' where id=$1`, [players[0]]);
    for (const [i, club] of [[1, 0], [2, 2]]) await owner.query(`insert into ${quoted}.squad_memberships (id,club_id,player_id,position,provider_raw)
      values ($1,$2,$3,'Forward','[]')`, [randomUUID(), clubs[club], players[i]]);
    for (const [i, season] of seasons.entries()) await owner.query(`insert into ${quoted}.player_statistics
      (id,season_id,club_id,player_id,appearances,minutes,goals_total,goals_assists,player_raw,statistics_raw)
      values ($1,$2,$3,$4,$5,0,0,null,'{}','{}')`, [randomUUID(), season, clubs[i ? 2 : 0], players[0], i ? 5 : 0]);
    const zero = { played: 0, wins: 0, draws: 0, losses: 0, goalsFor: 0, goalsAgainst: 0 };
    for (const [i, clubId] of clubs.slice(0, 2).entries()) await upsertStanding(db, { seasonId: seasons[0], clubId, groupName: null, rank: i + 1, points: 0, goalsDiff: 0,
      form: null, providerStatus: null, description: null, overall: zero, home: zero, away: zero, providerRaw: {} });
    const matches = Array.from({ length: 25 }, () => randomUUID());
    for (const [i, id] of matches.entries()) await owner.query(`insert into ${quoted}.matches
      (id,provider,provider_fixture_id,slug,season_id,home_club_id,away_club_id,round,kickoff_at,status,polling_category,provider_status_short,home_goals,away_goals,provider_raw)
      values($1,'api-football',$2,$1,$3,$4,$5,'Regular Season - 1','2026-10-15T12:00:00Z',$6,$7,$8,0,0,'{}')`,
    [id, 1000 + i, seasons[i === 24 ? 1 : 0], clubs[0], clubs[1], i === 0 ? "finished" : i === 1 ? "live" : "scheduled", i === 0 ? "TERMINAL" : i === 1 ? "ACTIVE" : "WATCH", i === 0 ? "FT" : i === 1 ? "1H" : "NS"]);
    const execution = async (index: number, dataset: string, wrongKey = false, wrongPayload = false) => owner.query(`insert into ${quoted}.executions
      (id,type,idempotency_key,status,payload,attempt_count,max_attempts,finished_at) values($1,$2,$3,'succeeded',$4,1,3,now())`,
    [randomUUID(), `football.sync-serie-a-match-${dataset}`, `api-football:league:135:season:2026:match:${matches[index]}:${dataset}${wrongKey ? ":invalid" : ""}`, { matchId: wrongPayload ? matches[24] : matches[index] }]);
    await execution(2, "events"); await execution(3, "events", true); await execution(4, "events", false, true); await execution(5, "statistics"); await execution(5, "lineups");
    await owner.query(`insert into ${quoted}.match_events (id,match_id,club_id,provider_order,elapsed,provider_type,provider_detail,provider_raw)
      values ($1,$2,$3,0,10,'Goal','Normal Goal','{}')`, [randomUUID(), matches[1], clubs[0]]);
    for (const index of [0, 2]) for (const [side, club] of clubs.slice(0, index === 0 ? 1 : 2).entries()) {
      await owner.query(`insert into ${quoted}.match_lineups (id,match_id,club_id,provider_raw,observed_at) values ($1,$2,$3,'{}',$4)`, [randomUUID(), matches[index], club, side ? "2026-10-14T12:00:00Z" : "2026-10-15T12:00:00Z"]);
      await owner.query(`insert into ${quoted}.match_statistics (id,match_id,club_id,scope,provider_raw,observed_at) values ($1,$2,$3,'full_match','{}',$4)`, [randomUUID(), matches[index], club, side ? "2026-10-14T12:00:00Z" : "2026-10-15T12:00:00Z"]);
    }
    reader = await restricted.connect();
    await assert.rejects(reader.query(`update ${quoted}.players set age=age where false`), { code: "42501" });
    await reader.query("begin isolation level repeatable read read only");
    const read = scope(reader, true);
    const query = (params: Record<string, string> = {}) => readFootballData(read, parseFootballDataQuery(params), schema);
    const first = await query({ view: "players", query: "Data Player" }); assert.equal(first.view, "players");
    if (first.view !== "players") throw new Error("Unexpected view");
    assert.equal(first.page.total, 25); assert.equal(first.page.items.length, 20);
    const next = await query({ view: "players", query: "Data Player", page: "2" }); if (next.view !== "players") throw new Error("Unexpected view");
    assert.equal(next.page.items.length, 5); assert.equal(new Set([...first.page.items, ...next.page.items].map((p) => p.id)).size, 25);
    for (const search of ["%_!", "руССкое имя"]) {
      const found = await query({ view: "players", query: search }); if (found.view !== "players") throw new Error("Unexpected view");
      assert.equal(found.page.total, 1);
    }
    for (const [i, eligible] of [[0, true], [1, true], [2, false], [3, false]] as const) {
      const detail = await query({ view: "players", id: players[i] }); if (detail.view !== "players") throw new Error("Unexpected view");
      assert(detail.detail); assert.equal(detail.detail.player.publicEligible, eligible);
      if (i === 0) { assert.equal(detail.detail.statistics.length, 2); assert.equal(detail.detail.statistics[1].goals, 0); assert.equal(detail.detail.statistics[1].assists, null); assert.equal(detail.detail.player.displayName, "Русское имя"); }
      if (i === 2) assert.equal(detail.detail.memberships[0].currentSerieA, false);
      assert(!JSON.stringify(detail).includes("provider_raw"));
    }
    const club = await query({ query: "data home", id: clubs[0] }); if (club.view !== "clubs") throw new Error("Unexpected view");
    assert.equal(club.page.total, 1); assert.equal(club.detail?.club.displayName, "Домашний клуб"); assert.equal(club.detail?.squad.length, 1);
    const standings = await query({ view: "standings" }); if (standings.view !== "standings") throw new Error("Unexpected view");
    assert.equal(standings.standings.length, 2); assert.equal(standings.standings[0].club.displayName, "Домашний клуб");
    const list = await query({ view: "matches", club: clubs[0] }); if (list.view !== "matches") throw new Error("Unexpected view");
    assert.equal(list.page.total, 24); assert.equal(list.page.items.length, 20);
    const live = await query({ view: "matches", status: "live", query: "домашний", club: clubs[0] }); if (live.view !== "matches") throw new Error("Unexpected view");
    assert.equal(live.page.total, 1); assert.equal(live.page.items[0].id, matches[1]);
    const historical = await query({ view: "matches", id: matches[24] }); if (historical.view !== "matches") throw new Error("Unexpected view"); assert.equal(historical.detail, null);
    for (const [index, expected] of [[0, "missing"], [1, "snapshot"], [2, "confirmed-empty"], [3, "missing"], [4, "missing"], [5, "missing"]] as const) {
      const match = await query({ view: "matches", id: matches[index] }); if (match.view !== "matches") throw new Error("Unexpected view");
      assert(match.detail && match.evidence); assert.equal(matchDatasetAvailability(match.evidence).events, expected);
      if (index === 0) assert.deepEqual(matchDatasetAvailability(match.evidence), { events: "missing", lineups: "partial", statistics: "partial" });
      if (index === 2) { assert.deepEqual(matchDatasetAvailability(match.evidence), { events: "confirmed-empty", lineups: "complete", statistics: "complete" }); assert.notEqual(match.evidence.lineups[0].observedAt, match.evidence.lineups[1].observedAt); }
      if (index === 5) { assert.equal(match.evidence.lineups.length, 0); assert.equal(match.evidence.statistics.length, 0); }
    }
    // A concurrent snapshot replacement cannot mix old and new observations in one Admin read.
    await owner.query(`insert into ${quoted}.match_lineups (id,match_id,club_id,provider_raw) values($1,$2,$3,'{}')`, [randomUUID(), matches[0], clubs[1]]);
    assert.equal((await readMatchDatasetEvidence(read, matches[0], schema)).lineups.length, 1);
    await reader.query("commit");
    assert.equal((await readMatchDatasetEvidence(read, matches[0], schema)).lineups.length, 2);
    reader.release(); reader = undefined;
    for (const view of ["clubs", "players", "matches", "standings"]) await loadFootballData(parseFootballDataQuery({ view }));
  } finally {
    await reader?.query("rollback"); reader?.release();
    if (created) await owner.query(`drop schema ${quoted} cascade`);
    await closeDbConnection(); await restricted.end(); await owner.end(); globalThis.fetch = fetch;
  }
  console.log("football_admin_data_check=passed");
  console.log("runtime_select_only_search_filters_pagination_player_scope_zero_events_team_snapshots_read_consistency=true");
  console.log("provider_requests=0 real_admissions=0 canonical_data_writes=0 fixture_cleanup=complete");
}
main().catch((error: unknown) => {
  console.error("football_admin_data_check=failed", error instanceof assert.AssertionError ? error.message :
    { name: error instanceof Error ? error.name : "UnknownError", code: (error as { code?: string })?.code,
      table: (error as { table?: string })?.table, column: (error as { column?: string })?.column }); process.exitCode = 1;
});
