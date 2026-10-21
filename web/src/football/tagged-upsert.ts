export const FOOTBALL_TAG_SOURCES = {
  clubs: "club_id", players: "player_id", coaches: "coach_id", competitions: "competition_id",
} as const;
export type FootballTagKind = keyof typeof FOOTBALL_TAG_SOURCES;

// Trusted repository SQL only. The source and tag commit/rollback together even when
// called with Pool.query(). RETURNING and freshness/created semantics belong to the source.
export function taggedFootballUpsert(kind: FootballTagKind, sourceSql: string): string {
  if (!Object.hasOwn(FOOTBALL_TAG_SOURCES, kind)) throw new Error("Unknown Football Tag source");
  return `with saved_football_source as (${sourceSql}), created_football_tag as (
    insert into taxonomy.football_tags (id,${FOOTBALL_TAG_SOURCES[kind]})
    select gen_random_uuid()::text,id from saved_football_source
    on conflict (${FOOTBALL_TAG_SOURCES[kind]}) do nothing
  ) select * from saved_football_source`;
}
