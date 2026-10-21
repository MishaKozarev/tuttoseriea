import type { Pool, PoolClient } from "pg";
import { coachCard, usableCoachPhoto } from "../football/coaches";
import { resolveFootballProperName } from "../football/localization";
import { FOOTBALL_TAG_SOURCES, type FootballTagKind } from "../football/tagged-upsert";
import type { FootballTag, TagPage, TagQuery } from "./football-tags";
type Queryable = Pick<Pool | PoolClient, "query">;
type Row = { id: string; kind: FootballTagKind; source_id: string; provider: string; provider_id: number;
  provider_name: string | null; image_url: string | null; name_ru: string | null; name_ru_review_status: string | null;
  profile_observed_at: string | null };
const providerIds = { clubs: "provider_club_id", players: "provider_player_id", coaches: "provider_coach_id", competitions: "provider_competition_id" };
const projection = Object.entries(FOOTBALL_TAG_SOURCES).map(([key, column]) => {
  const kind = key as FootballTagKind;
  const image = ["clubs", "competitions"].includes(kind) ? "provider_logo_url" : "provider_photo_url";
  return `select t.id,'${kind}'::text as kind,s.id as source_id,s.provider,s.${providerIds[kind]} as provider_id,
    ${kind === "coaches" ? "case when s.profile_observed_at is not null then s.provider_name end" : "s.provider_name"} as provider_name,
    ${kind === "coaches" ? "case when s.profile_observed_at is not null then s.provider_photo_url end" : `s.${image}`} as image_url,
    s.name_ru,s.name_ru_review_status,${kind === "coaches" ? "s.profile_observed_at" : "null::timestamptz"} as profile_observed_at
    from taxonomy.football_tags t join football.${kind} s on s.id=t.${column}`;
}).join(" union all ");
function project(row: Row): FootballTag {
  const card = row.kind === "coaches" ? coachCard({ id: row.source_id, provider_coach_id: row.provider_id,
    provider_name: row.provider_name, provider_photo_url: row.image_url, name_ru: row.name_ru,
    name_ru_review_status: row.name_ru_review_status, profile_observed_at: row.profile_observed_at }) : null;
  return { id: row.id, kind: row.kind, sourceEntityId: row.source_id, provider: row.provider, providerId: row.provider_id,
    providerName: row.provider_name, displayName: card?.displayName ?? resolveFootballProperName({
      providerName: row.provider_name?.trim() || `${row.kind} #${row.provider_id}`, nameRu: row.name_ru, reviewStatus: row.name_ru_review_status }),
    imageUrl: card ? card.providerPhotoUrl : usableCoachPhoto(row.image_url),
    profileAvailable: row.kind !== "coaches" || row.profile_observed_at !== null };
}
export async function listFootballTags(db: Queryable, filter: TagQuery): Promise<TagPage> {
  const pattern = `%${filter.query.replaceAll("!", "!!").replaceAll("%", "!%").replaceAll("_", "!_")}%`;
  const result = (await db.query<{ total: number; items: Row[] }>(`with sources as (${projection}), filtered as materialized (
    select * from sources where ($1='all' or kind=$1) and (provider_name ilike $2 escape '!' or name_ru ilike $2 escape '!'
      or provider_id::text ilike $2 escape '!' or id=$3 or source_id=$3)
  ), page as (select * from filtered order by lower(coalesce(provider_name,'')),kind,id limit 20 offset $4)
  select (select count(*)::int from filtered) as total,
    coalesce((select jsonb_agg(p order by lower(coalesce(p.provider_name,'')),p.kind,p.id) from page p),'[]'::jsonb) as items`,
  [filter.kind, pattern, filter.query, (filter.page - 1) * 20])).rows[0];
  return { items: result.items.map(project), total: result.total, page: filter.page, totalPages: Math.ceil(result.total / 20) };
}
// Domain batch read for future content consumers; no request-time provider call or write.
export async function getFootballTagsByIds(db: Queryable, ids: readonly string[]): Promise<FootballTag[]> {
  if (!ids.length) return [];
  return (await db.query<Row>(`with sources as (${projection}) select * from sources where id=any($1::text[]) order by id`, [[...new Set(ids)]])).rows.map(project);
}
