import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import type pg from "pg";
import { applyCoachManifestBatch, createCoachReconciliationPlan, verifyCoachManifest, validateCoachManifest, type CoachReconciliationManifest } from "../src/football/coach-reconciliation-plan";
import type { CoachQueryable } from "../src/football/coaches-repository";
import type { CoachSnapshot } from "../src/football/coaches";

export async function checkCoachManifest(input: {
  owner: pg.Pool; scope: (db: CoachQueryable) => CoachQueryable;
  match: (date: string | null, status?: string) => Promise<string>;
  saveObservation: (match: string, input: CoachSnapshot) => Promise<string>;
  sync: (match: string, data: unknown[]) => Promise<unknown>;
}) {
  const target = { stage: "local" as const, database: "tuttoseriea_local" };
  const snapshot = (providerCoachId: number | null, providerCoachName: string | null): CoachSnapshot => ({ providerCoachId, providerCoachName, providerCoachPhotoUrl: null });
  const plan = async (ids: string[]) => {
    const client = await input.owner.connect();
    try { await client.query("begin isolation level repeatable read read only"); await client.query("set local time zone 'UTC'");
      const value = await createCoachReconciliationPlan(input.scope(client), target, ids); await client.query("commit"); return value;
    } finally { await client.query("rollback"); client.release(); }
  };
  const verify = async (manifest: CoachReconciliationManifest) => {
    const client = await input.owner.connect();
    try { await client.query("begin isolation level repeatable read read only"); await client.query("set local time zone 'UTC'");
      const value = await verifyCoachManifest(input.scope(client), manifest, target); await client.query("commit"); return value;
    } finally { await client.query("rollback"); client.release(); }
  };
  const apply = async (manifest: CoachReconciliationManifest, pass: "profiles" | "links", batch: number, progress?: (value: unknown) => void) => {
    const client = await input.owner.connect();
    try { return await applyCoachManifestBatch(input.scope(client), manifest, target, pass, batch, manifest.hash, progress); }
    finally { client.release(); }
  };
  const matches: string[] = [], lineups: string[] = [];
  for (let i = 0; i < 51; i++) {
    const id = await input.match(new Date(Date.parse("2026-08-01T12:00:00Z") + i * 60000).toISOString()); matches.push(id);
    lineups.push(await input.saveObservation(id, snapshot(i === 0 || i === 50 ? 9000 : null, i === 0 ? "Cross-batch Coach" : null)));
  }
  const manifest = await plan(matches);
  assert.equal(manifest.batchCount, 2); assert.equal(manifest.forecast.createCoaches, 1); assert.equal(manifest.forecast.linkLineups, 2);
  assert.equal(manifest.forecast.missingProviderId, 49);
  assert.throws(() => validateCoachManifest({ ...manifest, hash: "0".repeat(64) }, target));
  assert.throws(() => validateCoachManifest(manifest, { ...target, stage: "staging" }));
  await assert.rejects(apply(manifest, "profiles", 3), /COACH_INVALID_BATCH/);
  // An early link pass cannot create profiles or misreport successful completion.
  assert.equal((await apply(manifest, "links", 1)).createdCoaches, 0);
  assert.equal((await verify(manifest)).complete, false);
  // A changed source stops mid-batch, reports already committed Matches, and supports retry.
  const second = manifest.matches[1]; const oldRaw = (await input.scope(input.owner).query("select provider_raw from football.match_lineups where id=$1", [second.lineups[0].id])).rows[0].provider_raw;
  await input.scope(input.owner).query("update football.match_lineups set provider_raw='{}' where id=$1", [second.lineups[0].id]);
  const progress: unknown[] = [];
  await assert.rejects(apply(manifest, "profiles", 1, (event) => progress.push(event)), /COACH_SOURCE_DRIFT/);
  assert.equal((progress.at(-1) as { completed: string[] }).completed.length, 1);
  await input.scope(input.owner).query("update football.match_lineups set provider_raw=$2 where id=$1", [second.lineups[0].id, oldRaw]);
  assert.equal((await apply(manifest, "profiles", 1)).createdCoaches, 0);
  assert.equal((await apply(manifest, "profiles", 2)).createdCoaches, 1);
  assert.equal((await verify(manifest)).remainingLinks, 1);
  assert.equal((await apply(manifest, "links", 1)).linkedLineups, 1);
  await apply(manifest, "links", 2);
  const complete = await verify(manifest); assert.equal(complete.complete, true); assert.equal(complete.linked, 2); assert.equal(complete.newCoachesSincePlan, 1);
  for (const pass of ["profiles", "links"] as const) for (let batch = 1; batch <= 2; batch++) {
    const result = await apply(manifest, pass, batch); assert.equal(result.createdCoaches, 0); assert.equal(result.linkedLineups, 0);
  }
  const replay = await plan(matches); assert.equal(replay.forecast.createCoaches, 0); assert.equal(replay.forecast.linkLineups, 0);

  // Profile facts can change concurrently without changing snapshot fingerprints: an unplanned tie must roll back.
  const changed = await input.match("2026-09-03T12:00:00Z"), concurrentEvidence = await input.match("2026-09-03T12:00:00Z");
  await input.saveObservation(changed, snapshot(9000, "Incoming profile correction"));
  const changedPlan = await plan([changed]); assert.equal(changedPlan.forecast.conflicts.length, 0);
  await input.scope(input.owner).query("update football.coaches set provider_name='Concurrent accepted fact',name_source_match_id=$1 where provider_coach_id=9000", [concurrentEvidence]);
  await assert.rejects(apply(changedPlan, "profiles", 1), /COACH_NEW_PROFILE_CONFLICT/);
  assert.equal((await input.scope(input.owner).query("select provider_name from football.coaches where provider_coach_id=9000")).rows[0].provider_name, "Concurrent accepted fact");
  assert.equal((await input.scope(input.owner).query("select coach_id from football.match_lineups where match_id=$1", [changed])).rows[0].coach_id, null);
  const conflictingPlan = await plan([changed]); assert.equal(conflictingPlan.forecast.conflicts.length, 1);
  await apply(conflictingPlan, "profiles", 1); assert.equal((await verify(conflictingPlan)).complete, true);
  // Localized values are never cleared by apply, and verification surfaces concurrent manual drift.
  await input.scope(input.owner).query("update football.coaches set name_ru='Fixture reviewed',name_ru_review_status='reviewed',localization_revision=9 where provider_coach_id=9000");
  await apply(conflictingPlan, "links", 1);
  assert.equal((await verify(conflictingPlan)).complete, false);
  assert.equal((await input.scope(input.owner).query("select localization_revision from football.coaches where provider_coach_id=9000")).rows[0].localization_revision, 9);

  // The real Lineups sync waits behind the manifest's Match lock, then replaces its snapshot.
  const concurrent = await input.match("2026-09-01T12:00:00Z"); await input.saveObservation(concurrent, snapshot(9100, "Before live replacement"));
  const racePlan = await plan([concurrent]); const operator = await input.owner.connect();
  let unlock!: () => void, locked!: () => void;
  const gate = new Promise<void>((resolve) => { unlock = resolve; }), acquired = new Promise<void>((resolve) => { locked = resolve; });
  const db = input.scope(operator); let intercepted = false;
  const held: CoachQueryable = { query: (async (sql: string, values?: unknown[]) => {
    const result = await db.query(sql, values);
    if (!intercepted && sql.includes("coach:lock-match")) { intercepted = true; locked(); await gate; }
    return result;
  }) as CoachQueryable["query"] };
  let live: Promise<unknown> | undefined;
  const writing = applyCoachManifestBatch(held, racePlan, target, "profiles", 1, racePlan.hash);
  try {
    await acquired;
    live = input.sync(concurrent, [{ team: { id: 1, name: "Fixture Home" }, coach: { id: 9101, name: "Live replacement", photo: null }, formation: null, startXI: [], substitutes: [] }]);
    const deadline = Date.now() + 5000; let waiting = false;
    while (!waiting && Date.now() < deadline) {
      waiting = (await input.owner.query("select exists(select 1 from pg_stat_activity where wait_event_type='Lock' and query like '%coach:lock-match%') as waiting")).rows[0].waiting;
      if (!waiting) await delay(15);
    }
    assert(waiting, "Real Lineups sync did not wait for manifest Match lock"); unlock(); await writing; await live;
    const replaced = (await input.scope(input.owner).query(`select l.provider_coach_id,c.provider_coach_id as resolved from football.match_lineups l
      join football.coaches c on c.id=l.coach_id where l.match_id=$1`, [concurrent])).rows[0];
    assert.equal(replaced.provider_coach_id, 9101); assert.equal(replaced.resolved, 9101);
    await assert.rejects(verify(racePlan), /COACH_SOURCE_DRIFT/);
    await assert.rejects(apply(racePlan, "links", 1), /COACH_SOURCE_DRIFT/);
  } finally { unlock(); await writing; await live; operator.release(); }
  console.log("coach_manifest_read_only_cross_batch_hash_drift_partial_restart_replay_live_sync_race=passed");
}
