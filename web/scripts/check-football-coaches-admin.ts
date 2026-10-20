import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type pg from "pg";
import { readFootballCoaches } from "../src/admin/football-coaches-repository";
import { upsertCoachProfile } from "../src/football/coach-profile-repository";
import { parseCoachProfile } from "../src/football/coach-profile";
import { coachProfileFixture } from "../tests/fixtures/coach-profile";
import { parseFootballCoachesQuery } from "../src/admin/football-coaches";

type Queryable = Pick<pg.Pool | pg.PoolClient, "query">;
export async function checkCoachAdminReads({ owner, runtime, scope, quoted, coachId, matchId, homeClub, awayClub }: {
  owner: pg.Pool; runtime: pg.Pool; scope: (db: Queryable) => Queryable; quoted: string;
  coachId: string; matchId: string; homeClub: string; awayClub: string;
}) {
  const db = scope(runtime);
  const coach = (await owner.query(`select * from ${quoted}.coaches where id=$1`, [coachId])).rows[0];
  const observation = async (match: string, club = homeClub, id: string | null = coachId, provider = coach.provider_coach_id) => {
    await owner.query(`insert into ${quoted}.match_lineups(id,match_id,club_id,coach_id,provider_coach_id,provider_coach_name,provider_raw)
      values($1,$2,$3,$4,$5,'Snapshot name','{"fixture":true}')`, [randomUUID(), match, club, id, provider]);
  };
  let fixtureMatch = 990100;
  const match = async (date: string | null, status = "finished") => {
    const id = randomUUID();
    await owner.query(`insert into ${quoted}.matches select (jsonb_populate_record(null::${quoted}.matches,to_jsonb(m)||
      jsonb_build_object('id',$2::text,'slug',$2::text,'provider_fixture_id',$3::int,'kickoff_at',$4::timestamptz,'status',$5::text))).*
      from ${quoted}.matches m where id=$1`, [matchId, id, fixtureMatch++, date, status]);
    return id;
  };
  const read = () => readFootballCoaches(db, parseFootballCoachesQuery({ id: coachId }));
  await observation(matchId);
  const snapshotBefore = (await owner.query(`select to_jsonb(l) as value from ${quoted}.match_lineups l`)).rows;
  let model = await read();
  assert.equal(model.detail?.providerCoachId, coach.provider_coach_id);
  assert.equal(model.detail?.entity.slug, null);
  assert.equal(model.detail?.profile?.career.length, 3);
  assert.equal(model.detail?.profile?.firstname, "Fixture");
  assert.equal(model.detail?.providerPhotoUrl, "https://fixture.invalid/coach");
  assert.equal(model.detail?.observations[0].lastKnown.kind, "known");
  assert.equal(model.detail?.observations[0].sources[0].matchId, matchId);
  assert.deepEqual((await owner.query(`select to_jsonb(l) as value from ${quoted}.match_lineups l`)).rows, snapshotBefore);
  // ID-only/FK-null reads resolve by identity without writing links. Pre-match evidence is
  // visible, but does not replace the finished-only Team projection.
  const upcoming = await match("2026-10-21T12:00:00Z", "scheduled"); await observation(upcoming, homeClub, null);
  model = await read();
  const club = model.detail!.observations[0]; assert.equal(club.snapshots, 2);
  assert.equal(club.sources[0].matchId, upcoming);
  assert(club.lastKnown.kind === "known"); assert.equal(club.lastKnown.candidate.sources[0].matchId, matchId);
  assert.equal((await owner.query(`select coach_id from ${quoted}.match_lineups where match_id=$1`, [upcoming])).rows[0].coach_id, null);
  // Latest finished unresolved identity blocks fallback; null identity then restores it.
  const unresolved = await match("2026-10-02T12:00:00Z"); await observation(unresolved, homeClub, null, 999999);
  assert.equal((await read()).detail?.observations[0].lastKnown.kind, "unresolved");
  await owner.query(`update ${quoted}.match_lineups set provider_coach_id=null where match_id=$1`, [unresolved]);
  assert.equal((await read()).detail?.observations[0].lastKnown.kind, "known");
  const tied = await match("2026-10-01T12:00:00Z"); await observation(tied, homeClub, null, 999998);
  assert.equal((await read()).detail?.observations[0].lastKnown.kind, "ambiguous");
  // All tied source Matches are retained, not silently broken by observed_at/UUID.
  await observation(tied, awayClub, null);
  const tiedAgain = await match("2026-10-01T12:00:00Z"); await observation(tiedAgain, awayClub, null);
  model = await read(); assert.equal(model.detail?.observations.find(c => c.clubId === awayClub)?.sources.length, 2);
  // Unassociated/orphaned profiles remain readable; matching names never merge identities.
  const orphan = randomUUID();
  await owner.query(`insert into ${quoted}.coaches(id,provider,provider_coach_id,provider_name,name_source_match_id) values($1,'api-football',980000,'Provider changed reviewed',$2)`, [orphan, matchId]);
  const missingProfile = (await readFootballCoaches(db, parseFootballCoachesQuery({ id: orphan }))).detail;
  assert.equal(missingProfile?.observations.length, 0); assert.equal(missingProfile?.profile, null);
  assert.equal(missingProfile?.entity.providerName, null); assert.equal(missingProfile?.providerPhotoUrl, null);
  await upsertCoachProfile(db, parseCoachProfile(coachProfileFixture(980000,"Provider changed reviewed"),980000), new Date("2026-10-20T13:00:00Z"));
  assert.equal((await readFootballCoaches(db, parseFootballCoachesQuery({ id: randomUUID() }))).detail, null);
  for (let i = 0; i < 23; i++) await upsertCoachProfile(db,
    parseCoachProfile(coachProfileFixture(980001 + i, `Coach search ${String(i).padStart(2, "0")}`),980001+i),new Date("2026-10-20T13:00:00Z"));
  const first = await readFootballCoaches(db, parseFootballCoachesQuery({ query: "COACH SEARCH" }));
  const second = await readFootballCoaches(db, parseFootballCoachesQuery({ query: "coach search", page: "2" }));
  assert.equal(first.page.total, 23); assert.equal(first.page.items.length, 20); assert.equal(second.page.items.length, 3);
  assert.equal(new Set([...first.page.items, ...second.page.items].map(c => c.id)).size, 23);
  const empty = await readFootballCoaches(db, parseFootballCoachesQuery({ query: "coach search", page: "99" }));
  assert.equal(empty.page.total, 23); assert.equal(empty.page.items.length, 0);
  const names = await readFootballCoaches(db, parseFootballCoachesQuery({ query: "provider changed reviewed" }));
  assert.equal(names.page.total, 2); // Same name, distinct provider identities.
  const russian = await readFootballCoaches(db, parseFootballCoachesQuery({ query: coach.name_ru }));
  assert(russian.page.items.some(c => c.id === coachId));
  console.log("coach_admin_search_pagination_photos_identity_snapshots_fallback_unresolved_ties_orphans=passed");
}
