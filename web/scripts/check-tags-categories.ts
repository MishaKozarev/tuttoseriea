import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { config } from "dotenv";
import pg from "pg";
import { upsertClub, upsertCompetition, upsertSerieACompetition } from "../src/football/repository";
import { upsertPlayer } from "../src/football/squads-repository";
import { upsertPlayerProfile } from "../src/football/player-statistics-repository";
import { resolveLineupCoach } from "../src/football/coaches-repository";
import { upsertCoachProfile } from "../src/football/coach-profile-repository";
import { parseCoachProfile } from "../src/football/coach-profile";
import { coachProfileFixture } from "../tests/fixtures/coach-profile";
import { listFootballTags, getFootballTagsByIds } from "../src/taxonomy/football-tags-repository";
import { applyTagManifestBatch, createTagManifest, validateTagManifest, verifyTagManifest } from "../src/taxonomy/tag-reconciliation";
import { ArticleCategoryRepository, NewsCategoryRepository } from "../src/categories/repository";
import { CategoryError } from "../src/categories/management";
import { quoteIdentifier } from "../src/jobs/config";
import { createFixtureFootballTags } from "./fixtures/football-tags";

config({ path: ".env.local", quiet: true }); config({ path: ".env", quiet: true });
type Db = Pick<pg.Pool | pg.PoolClient, "query">;
async function main() {
  const ownerUrl = new URL(process.env.MIGRATION_DATABASE_URL ?? ""), runtimeUrl = new URL(process.env.DATABASE_URL ?? "");
  for (const url of [ownerUrl, runtimeUrl]) {
    assert(["localhost", "127.0.0.1"].includes(url.hostname) &&
      (url.port === "15432" && url.pathname === "/tuttoseriea_local" || process.env.CI === "true" && url.port === "5432" && url.pathname === "/tuttoseriea_ci"), "Only LOCAL/exact CI allowed");
  }
  assert.equal(ownerUrl.host, runtimeUrl.host); assert.equal(ownerUrl.pathname, runtimeUrl.pathname);
  const owner = new pg.Pool({ connectionString: ownerUrl.href, max: 4 }), runtime = new pg.Pool({ connectionString: runtimeUrl.href, max: 4 });
  const fixture = quoteIdentifier(`tags_categories_${randomUUID().replaceAll("-", "")}`);
  const scope = (db: Db): Db => ({ query: ((sql: string, values?: unknown[]) => {
    assert.equal(typeof sql, "string");
    const rewritten = sql.replace(/\barticle\.categories/g, `${fixture}.article_categories`).replace(/\bnews\.categories/g, `${fixture}.news_categories`)
      .replace(/\b(?:football|taxonomy)\./g, `${fixture}.`);
    assert(!/\b(?:football|taxonomy|article|news)\./.test(rewritten));
    return db.query(rewritten, values);
  }) as Db["query"] });
  const sourceTables = ["clubs", "players", "coaches", "competitions"];
  const canonical = async () => {
    const values = [];
    for (const table of [...sourceTables.map(t => `football.${t}`), "taxonomy.football_tags", "article.categories", "news.categories"]) {
      values.push((await owner.query(`select count(*)::int as n,md5(coalesce(string_agg(to_jsonb(t)::text,',' order by id),'')) as hash from ${table} t`)).rows[0]);
    }
    return values;
  };
  const before = await canonical();
  const savedFetch = globalThis.fetch; globalThis.fetch = async () => { throw Error("Provider/network forbidden in Tags fixtures"); };
  const clubInput = { providerClubId: 7, providerName: "Fixture Club", code: null, country: "Italy", founded: null, national: false, providerLogoUrl: "https://fixture.invalid/old.png" };
  const db = scope(runtime), admin = scope(owner);
  const article = new ArticleCategoryRepository(db), news = new NewsCategoryRepository(db);
  const waitForLock = async (pid: number) => {
    for (let i = 0; i < 300; i++) {
      if ((await owner.query("select wait_event_type from pg_stat_activity where pid=$1", [pid])).rows[0]?.wait_event_type === "Lock") return;
      await delay(10);
    }
    assert.fail("Expected PostgreSQL lock wait");
  };
  let created = false;
  try {
    await owner.query(`create schema ${fixture}`); created = true;
    const role = (await runtime.query("select current_user")).rows[0].current_user;
    assert.notEqual(role, ownerUrl.username);
    await owner.query(`grant usage on schema ${fixture} to ${quoteIdentifier(role)}`);
    for (const table of sourceTables) {
      await owner.query(`create table ${fixture}.${table} (like football.${table} including all)`);
      await owner.query(`grant SELECT,INSERT,UPDATE on ${fixture}.${table} to ${quoteIdentifier(role)}`);
    }
    await createFixtureFootballTags(owner, fixture, quoteIdentifier(role));
    for (const kind of ["article", "news"]) {
      await owner.query(`create table ${fixture}.${kind}_categories (like ${kind}.categories including all)`);
      await owner.query(`grant SELECT,INSERT,UPDATE,DELETE on ${fixture}.${kind}_categories to ${quoteIdentifier(role)}`);
    }
    await owner.query(`create table ${fixture}.future_article_usage(id text primary key,category_id text references ${fixture}.article_categories(id) on delete restrict)`);
    const club = await upsertClub(db, clubInput);
    const player = await upsertPlayer(db, { providerPlayerId: 7, providerName: "Fixture Player", age: 25, providerPhotoUrl: null });
    assert.equal(await upsertPlayerProfile(db, { providerPlayerId: 7, providerName: "Full Player", firstname: null, lastname: null, age: 26,
      birthDate: null, birthPlace: null, birthCountry: null, nationality: null, height: null, weight: null, injured: false, providerPhotoUrl: "https://fixture.invalid/player" }), player);
    const competition = await upsertCompetition(db, { providerCompetitionId: 7, providerName: "Standalone competition", country: null, type: "Cup", providerLogoUrl: null });
    assert.equal(await upsertCompetition(db, { providerCompetitionId: 7, providerName: "Changed competition", country: null, type: "Cup", providerLogoUrl: null }), competition);
    await upsertSerieACompetition(db, { providerName: "Serie A", country: "Italy", type: "League", providerLogoUrl: null });
    const coachMatch = { id: randomUUID(), provider: "api-football", kickoff_at: null, in_scope: true };
    const coach = await resolveLineupCoach(db, coachMatch, { providerCoachId: 7, providerCoachName: "Never a full profile", providerCoachPhotoUrl: "https://fixture.invalid/snapshot" });
    assert(coach.id); assert(coach.created);
    assert.equal((await resolveLineupCoach(db, coachMatch, { providerCoachId: 7, providerCoachName: null, providerCoachPhotoUrl: null })).id, coach.id);
    let tags = await listFootballTags(db, { kind: "all", query: "", page: 1 }); assert.equal(tags.total, 5);
    const coachTag = tags.items.find(t => t.kind === "coaches")!;
    assert.equal(coachTag.displayName, "Coach #7"); assert.equal(coachTag.imageUrl, null); assert.equal(coachTag.profileAvailable, false);
    await upsertCoachProfile(db, parseCoachProfile(coachProfileFixture(7, "API Coach"), 7), new Date("2026-10-21T12:00:00Z"));
    assert.equal((await getFootballTagsByIds(db, [coachTag.id]))[0].displayName, "API Coach");
    assert.equal(await upsertCoachProfile(db, parseCoachProfile(coachProfileFixture(7, "Older Coach"), 7), new Date("2026-10-20T12:00:00Z")), false);
    assert.equal((await getFootballTagsByIds(db, [coachTag.id]))[0].displayName, "API Coach");
    const clubTag = tags.items.find(t => t.sourceEntityId === club)!;
    await admin.query("update football.clubs set name_ru='Reviewed tag',name_ru_review_status='reviewed',localization_revision=8 where id=$1", [club]);
    assert.equal(await upsertClub(db, { ...clubInput, providerName: "Changed Club", providerLogoUrl: "https://fixture.invalid/new.png" }), club);
    const updatedTag = (await getFootballTagsByIds(db, [clubTag.id, clubTag.id]))[0];
    assert.equal(updatedTag.displayName, "Reviewed tag"); assert.equal(updatedTag.imageUrl, "https://fixture.invalid/new.png");
    assert.equal((await admin.query("select localization_revision from football.clubs where id=$1", [club])).rows[0].localization_revision, 8);
    assert.equal((await listFootballTags(db, { kind: "all", query: "7", page: 1 })).total, 4);
    assert.equal((await listFootballTags(db, { kind: "all", query: "%", page: 1 })).total, 0);
    assert.equal((await listFootballTags(db, { kind: "coaches", query: "", page: 2 })).items.length, 0);
    for (const [table, id] of [["clubs", club], ["players", player], ["coaches", coach.id], ["competitions", competition]]) {
      await assert.rejects(admin.query(`delete from football.${table} where id=$1`, [id]), { code: "23001" });
    }
    await assert.rejects(runtime.query(`update ${fixture}.football_tags set id=id where false`), { code: "42501" });
    await assert.rejects(runtime.query(`delete from ${fixture}.football_tags where false`), { code: "42501" });
    await assert.rejects(owner.query(`insert into ${fixture}.football_tags(id) values('no-source')`), { code: "23514" });
    await assert.rejects(owner.query(`insert into ${fixture}.football_tags(id,club_id,player_id) values('two-sources',$1,$2)`, [club, player]), { code: "23514" });

    // Real same-provider upsert contention, stable Football and Tag IDs.
    const one = await runtime.connect(), two = await runtime.connect(); let pending: Promise<string> | undefined;
    try {
      await one.query("begin"); const first = await upsertClub(scope(one), { ...clubInput, providerClubId: 8 });
      const pid = (await two.query("select pg_backend_pid() as pid")).rows[0].pid;
      pending = upsertClub(scope(two), { ...clubInput, providerClubId: 8 }); await waitForLock(pid);
      await one.query("commit"); assert.equal(await pending, first);
      assert.equal((await admin.query("select count(*)::int as n from taxonomy.football_tags where club_id=$1", [first])).rows[0].n, 1);
    } finally { await one.query("rollback"); await pending; one.release(); two.release(); }
    // A failed tag insert must roll back even a Pool.query() Football insert.
    await upsertCoachProfile(db, parseCoachProfile(coachProfileFixture(81, "API-first identity"), 81), new Date("2026-10-21T12:00:00Z"));
    const profileInput = { providerPlayerId: 81, providerName: "Profile-first player", firstname: null, lastname: null, age: null,
      birthDate: null, birthPlace: null, birthCountry: null, nationality: null, height: null, weight: null, injured: null, providerPhotoUrl: null };
    await upsertPlayerProfile(db, profileInput);
    assert.equal((await listFootballTags(db, { kind: "all", query: "81", page: 1 })).total, 2);
    const atomicBefore = await Promise.all(sourceTables.map(t => admin.query(`select md5(string_agg(to_jsonb(s)::text,',' order by id)) as hash from football.${t} s`).then(r => r.rows[0].hash)));
    await owner.query(`alter table ${fixture}.football_tags add constraint fixture_reject_tag check(false) not valid`);
    try {
      const operations = [
        () => upsertSerieACompetition(db, { providerName: "Rejected change", country: null, type: null, providerLogoUrl: null }),
        () => upsertClub(db, { ...clubInput, providerClubId: 9 }),
        () => upsertPlayer(db, { providerPlayerId: 9, providerName: "Rejected", age: null, providerPhotoUrl: null }),
        () => upsertPlayerProfile(db, { ...profileInput, providerPlayerId: 9 }),
        () => resolveLineupCoach(db, coachMatch, { providerCoachId: 9, providerCoachName: null, providerCoachPhotoUrl: null }),
        () => upsertCoachProfile(db, parseCoachProfile(coachProfileFixture(9), 9), new Date("2026-10-21T12:00:00Z")),
      ];
      for (const operation of operations) await assert.rejects(operation(), { code: "23514" });
      assert.equal((await admin.query("select count(*)::int as n from football.clubs where provider_club_id=9")).rows[0].n, 0);
      assert.deepEqual(await Promise.all(sourceTables.map(t => admin.query(`select md5(string_agg(to_jsonb(s)::text,',' order by id)) as hash from football.${t} s`).then(r => r.rows[0].hash))), atomicBefore);
    } finally { await owner.query(`alter table ${fixture}.football_tags drop constraint fixture_reject_tag`); }

    const category = await article.create({ name: "  Category  " }); assert.equal(category.name, "Category");
    await assert.rejects(article.create({ name: "category" }), (e: unknown) => e instanceof CategoryError && e.code === "CATEGORY_NAME_CONFLICT");
    const newsCategory = await news.create({ name: "CATEGORY" }); // independent namespace
    assert.equal((await news.edit(newsCategory.id, { name: "News renamed", expectedRevision: 0 })).revision, 1);
    await news.delete(newsCategory.id, { expectedRevision: 1, confirmed: true }); assert.equal(await news.get(newsCategory.id), null);
    await Promise.all(Array.from({ length: 21 }, (_, i) => article.create({ name: `Paged ${String(i).padStart(2, "0")}` })));
    assert.equal((await article.list({ query: "Paged", page: 1 })).items.length, 20);
    assert.equal((await article.list({ query: "Paged", page: 2 })).items.length, 1);
    await news.create({ name: "Literal %_!" }); assert.equal((await news.list({ query: "%_!", page: 1 })).total, 1);
    await assert.rejects(article.create({ name: "\t " }));
    const edits = await Promise.allSettled([article.edit(category.id, { name: "Changed A", expectedRevision: 0 }), article.edit(category.id, { name: "Changed B", expectedRevision: 0 })]);
    assert.equal(edits.filter(r => r.status === "fulfilled").length, 1);
    assert.equal(edits.filter(r => r.status === "rejected" && r.reason.code === "CATEGORY_CONFLICT").length, 1);
    assert.equal((await article.get(category.id))?.revision, 1);
    // PostgreSQL owns used-category protection. This is an ephemeral FK fixture, not Article implementation.
    await owner.query(`insert into ${fixture}.future_article_usage values('usage',$1)`, [category.id]);
    await assert.rejects(article.delete(category.id, { expectedRevision: 1, confirmed: true }), (e: unknown) => e instanceof CategoryError && e.code === "CATEGORY_IN_USE");
    await owner.query(`delete from ${fixture}.future_article_usage`);
    await article.delete(category.id, { expectedRevision: 1, confirmed: true }); assert.equal(await article.get(category.id), null);
    const concurrentCategory = await article.create({ name: "Race category" });
    const referencing = await owner.connect(), deleting = await runtime.connect(); let deletion: Promise<void> | undefined;
    try {
      await referencing.query("begin"); await referencing.query(`insert into ${fixture}.future_article_usage values('race',$1)`, [concurrentCategory.id]);
      const pid = (await deleting.query("select pg_backend_pid() as pid")).rows[0].pid;
      deletion = new ArticleCategoryRepository(scope(deleting)).delete(concurrentCategory.id, { expectedRevision: 0, confirmed: true });
      const checked = assert.rejects(deletion, (e: unknown) => e instanceof CategoryError && e.code === "CATEGORY_IN_USE");
      await waitForLock(pid); await referencing.query("commit"); await checked;
    } finally { await referencing.query("rollback"); await deletion?.catch(() => undefined); referencing.release(); deleting.release(); }
    const deletingFirst = await owner.connect(), laterReference = await owner.connect(); let insertion: Promise<unknown> | undefined;
    try {
      await deletingFirst.query("begin"); await deletingFirst.query(`delete from ${fixture}.future_article_usage`);
      await new ArticleCategoryRepository(scope(deletingFirst)).delete(concurrentCategory.id, { expectedRevision: 0, confirmed: true });
      const pid = (await laterReference.query("select pg_backend_pid() as pid")).rows[0].pid;
      insertion = laterReference.query(`insert into ${fixture}.future_article_usage values('late',$1)`, [concurrentCategory.id]);
      const checked = assert.rejects(insertion, { code: "23503" }); await waitForLock(pid); await deletingFirst.query("commit"); await checked;
    } finally { await deletingFirst.query("rollback"); await insertion?.catch(() => undefined); deletingFirst.release(); laterReference.release(); }

    // 501 pre-existing synthetic identities force a bounded two-batch manifest.
    await admin.query(`insert into football.competitions(id,provider,provider_competition_id,provider_name,slug)
      select 'initial-'||i,'api-football',100000+i,'Initial '||i,'initial-'||i from generate_series(1,501) i`);
    const sourceSnapshot = async () => Promise.all(sourceTables.map(t => admin.query(`select md5(string_agg(to_jsonb(s)::text,',' order by id)) as hash from football.${t} s`).then(r => r.rows[0].hash)));
    const sourceBefore = await sourceSnapshot();
    const target = { stage: "local" as const, database: "tuttoseriea_local" };
    const planner = await owner.connect(); let manifest;
    try { await planner.query("begin isolation level repeatable read read only"); manifest = await createTagManifest(scope(planner), target); await planner.query("commit"); }
    finally { planner.release(); }
    assert.equal(manifest.forecast.createTags, 501); assert.equal(manifest.batchCount, 2);
    assert.throws(() => validateTagManifest({ ...manifest, hash: "a".repeat(64) }, target));
    const applier = await owner.connect(), competitor = await owner.connect();
    try {
      await assert.rejects(applyTagManifestBatch(scope(applier) as pg.PoolClient, manifest, target, 1, "b".repeat(64)));
      await competitor.query("begin"); await competitor.query("select pg_advisory_xact_lock(hashtextextended('football-tags-reconciliation:v1',0))");
      await assert.rejects(applyTagManifestBatch(scope(applier) as pg.PoolClient, manifest, target, 1, manifest.hash), /TAG_RECONCILIATION_BUSY/); await competitor.query("rollback");
      const original = (await admin.query("select to_jsonb(c) as value from football.competitions c where id='initial-19'")).rows[0].value;
      const tagIdsBeforeDrift = (await admin.query("select id from taxonomy.football_tags order by id")).rows;
      await admin.query("delete from football.competitions where id='initial-19'");
      await assert.rejects(applyTagManifestBatch(scope(applier) as pg.PoolClient, manifest, target, 1, manifest.hash), /TAG_SOURCE_DISAPPEARED/);
      assert.deepEqual((await admin.query("select id from taxonomy.football_tags order by id")).rows, tagIdsBeforeDrift, "Failed batch committed partial Tags");
      await admin.query("insert into football.competitions select (jsonb_populate_record(null::football.competitions,$1::jsonb)).*", [original]);
      for (let i = 1; i <= manifest.batchCount; i++) await applyTagManifestBatch(scope(applier) as pg.PoolClient, manifest, target, i, manifest.hash);
      assert.equal((await verifyTagManifest(admin, manifest, target)).complete, true);
      const idsBefore = (await admin.query("select id from taxonomy.football_tags order by id")).rows;
      for (let i = 1; i <= manifest.batchCount; i++) assert.equal((await applyTagManifestBatch(scope(applier) as pg.PoolClient, manifest, target, i, manifest.hash)).created, 0);
      assert.deepEqual((await admin.query("select id from taxonomy.football_tags order by id")).rows, idsBefore);
      assert.deepEqual(await sourceSnapshot(), sourceBefore);
      assert.equal((await createTagManifest(admin, target)).forecast.createTags, 0);
      tags = await listFootballTags(db, { kind: "competitions", query: "Initial", page: 2 }); assert.equal(tags.items.length, 20); assert.equal(tags.total, 501);
    } finally { await competitor.query("rollback"); applier.release(); competitor.release(); }
    assert.deepEqual(await canonical(), before, "Canonical Football/Tags/Categories changed");
    console.log("tags_categories_postgresql=passed six_writers_atomicity_concurrency_identity_localization_images_categories_cas_fk_races_manifest_batches_replay=true");
  } finally {
    if (created) await owner.query(`drop schema ${fixture} cascade`);
    globalThis.fetch = savedFetch; await runtime.end(); await owner.end();
  }
  console.log("canonical_writes=0 provider_requests=0 real_jobs=0 fixture_cleanup=complete");
}
main().catch((error: unknown) => {
  console.error("tags_categories_check=failed", error instanceof assert.AssertionError ? error.message :
    { name: error instanceof Error ? error.name : "unknown", code: (error as { code?: string })?.code,
      table: (error as { table?: string })?.table, constraint: (error as { constraint?: string })?.constraint }); process.exitCode = 1;
});
