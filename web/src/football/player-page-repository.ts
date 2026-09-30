import type { Pool, PoolClient } from "pg";

import {
  API_FOOTBALL_PROVIDER,
  SERIE_A_CURRENT_SEASON,
  SERIE_A_PROVIDER_LEAGUE_ID,
} from "./foundation";
import { resolveFootballProperName } from "./localization";

type Queryable = Pick<Pool | PoolClient, "query">;

type PlayerScopeRow = {
  id: string;
  slug: string;
  provider_name: string;
  name_ru: string | null;
  name_ru_review_status: string | null;
  firstname: string | null;
  lastname: string | null;
  age: number | null;
  birth_date: string | null;
  birth_place: string | null;
  birth_country: string | null;
  nationality: string | null;
  height: string | null;
  weight: string | null;
  injured: boolean | null;
  provider_photo_url: string | null;
  season_id: string;
  season_display_label: string;
  competition_provider_name: string;
  competition_name_ru: string | null;
  competition_name_ru_review_status: string | null;
};

type MembershipRow = {
  membership_id: string;
  shirt_number: number | null;
  position: string;
  club_id: string;
  club_slug: string;
  club_provider_name: string;
  club_name_ru: string | null;
  club_name_ru_review_status: string | null;
  club_logo_url: string | null;
};

type StatisticsRow = {
  statistics_id: string;
  club_id: string;
  club_slug: string;
  club_provider_name: string;
  club_name_ru: string | null;
  club_name_ru_review_status: string | null;
  club_logo_url: string | null;
  appearances: number | null;
  lineups: number | null;
  minutes: number | null;
  rating: string | null;
  shots_total: number | null;
  shots_on: number | null;
  goals_total: number | null;
  goals_assists: number | null;
  passes_total: number | null;
  passes_key: number | null;
  passes_accuracy: number | null;
  tackles_total: number | null;
  tackles_blocks: number | null;
  tackles_interceptions: number | null;
  cards_yellow: number | null;
  cards_yellow_red: number | null;
  cards_red: number | null;
};

type SlugRow = {
  slug: string;
};

export type PlayerPageClub = {
  id: string;
  slug: string;
  displayName: string;
  providerLogoUrl: string | null;
};

export type PlayerPageMembership = {
  id: string;
  shirtNumber: number | null;
  position: string;
  club: PlayerPageClub;
};

export type PlayerPageStatistics = {
  id: string;
  club: PlayerPageClub;
  appearances: number | null;
  lineups: number | null;
  minutes: number | null;
  rating: string | null;
  shotsTotal: number | null;
  shotsOn: number | null;
  goalsTotal: number | null;
  goalsAssists: number | null;
  passesTotal: number | null;
  passesKey: number | null;
  passesAccuracy: number | null;
  tacklesTotal: number | null;
  tacklesBlocks: number | null;
  tacklesInterceptions: number | null;
  cardsYellow: number | null;
  cardsYellowRed: number | null;
  cardsRed: number | null;
};

export type CurrentSerieAPlayerPageData = {
  player: {
    id: string;
    slug: string;
    displayName: string;
    providerName: string;
    firstname: string | null;
    lastname: string | null;
    age: number | null;
    birthDate: string | null;
    birthPlace: string | null;
    birthCountry: string | null;
    nationality: string | null;
    height: string | null;
    weight: string | null;
    injured: boolean | null;
    providerPhotoUrl: string | null;
  };
  competition: {
    displayName: string;
  };
  season: {
    id: string;
    displayLabel: string;
  };
  memberships: PlayerPageMembership[];
  statistics: PlayerPageStatistics[];
};

function mapClub(row: MembershipRow | StatisticsRow): PlayerPageClub {
  return {
    id: row.club_id,
    slug: row.club_slug,
    displayName: resolveFootballProperName({
      providerName: row.club_provider_name,
      nameRu: row.club_name_ru,
      reviewStatus: row.club_name_ru_review_status,
    }),
    providerLogoUrl: row.club_logo_url,
  };
}

