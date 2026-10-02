import type { Pool, PoolClient } from "pg";

import {
  API_FOOTBALL_PROVIDER,
  SERIE_A_CURRENT_SEASON,
  SERIE_A_PROVIDER_LEAGUE_ID,
} from "./foundation";
import { resolveFootballProperName } from "./localization";

type Queryable = Pick<Pool | PoolClient, "query">;

type MatchPageRow = {
  id: string;
  slug: string;
  provider_fixture_id: number;
  round: string;
  kickoff_at: Date | null;
  status: string;
  provider_status_long: string | null;
  provider_status_short: string;
  status_elapsed: number | null;
  status_extra: number | null;
  home_goals: number | null;
  away_goals: number | null;
  halftime_home: number | null;
  halftime_away: number | null;
  fulltime_home: number | null;
  fulltime_away: number | null;
  extratime_home: number | null;
  extratime_away: number | null;
  penalty_home: number | null;
  penalty_away: number | null;
  venue_name: string | null;
  venue_city: string | null;
  referee: string | null;
  competition_provider_name: string;
  competition_name_ru: string | null;
  competition_name_ru_review_status: string | null;
  season_display_label: string;
  home_slug: string;
  home_provider_name: string;
  home_name_ru: string | null;
  home_name_ru_review_status: string | null;
  home_code: string | null;
  home_logo_url: string | null;
  away_slug: string;
  away_provider_name: string;
  away_name_ru: string | null;
  away_name_ru_review_status: string | null;
  away_code: string | null;
  away_logo_url: string | null;
};

type SlugRow = {
  slug: string;
};

export type MatchPageClub = {
  slug: string;
  displayName: string;
  code: string | null;
  providerLogoUrl: string | null;
};

export type MatchPageScore = {
  home: number | null;
  away: number | null;
};

export type CurrentSerieAMatchPageData = {
  match: {
    id: string;
    slug: string;
    providerFixtureId: number;
    round: string;
    kickoffAt: Date | null;
    status: string;
    providerStatusLong: string | null;
    providerStatusShort: string;
    statusElapsed: number | null;
    statusExtra: number | null;
    score: MatchPageScore;
    halftimeScore: MatchPageScore;
    fulltimeScore: MatchPageScore;
    extratimeScore: MatchPageScore;
    penaltyScore: MatchPageScore;
    venueName: string | null;
    venueCity: string | null;
    referee: string | null;
  };
  competition: {
    displayName: string;
  };
  season: {
    displayLabel: string;
  };
  homeClub: MatchPageClub;
  awayClub: MatchPageClub;
};

function resolveClub(row: MatchPageRow, side: "home" | "away"): MatchPageClub {
  return {
    slug: row[`${side}_slug`],
    displayName: resolveFootballProperName({
      providerName: row[`${side}_provider_name`],
      nameRu: row[`${side}_name_ru`],
      reviewStatus: row[`${side}_name_ru_review_status`],
    }),
    code: row[`${side}_code`],
    providerLogoUrl: row[`${side}_logo_url`],
  };
}

