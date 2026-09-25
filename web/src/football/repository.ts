import { randomUUID } from "node:crypto";

import type { Pool, PoolClient, QueryResult } from "pg";

import {
  API_FOOTBALL_PROVIDER,
  SERIE_A_CURRENT_SEASON,
  SERIE_A_CURRENT_SEASON_LABEL,
  SERIE_A_NAME_RU,
  SERIE_A_PROVIDER_LEAGUE_ID,
  SERIE_A_SLUG,
} from "./foundation";

type Queryable = Pick<Pool | PoolClient, "query">;

type IdRow = {
  id: string;
};

type ClubListRow = {
  id: string;
  slug: string;
  display_name: string;
  provider_name: string;
  name_ru: string | null;
  code: string | null;
  country: string | null;
  provider_logo_url: string | null;
};

export type UpsertCompetitionInput = {
  providerName: string;
  country: string | null;
  type: string | null;
  providerLogoUrl: string | null;
};

export type UpsertSeasonInput = {
  startsOn: string | null;
  endsOn: string | null;
  providerCurrent: boolean;
};

export type UpsertClubInput = {
  providerClubId: number;
  providerName: string;
  code: string | null;
  country: string | null;
  founded: number | null;
  national: boolean | null;
  providerLogoUrl: string | null;
};

export type CurrentSerieAClub = {
  id: string;
  slug: string;
  displayName: string;
  providerName: string;
  nameRu: string | null;
  code: string | null;
  country: string | null;
  providerLogoUrl: string | null;
};

function firstId(result: QueryResult<IdRow>, label: string): string {
  const id = result.rows[0]?.id;

  if (!id) {
    throw new Error(`${label} did not return an id`);
  }

  return id;
}

export function createClubSlug(providerName: string, providerClubId: number): string {
  const base = providerName
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/gu, "")
    .toLowerCase()
    .replace(/&/gu, " and ")
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .replace(/-{2,}/gu, "-");

  return `${base || "club"}-${providerClubId}`;
}

export async function upsertSerieACompetition(
  queryable: Queryable,
  input: UpsertCompetitionInput,
): Promise<string> {
  return firstId(
    await queryable.query<IdRow>(
      `
        insert into football.competitions (
          id,
          provider,
          provider_competition_id,
          provider_name,
          country,
          type,
          provider_logo_url,
          slug,
          name_ru
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        on conflict (provider, provider_competition_id)
        do update set
          provider_name = excluded.provider_name,
          country = excluded.country,
          type = excluded.type,
          provider_logo_url = excluded.provider_logo_url,
          updated_at = now()
        returning id
      `,
      [
        randomUUID(),
        API_FOOTBALL_PROVIDER,
        SERIE_A_PROVIDER_LEAGUE_ID,
        input.providerName,
        input.country,
        input.type,
        input.providerLogoUrl,
        SERIE_A_SLUG,
        SERIE_A_NAME_RU,
      ],
    ),
    "competition upsert",
  );
}

export async function upsertSerieASeason(
  queryable: Queryable,
  competitionId: string,
  input: UpsertSeasonInput,
): Promise<string> {
  return firstId(
    await queryable.query<IdRow>(
      `
        insert into football.seasons (
          id,
          competition_id,
          provider,
          provider_season_year,
          starts_on,
          ends_on,
          provider_current,
          display_label
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8)
        on conflict (competition_id, provider, provider_season_year)
        do update set
          starts_on = excluded.starts_on,
          ends_on = excluded.ends_on,
          provider_current = excluded.provider_current,
          display_label = excluded.display_label,
          updated_at = now()
        returning id
      `,
      [
        randomUUID(),
        competitionId,
        API_FOOTBALL_PROVIDER,
        SERIE_A_CURRENT_SEASON,
        input.startsOn,
        input.endsOn,
        input.providerCurrent,
        SERIE_A_CURRENT_SEASON_LABEL,
      ],
    ),
    "season upsert",
  );
}

export async function upsertClub(
  queryable: Queryable,
  input: UpsertClubInput,
): Promise<string> {
  return firstId(
    await queryable.query<IdRow>(
      `
        insert into football.clubs (
          id,
          provider,
          provider_club_id,
          provider_name,
          code,
          country,
          founded,
          national,
          provider_logo_url,
          slug
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        on conflict (provider, provider_club_id)
        do update set
          provider_name = excluded.provider_name,
          code = excluded.code,
          country = excluded.country,
          founded = excluded.founded,
          national = excluded.national,
          provider_logo_url = excluded.provider_logo_url,
          updated_at = now()
        returning id
      `,
      [
        randomUUID(),
        API_FOOTBALL_PROVIDER,
        input.providerClubId,
        input.providerName,
        input.code,
        input.country,
        input.founded,
        input.national,
        input.providerLogoUrl,
        createClubSlug(input.providerName, input.providerClubId),
      ],
    ),
    "club upsert",
  );
}

export async function upsertSeasonClub(
  queryable: Queryable,
  seasonId: string,
  clubId: string,
): Promise<void> {
  await queryable.query(
    `
      insert into football.season_clubs (season_id, club_id)
      values ($1, $2)
      on conflict (season_id, club_id)
      do update set updated_at = now()
    `,
    [seasonId, clubId],
  );
}

export async function listCurrentSerieAClubs(
  queryable: Queryable,
): Promise<CurrentSerieAClub[]> {
  const result = await queryable.query<ClubListRow>(
    `
      select
        c.id,
        c.slug,
        coalesce(c.name_ru, c.provider_name) as display_name,
        c.provider_name,
        c.name_ru,
        c.code,
        c.country,
        c.provider_logo_url
      from football.competitions comp
      join football.seasons s on s.competition_id = comp.id
      join football.season_clubs sc on sc.season_id = s.id
      join football.clubs c on c.id = sc.club_id
      where comp.provider = $1
        and comp.provider_competition_id = $2
        and s.provider = $1
        and s.provider_season_year = $3
      order by coalesce(c.name_ru, c.provider_name), c.provider_club_id
    `,
    [API_FOOTBALL_PROVIDER, SERIE_A_PROVIDER_LEAGUE_ID, SERIE_A_CURRENT_SEASON],
  );

  return result.rows.map((row) => ({
    id: row.id,
    slug: row.slug,
    displayName: row.display_name,
    providerName: row.provider_name,
    nameRu: row.name_ru,
    code: row.code,
    country: row.country,
    providerLogoUrl: row.provider_logo_url,
  }));
}