export async function getCurrentSerieAPlayerPageData(
  queryable: Queryable,
  slug: string,
): Promise<CurrentSerieAPlayerPageData | null> {
  const scopeResult = await queryable.query<PlayerScopeRow>(
    `
      select
        p.id,
        p.slug,
        p.provider_name,
        p.name_ru,
        p.name_ru_review_status,
        p.firstname,
        p.lastname,
        p.age,
        p.birth_date,
        p.birth_place,
        p.birth_country,
        p.nationality,
        p.height,
        p.weight,
        p.injured,
        p.provider_photo_url,
        s.id as season_id,
        s.display_label as season_display_label,
        comp.provider_name as competition_provider_name,
        comp.name_ru as competition_name_ru,
        comp.name_ru_review_status as competition_name_ru_review_status
      from football.players p
      join football.competitions comp
        on comp.provider = $1
        and comp.provider_competition_id = $2
      join football.seasons s
        on s.competition_id = comp.id
        and s.provider = $1
        and s.provider_season_year = $3
      where p.provider = $1
        and p.slug = $4
        and (
          exists (
            select 1
            from football.squad_memberships eligible_sm
            join football.season_clubs eligible_sc
              on eligible_sc.club_id = eligible_sm.club_id
              and eligible_sc.season_id = s.id
            where eligible_sm.player_id = p.id
          )
          or exists (
            select 1
            from football.player_statistics eligible_ps
            where eligible_ps.player_id = p.id
              and eligible_ps.season_id = s.id
          )
        )
      limit 1
    `,
    [API_FOOTBALL_PROVIDER, SERIE_A_PROVIDER_LEAGUE_ID, SERIE_A_CURRENT_SEASON, slug],
  );
  const scope = scopeResult.rows[0];

  if (!scope) {
    return null;
  }

  const membershipResult = await queryable.query<MembershipRow>(
    `
      select
        sm.id as membership_id,
        sm.shirt_number,
        sm.position,
        c.id as club_id,
        c.slug as club_slug,
        c.provider_name as club_provider_name,
        c.name_ru as club_name_ru,
        c.name_ru_review_status as club_name_ru_review_status,
        c.provider_logo_url as club_logo_url
      from football.squad_memberships sm
      join football.season_clubs sc
        on sc.club_id = sm.club_id
        and sc.season_id = $1
      join football.clubs c on c.id = sm.club_id
      where sm.player_id = $2
        and c.provider = $3
      order by c.provider_name, c.provider_club_id
    `,
    [scope.season_id, scope.id, API_FOOTBALL_PROVIDER],
  );
  const statisticsResult = await queryable.query<StatisticsRow>(
    `
      select
        ps.id as statistics_id,
        c.id as club_id,
        c.slug as club_slug,
        c.provider_name as club_provider_name,
        c.name_ru as club_name_ru,
        c.name_ru_review_status as club_name_ru_review_status,
        c.provider_logo_url as club_logo_url,
        ps.appearances,
        ps.lineups,
        ps.minutes,
        ps.rating,
        ps.shots_total,
        ps.shots_on,
        ps.goals_total,
        ps.goals_assists,
        ps.passes_total,
        ps.passes_key,
        ps.passes_accuracy,
        ps.tackles_total,
        ps.tackles_blocks,
        ps.tackles_interceptions,
        ps.cards_yellow,
        ps.cards_yellow_red,
        ps.cards_red
      from football.player_statistics ps
      join football.clubs c on c.id = ps.club_id
      where ps.season_id = $1
        and ps.player_id = $2
        and c.provider = $3
      order by c.provider_name, c.provider_club_id
    `,
    [scope.season_id, scope.id, API_FOOTBALL_PROVIDER],
  );

  return {
    player: {
      id: scope.id,
      slug: scope.slug,
      displayName: resolveFootballProperName({
        providerName: scope.provider_name,
        nameRu: scope.name_ru,
        reviewStatus: scope.name_ru_review_status,
      }),
      providerName: scope.provider_name,
      firstname: scope.firstname,
      lastname: scope.lastname,
      age: scope.age,
      birthDate: scope.birth_date,
      birthPlace: scope.birth_place,
      birthCountry: scope.birth_country,
      nationality: scope.nationality,
      height: scope.height,
      weight: scope.weight,
      injured: scope.injured,
      providerPhotoUrl: scope.provider_photo_url,
    },
    competition: {
      displayName: resolveFootballProperName({
        providerName: scope.competition_provider_name,
        nameRu: scope.competition_name_ru,
        reviewStatus: scope.competition_name_ru_review_status,
      }),
    },
    season: {
      id: scope.season_id,
      displayLabel: scope.season_display_label,
    },
    memberships: membershipResult.rows.map((row) => ({
      id: row.membership_id,
      shirtNumber: row.shirt_number,
      position: row.position,
      club: mapClub(row),
    })),
    statistics: statisticsResult.rows.map((row) => ({
      id: row.statistics_id,
      club: mapClub(row),
      appearances: row.appearances,
      lineups: row.lineups,
      minutes: row.minutes,
      rating: row.rating,
      shotsTotal: row.shots_total,
      shotsOn: row.shots_on,
      goalsTotal: row.goals_total,
      goalsAssists: row.goals_assists,
      passesTotal: row.passes_total,
      passesKey: row.passes_key,
      passesAccuracy: row.passes_accuracy,
      tacklesTotal: row.tackles_total,
      tacklesBlocks: row.tackles_blocks,
      tacklesInterceptions: row.tackles_interceptions,
      cardsYellow: row.cards_yellow,
      cardsYellowRed: row.cards_yellow_red,
      cardsRed: row.cards_red,
    })),
  };
}

