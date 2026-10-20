import "server-only";
import type { Pool, PoolClient } from "pg";

import { resolveFootballProperName } from "./localization";
import { coachIdentityLabel } from "./coaches";
import {
  FootballLocalizationError, LOCALIZATION_PAGE_SIZE, localizationId, localizationKind, parseLocalizationEdit,
  type FootballLocalizationEdit, type FootballLocalizationEntity, type FootballLocalizationPage, type FootballLocalizationQuery,
} from "./localization-management";

type Queryable = Pick<Pool | PoolClient, "query">;
type Row = {
  id: string; slug: string | null; provider: string; provider_name: string | null; provider_coach_id?: number;
  name_ru: string | null; name_ru_review_status: FootballLocalizationEntity["nameRuReviewStatus"];
  localization_revision: number;
};
const columns = (kind: FootballLocalizationEntity["kind"]) =>
  `id, ${kind === "coaches" ? "null::text as slug" : "slug"}, provider,
    ${kind === "coaches" ? "case when profile_observed_at is not null then provider_name else null end as provider_name, provider_coach_id" : "provider_name"},
    name_ru, name_ru_review_status, localization_revision`;
function entity(kind: FootballLocalizationEntity["kind"], row: Row): FootballLocalizationEntity {
  const base = { id: row.id, provider: row.provider,
    nameRu: row.name_ru, nameRuReviewStatus: row.name_ru_review_status, localizationRevision: row.localization_revision,
    displayName: resolveFootballProperName({ providerName: row.provider_name ?? coachIdentityLabel(row.provider_coach_id!), nameRu: row.name_ru, reviewStatus: row.name_ru_review_status }) };
  return kind === "coaches" ? { ...base, kind, slug: null, providerName: row.provider_name }
    : { ...base, kind, slug: row.slug!, providerName: row.provider_name! };
}

export class FootballLocalizationRepository {
  constructor(private readonly db: Queryable) {}

  async list(filter: FootballLocalizationQuery): Promise<FootballLocalizationPage> {
    const table = localizationKind(filter.kind);
    const pattern = filter.query ? `%${filter.query.replaceAll("!", "!!").replaceAll("%", "!%").replaceAll("_", "!_")}%` : null;
    // One statement gives count and page the same snapshot, including empty/out-of-range pages.
    const result = await this.db.query<{ total: number; items: Row[] }>(`
      with filtered as materialized (
        select ${columns(table)} from football.${table}
        where ($1::text is null or ${table === "coaches" ? "(profile_observed_at is not null and provider_name ilike $1 escape '!') or provider_coach_id::text ilike $1 escape '!'" : "provider_name ilike $1 escape '!'"} or name_ru ilike $1 escape '!')
          and ($2 = 'all' or ($2 = 'missing' and name_ru is null) or name_ru_review_status = $2)
      ), page as (
        select * from filtered order by lower(provider_name), id limit $3 offset $4
      )
      select (select count(*)::int from filtered) as total,
        coalesce((select jsonb_agg(p order by lower(p.provider_name), p.id) from page p), '[]'::jsonb) as items
    `, [pattern, filter.status, LOCALIZATION_PAGE_SIZE, (filter.page - 1) * LOCALIZATION_PAGE_SIZE]);
    const row = result.rows[0];
    return { items: row.items.map((item) => entity(table, item)), total: row.total,
      page: filter.page, pageSize: LOCALIZATION_PAGE_SIZE, totalPages: Math.ceil(row.total / LOCALIZATION_PAGE_SIZE) };
  }

  async get(kind: FootballLocalizationEntity["kind"], id: string): Promise<FootballLocalizationEntity | null> {
    const table = localizationKind(kind);
    const result = await this.db.query<Row>(`select ${columns(table)} from football.${table} where id = $1`, [localizationId(id)]);
    return result.rows[0] ? entity(table, result.rows[0]) : null;
  }

  async edit(kind: FootballLocalizationEntity["kind"], id: string, edit: FootballLocalizationEdit): Promise<FootballLocalizationEntity> {
    const table = localizationKind(kind);
    edit = parseLocalizationEdit(edit);
    const result = await this.db.query<Row>(`
      update football.${table}
      set name_ru = $2, name_ru_review_status = $3, localization_revision = localization_revision + 1
      where id = $1 and localization_revision = $4
        ${edit.action === "review" ? "and name_ru = $2 and name_ru_review_status = 'unreviewed'" : ""}
      returning ${columns(table)}
    `, [localizationId(id), edit.nameRu, edit.action === "review" ? "reviewed" : "unreviewed", edit.expectedRevision]);
    if (result.rows[0]) return entity(table, result.rows[0]);
    // Classification only: the conditional UPDATE above is the concurrency protection.
    if (!await this.get(table, id)) throw new FootballLocalizationError("NOT_FOUND", 404, "Football entity not found");
    throw new FootballLocalizationError("LOCALIZATION_CONFLICT", 409, "Localization changed; reload before editing or reviewing");
  }
}