export async function getCurrentSerieAMatchPageData(
  queryable: Queryable,
  slug: string,
): Promise<CurrentSerieAMatchPageData | null> {
  const result = await queryable.query<MatchPageRow>(
    `
      select
        m.id,
        m.slug,
        m.provider_fixture_id,
        m.round,
        m.kickoff_at,
        m.status,
        m.provider_status_long,
        m.provider_status_short,
        m.status_elapsed,
        m.status_extra,
        m.home_goals,
        m.away_goals,
        m.halftime_home,
        m.halftime_away,
        m.fulltime_home,
        m.fulltime_away,
        m.extratime_home,
        m.extratime_away,
        m.penalty_home,
        m.penalty_away,
        m.venue_name,
        m.venue_city,
        m.referee,
        comp.provider_name as competition_provider_name,
        comp.name_ru as competition_name_ru,
        comp.name_ru_review_status as competition_name_ru_review_status,
        s.display_label as season_display_label,
        home.slug as home_slug,
        home.provider_name as home_provider_name,
        home.name_ru as home_name_ru,
        home.name_ru_review_status as home_name_ru_review_status,
        home.code as home_code,
        home.provider_logo_url as home_logo_url,
        away.slug as away_slug,
        away.provider_name as away_provider_name,
        away.name_ru as away_name_ru,
        away.name_ru_review_status as away_name_ru_review_status,
        away.code as away_code,
        away.provider_logo_url as away_logo_url
      from football.matches m
      join football.seasons s on s.id = m.season_id
      join football.competitions comp on comp.id = s.competition_id
      join football.clubs home on home.id = m.home_club_id
      join football.clubs away on away.id = m.away_club_id
      where m.provider = $1
        and comp.provider = $1
        and comp.provider_competition_id = $2
        and s.provider = $1
        and s.provider_season_year = $3
        and home.provider = $1
        and away.provider = $1
        and m.slug = $4
      limit 1
    `,
    [API_FOOTBALL_PROVIDER, SERIE_A_PROVIDER_LEAGUE_ID, SERIE_A_CURRENT_SEASON, slug],
  );
  const row = result.rows[0];

  if (!row) {
    return null;
  }

  return {
    match: {
      id: row.id,
      slug: row.slug,
      providerFixtureId: row.provider_fixture_id,
      round: row.round,
      kickoffAt: row.kickoff_at,
      status: row.status,
      providerStatusLong: row.provider_status_long,
      providerStatusShort: row.provider_status_short,
      statusElapsed: row.status_elapsed,
      statusExtra: row.status_extra,
      score: { home: row.home_goals, away: row.away_goals },
      halftimeScore: { home: row.halftime_home, away: row.halftime_away },
      fulltimeScore: { home: row.fulltime_home, away: row.fulltime_away },
      extratimeScore: { home: row.extratime_home, away: row.extratime_away },
      penaltyScore: { home: row.penalty_home, away: row.penalty_away },
      venueName: row.venue_name,
      venueCity: row.venue_city,
      referee: row.referee,
    },
    competition: {
      displayName: resolveFootballProperName({
        providerName: row.competition_provider_name,
        nameRu: row.competition_name_ru,
        reviewStatus: row.competition_name_ru_review_status,
      }),
    },
    season: {
      displayLabel: row.season_display_label,
    },
    homeClub: resolveClub(row, "home"),
    awayClub: resolveClub(row, "away"),
  };
}

export async function currentSerieAMatchSlugExists(
  queryable: Queryable,
  slug: string,
): Promise<boolean> {
  const result = await queryable.query(
    `
      select 1
      from football.matches m
      join football.seasons s on s.id = m.season_id
      join football.competitions comp on comp.id = s.competition_id
      where m.provider = $1
        and comp.provider = $1
        and comp.provider_competition_id = $2
        and s.provider = $1
        and s.provider_season_year = $3
        and m.slug = $4
      limit 1
    `,
    [API_FOOTBALL_PROVIDER, SERIE_A_PROVIDER_LEAGUE_ID, SERIE_A_CURRENT_SEASON, slug],
  );

  return result.rowCount === 1;
}

export async function listCurrentSerieAMatchSlugs(
  queryable: Queryable,
): Promise<string[]> {
  const result = await queryable.query<SlugRow>(
    `
      select m.slug
      from football.matches m
      join football.seasons s on s.id = m.season_id
      join football.competitions comp on comp.id = s.competition_id
      where m.provider = $1
        and comp.provider = $1
        and comp.provider_competition_id = $2
        and s.provider = $1
        and s.provider_season_year = $3
      order by m.slug
    `,
    [API_FOOTBALL_PROVIDER, SERIE_A_PROVIDER_LEAGUE_ID, SERIE_A_CURRENT_SEASON],
  );

  return result.rows.map((row) => row.slug);
}