export async function listCurrentSerieAEligiblePlayerSlugs(
  queryable: Queryable,
): Promise<string[]> {
  const result = await queryable.query<SlugRow>(
    `
      select p.slug
      from football.players p
      join football.competitions comp
        on comp.provider = $1
        and comp.provider_competition_id = $2
      join football.seasons s
        on s.competition_id = comp.id
        and s.provider = $1
        and s.provider_season_year = $3
      where p.provider = $1
        and (
          exists (
            select 1
            from football.squad_memberships eligible_sm
            join football.season_clubs eligible_sc
              on eligible_sc.club_id = eligible_sm.club_id
              and eligible_sc.season_id = s.id
            where eligible_sm.player_id = p.id
          )
          or exists (
            select 1
            from football.player_statistics eligible_ps
            where eligible_ps.player_id = p.id
              and eligible_ps.season_id = s.id
          )
        )
      order by p.slug
    `,
    [API_FOOTBALL_PROVIDER, SERIE_A_PROVIDER_LEAGUE_ID, SERIE_A_CURRENT_SEASON],
  );

  return result.rows.map((row) => row.slug);
}

export async function currentSerieAPlayerSlugExists(
  queryable: Queryable,
  slug: string,
): Promise<boolean> {
  const result = await queryable.query(
    `
      select 1
      from football.players p
      join football.competitions comp
        on comp.provider = $1
        and comp.provider_competition_id = $2
      join football.seasons s
        on s.competition_id = comp.id
        and s.provider = $1
        and s.provider_season_year = $3
      where p.provider = $1
        and p.slug = $4
        and (
          exists (
            select 1
            from football.squad_memberships eligible_sm
            join football.season_clubs eligible_sc
              on eligible_sc.club_id = eligible_sm.club_id
              and eligible_sc.season_id = s.id
            where eligible_sm.player_id = p.id
          )
          or exists (
            select 1
            from football.player_statistics eligible_ps
            where eligible_ps.player_id = p.id
              and eligible_ps.season_id = s.id
          )
        )
      limit 1
    `,
    [API_FOOTBALL_PROVIDER, SERIE_A_PROVIDER_LEAGUE_ID, SERIE_A_CURRENT_SEASON, slug],
  );

  return result.rows.length > 0;
}
