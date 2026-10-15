import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { config as loadEnv } from "dotenv";
import pg from "pg";

import { FootballLocalizationRepository } from "../src/football/localization-repository";
import { FootballLocalizationError, LOCALIZATION_KINDS, type FootballLocalizationEdit, type LocalizationKind } from "../src/football/localization-management";
import { upsertClub, upsertSerieACompetition } from "../src/football/repository";
import { upsertPlayer } from "../src/football/squads-repository";
import { upsertPlayerProfile } from "../src/football/player-statistics-repository";
import { quoteIdentifier } from "../src/jobs/config";

loadEnv({ path: ".env.local", quiet: true });
loadEnv({ path: ".env", quiet: true });
type Queryable = Pick<pg.Pool | pg.PoolClient, "query">;

async function expectCode(operation: Promise<unknown>, code: string) {
  await assert.rejects(operation, (error: unknown) => error instanceof FootballLocalizationError && error.code === code);
}

async function main() {
  const migrationUrl = new URL(process.env.MIGRATION_DATABASE_URL ?? "");
  const runtimeUrl = new URL(process.env.DATABASE_URL ?? "");
  for (const target of [migrationUrl, runtimeUrl]) {
    const local = target.port === "15432";
    const ci = process.env.CI === "true" && target.port === "5432" && target.pathname === "/tuttoseriea_ci";
    assert(["127.0.0.1", "localhost"].includes(target.hostname) && (local || ci), "Only LOCAL/exact CI PostgreSQL is allowed");
  }
  assert.equal(migrationUrl.host, runtimeUrl.host); assert.equal(migrationUrl.pathname, runtimeUrl.pathname);
  const owner = new pg.Pool({ connectionString: migrationUrl.toString(), max: 2 });
  const runtime = new pg.Pool({ connectionString: runtimeUrl.toString(), max: 3 });
  const schema = `localization_check_${randomUUID().replaceAll("-", "")}`;
  const quoted = quoteIdentifier(schema);
  // Only the fixture adapter rewrites SQL. Production repositories keep their canonical schema.
  const scope = (db: Queryable): Queryable => ({ query: ((sql: string, values?: unknown[]) => {
    assert.equal(typeof sql, "string");
    const scopedSql = sql.replace(/\bfootball\.(competitions|clubs|players)\b/g, `${quoted}.$1`);
    assert(!/\bfootball\./.test(scopedSql), "Fixture repository SQL must never reach canonical Football tables");
    return db.query(scopedSql, values);
  }) as Queryable["query"] });
  const repository = new FootballLocalizationRepository(scope(runtime));
  const ids = new Map<LocalizationKind, string>();
  let created = false;
  const originalFingerprint = async () => Promise.all(LOCALIZATION_KINDS.map(async (kind) => {
    const result = await owner.query(`select md5(coalesce(string_agg(
      jsonb_build_array(id, slug, provider_name, name_ru, name_ru_review_status, localization_revision)::text, ',' order by id), '')) as fingerprint
      from football.${kind}`);
    return result.rows[0].fingerprint;
  }));
  const before = await originalFingerprint();
  const row = async (kind: LocalizationKind, id: string) => (await owner.query(`select to_jsonb(t) as value from ${quoted}.${kind} t where id=$1`, [id])).rows[0].value as Record<string, unknown>;
  const immutable = (value: Record<string, unknown>) => Object.fromEntries(Object.entries(value).filter(([key]) => !["name_ru", "name_ru_review_status", "localization_revision"].includes(key)));
  const sync = (kind: LocalizationKind, name: string) => {
    const db = scope(runtime);
    if (kind === "competitions") return upsertSerieACompetition(db, { providerName: name, country: "Italy", type: "League", providerLogoUrl: "https://fixture.invalid/league" });
    if (kind === "clubs") return upsertClub(db, { providerClubId: 987001, providerName: name, code: "FIX", country: "Italy", founded: 1900, national: false, providerLogoUrl: "https://fixture.invalid/club" });
    return upsertPlayer(db, { providerPlayerId: 987002, providerName: name, age: 25, providerPhotoUrl: "https://fixture.invalid/player" });
  };
  const profileSync = () => upsertPlayerProfile(scope(runtime), {
    providerPlayerId: 987002, providerName: "Profile changed", firstname: "First", lastname: "Last", age: 26,
    birthDate: "2000-01-01", birthPlace: "Rome", birthCountry: "Italy", nationality: "Italy", height: "180 cm", weight: "75 kg", injured: false, providerPhotoUrl: "https://fixture.invalid/profile",
  });
  try {
    await owner.query(`create schema ${quoted}`); created = true;
    const role = (await runtime.query<{ current_user: string }>("select current_user")).rows[0].current_user;
    assert.notEqual(role, migrationUrl.username, "Check must use the restricted runtime DB role");
    await owner.query(`grant usage on schema ${quoted} to ${quoteIdentifier(role)}`);
    for (const kind of LOCALIZATION_KINDS) {
      await owner.query(`create table ${quoted}.${kind} (like football.${kind} including all)`);
      await owner.query(`grant select, insert, update on ${quoted}.${kind} to ${quoteIdentifier(role)}`);
      const id = await sync(kind, `Fixture ${kind}`); ids.set(kind, id);
      const missing = await repository.get(kind, id); assert(missing);
      assert.equal(missing.nameRu, null); assert.equal(missing.nameRuReviewStatus, null);
      assert.equal(missing.localizationRevision, 0); assert.equal(missing.displayName, missing.providerName);
      const storedBefore = await row(kind, id);
      let value = await repository.edit(kind, id, { action: "save", nameRu: "  Черновое имя  ", expectedRevision: 0 });
      assert.equal(value.nameRu, "Черновое имя"); assert.equal(value.nameRuReviewStatus, "unreviewed");
      assert.equal(value.displayName, missing.providerName);
      await expectCode(repository.edit(kind, id, { action: "review", nameRu: "Другое имя", expectedRevision: 1, confirmed: true }), "LOCALIZATION_CONFLICT");
      value = await repository.edit(kind, id, { action: "review", nameRu: "Черновое имя", expectedRevision: 1, confirmed: true });
      assert.equal(value.nameRuReviewStatus, "reviewed"); assert.equal(value.displayName, "Черновое имя");
      assert.deepEqual(immutable(await row(kind, id)), immutable(storedBefore), "Manual edits changed provider fields, timestamps, identity or slug");
      value = await repository.edit(kind, id, { action: "save", nameRu: "Исправленное имя", expectedRevision: 2 });
      assert.equal(value.nameRuReviewStatus, "unreviewed"); assert.equal(value.displayName, missing.providerName);
      assert.equal(await sync(kind, "Provider changed draft"), id);
      if (kind === "players") assert.equal(await profileSync(), id);
      let fresh = await repository.get(kind, id); assert(fresh);
      assert.equal(fresh.nameRu, value.nameRu); assert.equal(fresh.localizationRevision, 3);
      assert.equal(fresh.nameRuReviewStatus, "unreviewed"); assert.equal(fresh.displayName, fresh.providerName);
      value = await repository.edit(kind, id, { action: "review", nameRu: value.nameRu!, expectedRevision: 3, confirmed: true });
      assert.equal(await sync(kind, "Provider changed reviewed"), id);
      if (kind === "players") assert.equal(await profileSync(), id);
      fresh = await repository.get(kind, id); assert(fresh);
      assert.equal(fresh.nameRu, value.nameRu); assert.equal(fresh.nameRuReviewStatus, "reviewed");
      assert.equal(fresh.displayName, value.nameRu); assert.equal(fresh.localizationRevision, 4);
      assert.equal(fresh.id, missing.id); assert.equal(fresh.slug, missing.slug);
      await assert.rejects(runtime.query(`update ${quoted}.${kind} set localization_revision=-1 where id=$1`, [id]), { code: "23514" });
      await assert.rejects(runtime.query(`update ${quoted}.${kind} set name_ru_review_status=null where id=$1`, [id]), { code: "23514" });
    }

    // Both runtime UPDATEs are genuinely in flight behind the same PostgreSQL row lock.
    const race = async (edits: [FootballLocalizationEdit, FootballLocalizationEdit]) => {
      const blocker = await owner.connect();
      const clients = await Promise.all([runtime.connect(), runtime.connect()]);
      const id = ids.get("clubs")!;
      let pending: Promise<PromiseSettledResult<unknown>[]> | undefined;
      try {
        await blocker.query("begin");
        await blocker.query(`select id from ${quoted}.clubs where id=$1 for update`, [id]);
        const pids = await Promise.all(clients.map(async (client) => (await client.query<{ pid: number }>("select pg_backend_pid() as pid")).rows[0].pid));
        pending = Promise.allSettled(clients.map((client, index) => new FootballLocalizationRepository(scope(client)).edit("clubs", id, edits[index])));
        let waiting = 0;
        const deadline = Date.now() + 5_000;
        while (waiting !== 2 && Date.now() < deadline) {
          waiting = (await owner.query<{ count: number }>("select count(*)::int as count from pg_stat_activity where pid=any($1::int[]) and wait_event_type='Lock'", [pids])).rows[0].count;
          if (waiting !== 2) await delay(20);
        }
        assert.equal(waiting, 2, "Both concurrent localization writers must wait on the fixture row");
        await blocker.query("commit");
        const results = await pending;
        assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
        const loser = results.find((result) => result.status === "rejected");
        assert(loser?.status === "rejected" && loser.reason instanceof FootballLocalizationError && loser.reason.code === "LOCALIZATION_CONFLICT");
      } finally {
        await blocker.query("rollback"); await pending;
        blocker.release(); clients.forEach((client) => client.release());
      }
    };
    await race([{ action: "save", nameRu: "Редактор один", expectedRevision: 4 }, { action: "save", nameRu: "Редактор два", expectedRevision: 4 }]);
    let club = (await repository.get("clubs", ids.get("clubs")!))!;
    assert.equal(club.localizationRevision, 5);
    await race([{ action: "save", nameRu: "Новая версия", expectedRevision: 5 }, { action: "review", nameRu: club.nameRu!, expectedRevision: 5, confirmed: true }]);
    club = (await repository.get("clubs", club.id))!; assert.equal(club.localizationRevision, 6);
    // ABA: returning to the same name/status cannot revive a stale editor's revision.
    await repository.edit("clubs", club.id, { action: "save", nameRu: "Временное имя", expectedRevision: 6 });
    const restored = await repository.edit("clubs", club.id, { action: "save", nameRu: club.nameRu!, expectedRevision: 7 });
    await expectCode(repository.edit("clubs", club.id, { action: "save", nameRu: "Устаревшее изменение", expectedRevision: 6 }), "LOCALIZATION_CONFLICT");
    assert.equal(restored.localizationRevision, 8);
    await expectCode(repository.edit("clubs", randomUUID(), { action: "save", nameRu: "Имя", expectedRevision: 0 }), "NOT_FOUND");

    // Search is literal, case insensitive and can find Russian drafts as well as originals.
    for (let i = 0; i < 24; i++) await upsertPlayer(scope(runtime), { providerPlayerId: 990000 + i, providerName: `Search ${String(i).padStart(2, "0")}`, age: null, providerPhotoUrl: null });
    const filter = { kind: "players" as const, query: "search", status: "missing" as const, page: 1 };
    const first = await repository.list(filter); const second = await repository.list({ ...filter, page: 2 });
    assert.equal(first.total, 24); assert.equal(first.items.length, 20); assert.equal(second.items.length, 4); assert.equal(first.totalPages, 2);
    assert.equal(new Set([...first.items, ...second.items].map((item) => item.id)).size, 24);
    assert.deepEqual(await repository.list(filter), first, "Pagination must have a stable order");
    const absentPage = await repository.list({ ...filter, page: 99 }); assert.equal(absentPage.total, 24); assert.equal(absentPage.items.length, 0);
    const special = await upsertPlayer(scope(runtime), { providerPlayerId: 999999, providerName: "Literal %_! text", age: null, providerPhotoUrl: null });
    await repository.edit("players", special, { action: "save", nameRu: "Особое название", expectedRevision: 0 });
    for (const query of ["%_!", "оСоБоЕ"]) {
      const found = await repository.list({ kind: "players", query, status: "unreviewed", page: 1 });
      assert.equal(found.total, 1); assert.equal(found.items[0].id, special);
    }
    for (const kind of LOCALIZATION_KINDS) {
      const found = await repository.list({ kind, query: "", status: "reviewed", page: 1 });
      assert.equal(found.items.every((item) => item.nameRuReviewStatus === "reviewed"), true);
    }
    assert.deepEqual(await originalFingerprint(), before, "Canonical Football names or identities were changed by the fixture check");
  } finally {
    if (created) await owner.query(`drop schema ${quoted} cascade`);
    await runtime.end(); await owner.end();
  }
  console.log("football_localization_check=passed");
  console.log("runtime_role_cas_save_review_races_aba_provider_preservation_search_pagination=true");
  console.log("canonical_names_unchanged=true provider_requests=0 fixture_cleanup=complete");
}

main().catch((error: unknown) => {
  console.error("football_localization_check=failed", error instanceof assert.AssertionError ? error.message :
    { name: error instanceof Error ? error.name : "UnknownError", code: (error as { code?: string })?.code });
  process.exitCode = 1;
});
