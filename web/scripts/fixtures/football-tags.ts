import type { Pool } from "pg";
import { FOOTBALL_TAG_SOURCES } from "../../src/football/tagged-upsert";
// LIKE does not copy FKs. All targets must be fixture-local, including Tags.
export async function createFixtureFootballTags(db: Pick<Pool, "query">, quotedSchema: string, quotedRole: string) {
  await db.query(`create table ${quotedSchema}.football_tags (like taxonomy.football_tags including all)`);
  for (const [table, column] of Object.entries(FOOTBALL_TAG_SOURCES)) {
    await db.query(`alter table ${quotedSchema}.football_tags add foreign key(${column}) references ${quotedSchema}.${table}(id) on delete restrict`);
  }
  await db.query(`grant SELECT,INSERT on ${quotedSchema}.football_tags to ${quotedRole}`);
}
