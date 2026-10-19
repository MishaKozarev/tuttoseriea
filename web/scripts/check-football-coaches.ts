import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { config } from "dotenv";
import pg from "pg";
import { getCoachById, getCoachesByIds, getLastKnownTeamCoach, resolveCoachesForLineups, type CoachQueryable } from "../src/football/coaches-repository";
import type { CoachSnapshot } from "../src/football/coaches";
import { applyLineupCoaches, previewLineupCoaches } from "../src/football/lineup-coaches-reconciliation";
import { syncMatchLineups } from "../src/football/match-lineups-sync";
import type { ApiFootballClient, ApiFootballResult } from "../src/football/api-football/node";
import { upsertClub, upsertSerieACompetition } from "../src/football/repository";
import { quoteIdentifier } from "../src/jobs/config";
import { checkCoachManifest } from "./check-coach-manifest";

config({ path: ".env.local", quiet: true }); config({ path: ".env", quiet: true });
const manual = process.argv.includes("--manual");
assert(process.argv.slice(2).every((arg) => arg === "--manual"));

async function main() {
  const migration = new URL(process.env.MIGRATION_DATABASE_URL ?? "");
  const runtime = new URL(process.env.DATABASE_URL ?? "");
  for (const target of [migration, runtime]) assert(["127.0.0.1", "localhost"].includes(target.hostname) &&
    (target.port === "15432" && target.pathname === "/tuttoseriea_local" || process.env.CI === "true" && target.port === "5432" && target.pathname === "/tuttoseriea_ci"), "Only LOCAL/exact CI PostgreSQL allowed");
  assert.equal(migration.host, runtime.host); assert.equal(migration.pathname, runtime.pathname);
  const owner = new pg.Pool({ connectionString: migration.href, max: 3 });
  const restricted = new pg.Pool({ connectionString: runtime.href, max: 4 });
  const schema = `coaches_check_${randomUUID().replaceAll("-", "")}`;
  const quoted = quoteIdentifier(schema);
  const tables = ["competitions", "seasons", "clubs", "season_clubs", "matches", "players", "coaches", "match_lineups", "match_lineup_entries"];
  const scope = (db: CoachQueryable): CoachQueryable => ({ query: ((sql: string, values?: unknown[]) => {
    assert.equal(typeof sql, "string");
    const rewritten = sql.replace(/\bfootball\./g, `${quoted}.`);
    assert(!/\bfootball\./.test(rewritten)); return db.query(rewritten, values);
  }) as CoachQueryable["query"] });
  const canonicalFingerprint = async () => Promise.all(tables.map(async (table) => (await owner.query(`select
    md5(coalesce(string_agg(to_jsonb(t)::text,',' order by to_jsonb(t)::text),' ')) as value from football.${table} t`)).rows[0].value));
  const before = await canonicalFingerprint();
  const savedFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("Network/provider requests forbidden in Coach fixtures"); };
  let created = false; let fixtureNumber = 100;
  const clubs: string[] = []; let season: string;
  const row = async (providerId: number) => (await owner.query(`select * from ${quoted}.coaches where provider_coach_id=$1`, [providerId])).rows[0];
  const evidence = (label: string, value: unknown) => { if (manual) console.log(JSON.stringify({ scenario: label, actual: value })); };
  const match = async (date: string | null, status = "finished") => {
    const id = randomUUID();
    await owner.query(`insert into ${quoted}.matches
      (id,provider,provider_fixture_id,slug,season_id,home_club_id,away_club_id,round,kickoff_at,status,polling_category,provider_status_short,provider_raw)
      values($1,'api-football',$2,$1,$3,$4,$5,'Regular Season - 1',$6,$7,'TERMINAL','FT','{}')`,
    [id, fixtureNumber++, season, clubs[0], clubs[1], date, status]); return id;
  };
  const snapshot = (providerCoachId: number | null, providerCoachName: string | null, providerCoachPhotoUrl: string | null = null): CoachSnapshot =>
    ({ providerCoachId, providerCoachName, providerCoachPhotoUrl });
  const persist = async (matchId: string, input: CoachSnapshot, pool = restricted) => {
    const client = await pool.connect();
    try { await client.query("begin"); const result = (await resolveCoachesForLineups(scope(client), matchId, [input]))[0];
      await client.query("commit"); return result;
    } catch (error) { await client.query("rollback"); throw error; } finally { client.release(); }
  };
  const saveObservation = async (matchId: string, input: CoachSnapshot, coachId: string | null = null, clubId = clubs[0]) => {
    const id = randomUUID();
    await owner.query(`insert into ${quoted}.match_lineups
      (id,match_id,club_id,coach_id,provider_coach_id,provider_coach_name,provider_coach_photo_url,provider_raw,observed_at)
      values($1,$2,$3,$4,$5,$6,$7,'{"fixture":true}','2026-10-19T10:00:00Z')`,
    [id, matchId, clubId, coachId, input.providerCoachId, input.providerCoachName, input.providerCoachPhotoUrl]); return id;
  };
  const observation = () => getLastKnownTeamCoach(scope(restricted), clubs[0], new Date("2026-10-19T12:00:00Z"));
  // Use the real sync Pool transaction path, with SQL limited to the fixture schema.
  const sync = async (matchId: string, data: unknown[], options: { failEntry?: boolean; heartbeat?: () => Promise<void> } = {}) => {
    const client: ApiFootballClient = { getRequestAttemptCount: () => 1, async get<T>(path: string) {
      assert.equal(path, "/fixtures/lineups"); return { ok: true, data, results: data.length,
        paging: { current: 1, total: 1 }, attempts: 1, operation: "fixtures/lineups" } as ApiFootballResult<T>;
    } };
    const pool = { query: scope(restricted).query, connect: async () => {
      const connection = await restricted.connect(); const scoped = scope(connection);
      return { query: ((sql: string, values?: unknown[]) => {
        if (options.failEntry && /insert into football.match_lineup_entries/.test(sql)) throw new Error("Injected entry persistence failure");
        return scoped.query(sql, values);
      }) as CoachQueryable["query"], release: () => connection.release() };
    } } as unknown as pg.Pool;
    return syncMatchLineups({ pool, matchId, client, heartbeat: options.heartbeat });
  };
  const lineup = (id: number | null, name: string | null, photo: string | null = null) => ({ team: { id: 1, name: "Fixture Home" },
    coach: { id, name, photo }, formation: null, startXI: [{ player: { id: 123, name: "Fixture Player" } }], substitutes: [] });
  const waitForLock = async (pid: number) => {
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      if ((await owner.query("select wait_event_type from pg_stat_activity where pid=$1", [pid])).rows[0]?.wait_event_type === "Lock") return;
      await delay(15);
    }
    assert.fail("Expected real PostgreSQL lock wait did not occur");
  };
  try {
    await owner.query(`create schema ${quoted}`); created = true;
    for (const table of tables) await owner.query(`create table ${quoted}.${table} (like football.${table} including all)`);
    // LIKE copies checks/indexes, but not FKs: install the new real relationships explicitly.
    await owner.query(`alter table ${quoted}.coaches add foreign key(name_source_match_id) references ${quoted}.matches(id) on delete restrict,
      add foreign key(photo_source_match_id) references ${quoted}.matches(id) on delete restrict`);
    await owner.query(`alter table ${quoted}.match_lineups add foreign key(coach_id) references ${quoted}.coaches(id) on delete set null`);
    await owner.query(`alter table ${quoted}.match_lineup_entries add foreign key(lineup_id) references ${quoted}.match_lineups(id) on delete cascade`);
    const role = (await restricted.query("select current_user")).rows[0].current_user as string;
    assert.notEqual(role, migration.username);
    await owner.query(`grant usage on schema ${quoted} to ${quoteIdentifier(role)}`);
    for (const table of tables) {
      const actual = await owner.query("select privilege_type from information_schema.role_table_grants where grantee=$1 and table_schema='football' and table_name=$2 order by privilege_type", [role, table]);
      const privileges = actual.rows.map((r) => r.privilege_type as string);
      if (table === "coaches") assert.deepEqual(privileges, ["INSERT", "SELECT", "UPDATE"]);
      if (table === "match_lineups") assert.deepEqual(privileges, ["DELETE", "INSERT", "SELECT"]);
      await owner.query(`grant ${privileges.join(",")} on ${quoted}.${table} to ${quoteIdentifier(role)}`);
    }
    const competition = await upsertSerieACompetition(scope(owner), { providerName: "Coaches fixture Serie A", country: "Italy", type: "League", providerLogoUrl: null });
    season = randomUUID();
    await owner.query(`insert into ${quoted}.seasons(id,competition_id,provider,provider_season_year,provider_current,display_label)
      values($1,$2,'api-football',2026,true,'2026/27')`, [season, competition]);
    for (let i = 1; i <= 2; i++) {
      const id = await upsertClub(scope(owner), { providerClubId: i, providerName: `Fixture club ${i}`, code: null, country: "Italy", founded: null, national: false, providerLogoUrl: null });
      clubs.push(id); await owner.query(`insert into ${quoted}.season_clubs(season_id,club_id) values($1,$2)`, [season, id]);
    }

    const old = await match("2026-10-01T12:00:00Z"), recent = await match("2026-10-10T12:00:00Z"), sameDate = await match("2026-10-10T12:00:00Z"), undated = await match(null);
    const first = await persist(recent, snapshot(10, "New name", "https://fixture.invalid/new")); assert(first.coachId);
    await owner.query(`update ${quoted}.coaches set name_ru='Русское имя',name_ru_review_status='reviewed',localization_revision=7 where id=$1`, [first.coachId]);
    await persist(old, snapshot(10, "Old name", "https://fixture.invalid/old"));
    assert.equal((await row(10)).provider_name, "New name"); assert.equal((await row(10)).name_ru, "Русское имя"); assert.equal((await row(10)).localization_revision, 7);
    await persist(sameDate, snapshot(10, "Tied name", "https://fixture.invalid/tie")); assert.equal((await row(10)).provider_name, "New name");
    await persist(undated, snapshot(10, "Undated", "https://fixture.invalid/undated")); assert.equal((await row(10)).provider_name, "New name");
    await persist(recent, snapshot(10, "Corrected", null)); assert.equal((await row(10)).provider_name, "Corrected"); assert.equal((await row(10)).provider_photo_url, "https://fixture.invalid/new");
    await persist(recent, snapshot(10, "  ", " ")); assert.equal((await row(10)).provider_name, "Corrected");
    assert.equal((await persist(old, snapshot(null, "No identity"))).coachId, null);
    assert.equal((await persist(old, snapshot(999, " "))).coachId, null);
    assert.equal((await persist(old, snapshot(10, null))).coachId, first.coachId);
    assert.equal((await getCoachById(scope(restricted), first.coachId))?.displayName, "Русское имя");
    await owner.query(`update ${quoted}.coaches set name_ru_review_status='unreviewed' where id=$1`, [first.coachId]);
    assert.equal((await getCoachById(scope(restricted), first.coachId))?.displayName, "Corrected");
    assert.equal((await getCoachesByIds(scope(restricted), [first.coachId, first.coachId, randomUUID()])).length, 1);
    const unchanged = await row(10); await persist(recent, snapshot(10, "Corrected", null)); assert.deepEqual(await row(10), unchanged);
    evidence("profile: old/missing/tied input preserves facts; localization fallback", await getCoachById(scope(restricted), first.coachId));

    const fill = await persist(recent, snapshot(11, "New without photo"));
    await persist(old, snapshot(11, "Old with photo", "https://fixture.invalid/fill"));
    assert.equal((await row(11)).name_source_match_id, recent); assert.equal((await row(11)).photo_source_match_id, old);
    // Mutable source Match date is read anew, not frozen in the Coach profile.
    await owner.query(`update ${quoted}.matches set kickoff_at='2026-09-01',status='cancelled' where id=$1`, [recent]);
    assert.equal((await row(10)).provider_name, "Corrected", "Source cancellation must not erase accepted profile facts");
    await persist(old, snapshot(11, "Date correction permits update", null));
    assert.equal((await row(11)).provider_name, "Date correction permits update");
    assert(await getCoachById(scope(restricted), fill.coachId!));
    await owner.query(`update ${quoted}.matches set kickoff_at='2026-10-10',status='finished' where id=$1`, [recent]);

    // Genuine unique-key contention: second creation waits for the first transaction, then reuses its UUID.
    const writer = await restricted.connect(), waiter = await restricted.connect();
    let pending: Promise<unknown> | undefined;
    try {
      await writer.query("begin"); await waiter.query("begin");
      const one = (await resolveCoachesForLineups(scope(writer), old, [snapshot(12, "Concurrent old")]))[0];
      const pid = (await waiter.query("select pg_backend_pid() as pid")).rows[0].pid as number;
      pending = resolveCoachesForLineups(scope(waiter), recent, [snapshot(12, "Concurrent new")]);
      await waitForLock(pid); await writer.query("commit");
      const two = await pending as (CoachSnapshot & { coachId: string })[]; await waiter.query("commit");
      assert.equal(two[0].coachId, one.coachId); assert.equal((await row(12)).provider_name, "Concurrent new");
    } finally { await writer.query("rollback"); await waiter.query("rollback"); await pending; writer.release(); waiter.release(); }

    // READ COMMITTED source dates are fetched after a Coach lock wait, not before it.
    const blocker = await owner.connect(), worker = await restricted.connect(); let delayed: Promise<unknown> | undefined;
    try {
      await blocker.query("begin"); await blocker.query(`select id from ${quoted}.coaches where provider_coach_id=12 for update`);
      await worker.query("begin"); const pid = (await worker.query("select pg_backend_pid() as pid")).rows[0].pid as number;
      delayed = resolveCoachesForLineups(scope(worker), sameDate, [snapshot(12, "After changed source date")]);
      await waitForLock(pid);
      await blocker.query(`update ${quoted}.matches set kickoff_at='2026-09-01' where id=$1`, [recent]);
      await blocker.query("commit"); await delayed; await worker.query("commit");
      assert.equal((await row(12)).provider_name, "After changed source date");
    } finally { await blocker.query("rollback"); await worker.query("rollback"); await delayed; blocker.release(); worker.release(); }

    // Real Lineups transaction, snapshot replacement, rollback and heartbeat boundary.
    const live = await match("2026-10-18T12:00:00Z", "scheduled");
    assert.equal((await sync(live, [lineup(20, "Prematch Coach")])).status, "success");
    const prematch = await row(20); assert(prematch);
    assert.equal((await observation()).kind, "unknown", "Prematch Coach must not become last known Team coach");
    const stored = (await owner.query(`select * from ${quoted}.match_lineups where match_id=$1`, [live])).rows[0];
    assert.equal(stored.coach_id, prematch.id, "Live persistence must store the resolved internal Coach FK");
    assert.deepEqual(stored.provider_raw, lineup(20, "Prematch Coach"), "Coach resolution changed provider snapshot");
    await sync(live, [lineup(20, " ", "invalid")]);
    assert.equal((await row(20)).provider_name, "Prematch Coach");
    const incomplete = (await owner.query(`select * from ${quoted}.match_lineups where match_id=$1`, [live])).rows[0];
    assert.equal(incomplete.coach_id, prematch.id); assert.equal(incomplete.provider_coach_name, " ");
    assert.equal(incomplete.provider_coach_photo_url, "invalid");
    await sync(live, [lineup(20, "Prematch Coach")]);
    const beforeRollback = (await owner.query(`select * from ${quoted}.match_lineups where match_id=$1`, [live])).rows[0];
    await assert.rejects(sync(live, [lineup(21, "Rolled back Coach")], { failEntry: true }), /Injected/);
    assert.equal(await row(21), undefined);
    assert.deepEqual((await owner.query(`select * from ${quoted}.match_lineups where match_id=$1`, [live])).rows[0], beforeRollback);
    await assert.rejects(sync(live, [lineup(22, "Lost lease")], { heartbeat: async () => { throw new Error("Lease lost"); } }), /Lease lost/);
    assert.equal(await row(22), undefined);
    await sync(live, []); assert.deepEqual((await owner.query(`select * from ${quoted}.match_lineups where match_id=$1`, [live])).rows[0], beforeRollback);
    await sync(live, [lineup(null, null)]); assert(await row(20));
    await owner.query(`delete from ${quoted}.match_lineups where match_id=$1`, [live]); assert(await row(20));

    // Finished-only chronology; null snapshot falls back, unresolved identity blocks fallback.
    await saveObservation(old, snapshot(10, "Old snapshot"), first.coachId);
    const nullLast = await match("2026-10-15T12:00:00Z"); await saveObservation(nullLast, snapshot(null, null));
    let known = await observation(); assert.equal(known.kind, "known");
    if (known.kind === "known") assert.equal(known.candidate.sources[0].matchId, old);
    for (const status of ["scheduled", "live", "paused", "suspended", "interrupted", "postponed", "abandoned", "cancelled", "awarded", "walkover"]) {
      const excluded = await match("2026-10-18T18:00:00Z", status); await saveObservation(excluded, snapshot(123456, status));
      assert.equal((await observation()).kind, "known", status);
    }
    const unresolved = await match("2026-10-16T12:00:00Z"); await saveObservation(unresolved, snapshot(999, null));
    assert.equal((await observation()).kind, "unresolved"); evidence("unresolved identity stops fallback", await observation());
    const resolved = await persist(unresolved, snapshot(999, "Resolved later")); assert(resolved.coachId);
    // coach_id is still null; read-only provider-pair resolution must work without repair writes.
    known = await observation(); assert.equal(known.kind, "known");
    if (known.kind === "known") assert.equal(known.candidate.coach.id, resolved.coachId);
    const tied = await match("2026-10-16T12:00:00Z"); await saveObservation(tied, snapshot(10, "Tied other coach"), first.coachId);
    assert.equal((await observation()).kind, "ambiguous"); evidence("same kickoff: distinct identities are ambiguous", await observation());
    await owner.query(`update ${quoted}.match_lineups set provider_coach_id=999,coach_id=null where match_id=$1`, [tied]);
    known = await observation(); assert.equal(known.kind, "known"); if (known.kind === "known") assert.equal(known.candidate.sources.length, 2);
    await saveObservation(undated, snapshot(10, "Undated"));
    const future = await match("2027-01-01T12:00:00Z"); await saveObservation(future, snapshot(10, "Future finished"));
    assert.equal((await observation()).chronologyIncomplete, true);
    evidence("finished-only known Coach and source Matches", await observation());
    // One statement uses all persisted competitions, never only current-season import scope.
    const otherSeason = randomUUID(), otherCompetition = randomUUID();
    await owner.query(`insert into ${quoted}.competitions(id,provider,provider_competition_id,provider_name,slug) values($1,'api-football',999,'Other fixture tournament',$1)`, [otherCompetition]);
    await owner.query(`insert into ${quoted}.seasons(id,competition_id,provider,provider_season_year,provider_current,display_label) values($1,$2,'api-football',2026,true,'2026')`, [otherSeason, otherCompetition]);
    const other = await match("2026-10-17T12:00:00Z"); await owner.query(`update ${quoted}.matches set season_id=$2 where id=$1`, [other, otherSeason]);
    await saveObservation(other, snapshot(10, "Other competition"), first.coachId);
    known = await observation(); assert.equal(known.kind, "known"); if (known.kind === "known") assert.equal(known.candidate.sources[0].matchId, other);

    // Historical mechanism executes ONLY against synthetic schema; real CLI apply is never run.
    const historical = await match("2026-08-01T12:00:00Z"); const historicalId = await saveObservation(historical, snapshot(30, "Historical Coach"));
    const immutable = (await owner.query(`select to_jsonb(l)-'coach_id' as value from ${quoted}.match_lineups l where id=$1`, [historicalId])).rows[0].value;
    const reader = await owner.connect();
    try { await reader.query("begin read only"); assert.equal((await previewLineupCoaches(scope(reader), [historical]))[0].unresolved_references, 1); await reader.query("commit"); }
    finally { reader.release(); }
    assert.equal(await row(30), undefined, "Dry run created a Coach");
    const repair = await owner.connect();
    try {
      const adapted = { query: scope(repair).query } as pg.PoolClient;
      assert.equal((await applyLineupCoaches(adapted, historical))[0].linked, true);
      assert.equal((await applyLineupCoaches(adapted, historical))[0].linked, false);
      assert.deepEqual((await owner.query(`select to_jsonb(l)-'coach_id' as value from ${quoted}.match_lineups l where id=$1`, [historicalId])).rows[0].value, immutable);
      await assert.rejects(applyLineupCoaches(adapted, other), /outside current Serie A/);
    } finally { repair.release(); }
    // Live replacement owns the Match lock; historical apply waits and then reads the committed replacement.
    const replacing = await owner.connect(), repairing = await owner.connect(); let repairPending: Promise<unknown> | undefined;
    try {
      await replacing.query("begin"); await replacing.query(`select id from ${quoted}.matches where id=$1 for no key update`, [historical]);
      const pid = (await repairing.query("select pg_backend_pid() as pid")).rows[0].pid as number;
      repairPending = applyLineupCoaches({ query: scope(repairing).query } as pg.PoolClient, historical);
      await waitForLock(pid);
      await replacing.query(`delete from ${quoted}.match_lineups where id=$1`, [historicalId]);
      const replacementId = randomUUID();
      await replacing.query(`insert into ${quoted}.match_lineups(id,match_id,club_id,provider_coach_id,provider_coach_name,provider_raw) values($1,$2,$3,31,'Replacement Coach','{}')`, [replacementId, historical, clubs[0]]);
      await replacing.query("commit"); await repairPending;
      const link = (await owner.query(`select coach_id from ${quoted}.match_lineups where id=$1`, [replacementId])).rows[0].coach_id;
      assert.equal(link, (await row(31)).id); assert.notEqual(link, (await row(30)).id);
    } finally { await replacing.query("rollback"); await repairPending; replacing.release(); repairing.release(); }

    await assert.rejects(restricted.query(`delete from ${quoted}.coaches where false`), { code: "42501" });
    await assert.rejects(restricted.query(`update ${quoted}.match_lineups set coach_id=null where false`), { code: "42501" });
    for (const sql of ["provider_coach_id=0", "provider_name=' '", "localization_revision=-1", "name_ru='x',name_ru_review_status=null", "photo_source_match_id=null"]) {
      await assert.rejects(owner.query(`update ${quoted}.coaches set ${sql} where provider_coach_id=10`), { code: "23514" });
    }
    await assert.rejects(owner.query(`update ${quoted}.coaches set name_source_match_id=$1 where provider_coach_id=10`, [randomUUID()]), { code: "23503" });
    await assert.rejects(owner.query(`delete from ${quoted}.matches where id=$1`, [recent]), { code: "23001" });
    await owner.query(`delete from ${quoted}.coaches where provider_coach_id=10`);
    assert.equal((await owner.query(`select coach_id from ${quoted}.match_lineups where match_id=$1`, [old])).rows[0].coach_id, null);
    assert.equal((await observation()).kind, "unresolved", "Deleted canonical identity must not fall back to older Coach");
    await checkCoachManifest({ owner, scope, match, saveObservation, sync });
    assert.deepEqual(await canonicalFingerprint(), before, "Canonical Football data changed by fixture check");
  } finally {
    if (created) await owner.query(`drop schema ${quoted} cascade`);
    globalThis.fetch = savedFetch; await restricted.end(); await owner.end();
  }
  console.log("football_coaches_check=passed");
  console.log("identity_chronology_localization_snapshots_finished_reads_constraints_grants_rollback_concurrency_repair=true");
  console.log("canonical_data_writes=0 provider_requests=0 real_jobs=0 fixture_cleanup=complete");
}
main().catch((error: unknown) => {
  console.error("football_coaches_check=failed", error instanceof assert.AssertionError ? error.message :
    { name: error instanceof Error ? error.name : "UnknownError", code: (error as { code?: string })?.code,
      table: (error as { table?: string })?.table, column: (error as { column?: string })?.column,
      constraint: (error as { constraint?: string })?.constraint }); process.exitCode = 1;
});
