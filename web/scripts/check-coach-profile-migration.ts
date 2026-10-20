import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { config } from "dotenv";
import pg from "pg";

config({ path: ".env.local", quiet: true }); config({ path: ".env", quiet: true });
async function main() {
  const target = new URL(process.env.MIGRATION_DATABASE_URL ?? "");
  assert(["127.0.0.1", "localhost"].includes(target.hostname) &&
    (target.port === "15432" && target.pathname === "/tuttoseriea_local" ||
     process.env.CI === "true" && target.port === "5432" && target.pathname === "/tuttoseriea_ci"), "Only LOCAL/exact CI allowed");
  const client = new pg.Client({ connectionString: target.href }); await client.connect();
  const schema = `coach_migration_${randomUUID().replaceAll("-", "")}`, quoted = `"${schema}"`;
  try {
    await client.query("begin");
    await client.query(`create schema ${quoted}; create table ${quoted}.matches(id text primary key);
      create table ${quoted}.match_lineups(id text primary key,provider_coach_id integer)`);
    const scoped = (sql: string) => sql.replaceAll('"football".', `${quoted}.`);
    await client.query(scoped(readFileSync("drizzle/0021_mature_whistler.sql", "utf8")));
    const match = randomUUID(), coach = randomUUID(), lineup = randomUUID();
    await client.query(`insert into ${quoted}.matches values($1)`, [match]);
    await client.query(`insert into ${quoted}.coaches(id,provider,provider_coach_id,provider_name,provider_photo_url,
      name_source_match_id,photo_source_match_id,name_ru,name_ru_review_status,localization_revision)
      values($1,'api-football',2914,'Legacy snapshot name','https://fixture.invalid/old',$2,$2,'Reviewed fixture','reviewed',9)`, [coach, match]);
    await client.query(`insert into ${quoted}.match_lineups values($1,2914,$2)`, [lineup, coach]);
    const before = (await client.query(`select to_jsonb(c) as value from ${quoted}.coaches c`)).rows[0].value;
    await client.query(scoped(readFileSync("drizzle/0022_coach_profile_source.sql", "utf8")));
    const after = (await client.query(`select to_jsonb(c) as value from ${quoted}.coaches c`)).rows[0].value;
    assert.deepEqual(Object.fromEntries(Object.keys(before).map(key => [key, after[key]])), before);
    assert.equal(after.profile_observed_at, null); assert.equal(after.provider_raw, null);
    assert.equal((await client.query(`select coach_id from ${quoted}.match_lineups where id=$1`, [lineup])).rows[0].coach_id, coach);
    await client.query(`insert into ${quoted}.coaches(id,provider,provider_coach_id) values($1,'api-football',25878)`, [randomUUID()]);
    await client.query(`update ${quoted}.coaches set provider_photo_url='https://fixture.invalid/api',provider_name='API profile',
      provider_raw='{}',profile_observed_at=now() where provider_coach_id=25878`);
    for (const change of ["age=-1", "provider_name=' '", "localization_revision=-1", "name_ru_review_status=null", "provider_raw='[]',profile_observed_at=now()"] ) {
      await client.query("savepoint invalid_fixture");
      await assert.rejects(client.query(`update ${quoted}.coaches set ${change} where id=$1`, [coach]), { code: "23514" });
      await client.query("rollback to savepoint invalid_fixture");
    }
    assert.equal((await client.query(`select count(*)::int as n from ${quoted}.coaches`)).rows[0].n, 2);
    console.log("coach_profile_migration_old_values_uuid_localization_revision_fks_preserved=true id_only_identity=true");
  } finally { await client.query("rollback"); await client.end(); }
  console.log("coach_profile_migration_check=passed canonical_data_writes=0 fixture_cleanup=rollback");
}
main().catch((error: unknown) => {
  console.error("coach_profile_migration_check=failed", error instanceof assert.AssertionError ? error.message : (error as { code?: string }).code);
  process.exitCode = 1;
});
