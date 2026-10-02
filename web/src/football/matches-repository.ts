import { randomUUID } from "node:crypto";

import type { Pool, PoolClient } from "pg";

import {
  API_FOOTBALL_PROVIDER,
  SERIE_A_CURRENT_SEASON,
  SERIE_A_PROVIDER_LEAGUE_ID,
} from "./foundation";
import { resolveFootballProperName } from "./localization";

type Queryable = Pick<Pool | PoolClient, "query">;

type IdRow = {
  id: string;
};

type SeasonClubRow = {
  season_id: string;
  provider_club_id: number;
  club_id: string;
  provider_name: string;
};

type MatchListRow = {
  id: string;
  provider_fixture_id: number;
  round: string;
  kickoff_at: Date | null;
  venue_name: string | null;
  venue_city: string | null;
  status: string;
  polling_category: string;
  provider_status_long: string | null;
  provider_status_short: string;
  status_elapsed: number | null;
  status_extra: number | null;
  home_goals: number | null;
  away_goals: number | null;
  home_slug: string;
  home_provider_name: string;
  away_slug: string;
  away_provider_name: string;
  home_name_ru: string | null;
  away_name_ru: string | null;
  home_name_ru_review_status: string | null;
  away_name_ru_review_status: string | null;
  home_code: string | null;
  away_code: string | null;
  home_logo_url: string | null;
  away_logo_url: string | null;
};

export type UpsertMatchInput = {
  providerFixtureId: number;
  slug: string;
  seasonId: string;
  homeClubId: string;
  awayClubId: string;
  round: string;
  kickoffAt: Date | null;
  providerTimezone: string | null;
  providerTimestamp: number | null;
  firstPeriodStart: number | null;
  secondPeriodStart: number | null;
  referee: string | null;
  providerVenueId: number | null;
  venueName: string | null;
  venueCity: string | null;
  status: string;
  pollingCategory: string;
  providerStatusLong: string | null;
  providerStatusShort: string;
  statusElapsed: number | null;
  statusExtra: number | null;
  homeWinner: boolean | null;
  awayWinner: boolean | null;
  homeGoals: number | null;
  awayGoals: number | null;
  halftimeHome: number | null;
  halftimeAway: number | null;
  fulltimeHome: number | null;
  fulltimeAway: number | null;
  extratimeHome: number | null;
  extratimeAway: number | null;
  penaltyHome: number | null;
  penaltyAway: number | null;
  providerRaw: Record<string, unknown>;
};

export type SerieASeasonClubContext = {
  seasonId: string;
  clubIdsByProviderId: Map<number, string>;
  clubProviderNamesByProviderId: Map<number, string>;
};

export type CurrentSerieAMatch = {
  id: string;
  providerFixtureId: number;
  round: string;
  kickoffAt: Date | null;
  venueName: string | null;
  venueCity: string | null;
  status: string;
  pollingCategory: string;
  providerStatusLong: string | null;
  providerStatusShort: string;
  statusElapsed: number | null;
  statusExtra: number | null;
  homeGoals: number | null;
  awayGoals: number | null;
  homeClub: {
    slug: string;
    displayName: string;
    code: string | null;
    providerLogoUrl: string | null;
  };
  awayClub: {
    slug: string;
    displayName: string;
    code: string | null;
    providerLogoUrl: string | null;
  };
};

function firstId(rows: IdRow[], label: string): string {
  const id = rows[0]?.id;

  if (!id) {
    throw new Error(`${label} did not return an id`);
  }

  return id;
}

export async function getSerieASeasonClubContext(
  queryable: Queryable,
): Promise<SerieASeasonClubContext | null> {
  const result = await queryable.query<SeasonClubRow>(
    `
      select
        s.id as season_id,
        c.provider_club_id,
        c.id as club_id,
        c.provider_name
      from football.competitions comp
      join football.seasons s on s.competition_id = comp.id
      join football.season_clubs sc on sc.season_id = s.id
      join football.clubs c on c.id = sc.club_id
      where comp.provider = $1
        and comp.provider_competition_id = $2
        and s.provider = $1
        and s.provider_season_year = $3
        and c.provider = $1
      order by c.provider_club_id
    `,
    [API_FOOTBALL_PROVIDER, SERIE_A_PROVIDER_LEAGUE_ID, SERIE_A_CURRENT_SEASON],
  );

  const seasonId = result.rows[0]?.season_id;

  if (!seasonId) {
    return null;
  }

  return {
    seasonId,
    clubIdsByProviderId: new Map(
      result.rows.map((row) => [row.provider_club_id, row.club_id]),
    ),
    clubProviderNamesByProviderId: new Map(
      result.rows.map((row) => [row.provider_club_id, row.provider_name]),
    ),
  };
}

export async function upsertMatch(
  queryable: Queryable,
  input: UpsertMatchInput,
): Promise<string> {
  return firstId(
    (
      await queryable.query<IdRow>(
        `
          insert into football.matches (
            id,
            provider,
            provider_fixture_id,
            slug,
            season_id,
            home_club_id,
            away_club_id,
            round,
            kickoff_at,
            provider_timezone,
            provider_timestamp,
            first_period_start,
            second_period_start,
            referee,
            provider_venue_id,
            venue_name,
            venue_city,
            status,
            polling_category,
            provider_status_long,
            provider_status_short,
            status_elapsed,
            status_extra,
            home_winner,
            away_winner,
            home_goals,
            away_goals,
            halftime_home,
            halftime_away,
            fulltime_home,
            fulltime_away,
            extratime_home,
            extratime_away,
            penalty_home,
            penalty_away,
            provider_raw
          )
          values (
            $1,
            $2,
            $3,
            $4,
            $5,
            $6,
            $7,
            $8,
            $9,
            $10,
            $11,
            $12,
            $13,
            $14,
            $15,
            $16,
            $17,
            $18,
            $19,
            $20,
            $21,
            $22,
            $23,
            $24,
            $25,
            $26,
            $27,
            $28,
            $29,
            $30,
            $31,
            $32,
            $33,
            $34,
            $35,
            $36::jsonb
          )
          on conflict (provider, provider_fixture_id)
          do update set
            season_id = excluded.season_id,
            home_club_id = excluded.home_club_id,
            away_club_id = excluded.away_club_id,
            round = excluded.round,
            kickoff_at = excluded.kickoff_at,
            provider_timezone = excluded.provider_timezone,
            provider_timestamp = excluded.provider_timestamp,
            first_period_start = excluded.first_period_start,
            second_period_start = excluded.second_period_start,
            referee = excluded.referee,
            provider_venue_id = excluded.provider_venue_id,
            venue_name = excluded.venue_name,
            venue_city = excluded.venue_city,
            status = excluded.status,
            polling_category = excluded.polling_category,
            provider_status_long = excluded.provider_status_long,
            provider_status_short = excluded.provider_status_short,
            status_elapsed = excluded.status_elapsed,
            status_extra = excluded.status_extra,
            home_winner = excluded.home_winner,
            away_winner = excluded.away_winner,
            home_goals = excluded.home_goals,
            away_goals = excluded.away_goals,
            halftime_home = excluded.halftime_home,
            halftime_away = excluded.halftime_away,
            fulltime_home = excluded.fulltime_home,
            fulltime_away = excluded.fulltime_away,
            extratime_home = excluded.extratime_home,
            extratime_away = excluded.extratime_away,
            penalty_home = excluded.penalty_home,
            penalty_away = excluded.penalty_away,
            provider_raw = excluded.provider_raw,
            updated_at = now()
          returning id
        `,
        [
          randomUUID(),
          API_FOOTBALL_PROVIDER,
          input.providerFixtureId,
          input.slug,
          input.seasonId,
          input.homeClubId,
          input.awayClubId,
          input.round,
          input.kickoffAt,
          input.providerTimezone,
          input.providerTimestamp,
          input.firstPeriodStart,
          input.secondPeriodStart,
          input.referee,
          input.providerVenueId,
          input.venueName,
          input.venueCity,
          input.status,
          input.pollingCategory,
          input.providerStatusLong,
          input.providerStatusShort,
          input.statusElapsed,
          input.statusExtra,
          input.homeWinner,
          input.awayWinner,
          input.homeGoals,
          input.awayGoals,
          input.halftimeHome,
          input.halftimeAway,
          input.fulltimeHome,
          input.fulltimeAway,
          input.extratimeHome,
          input.extratimeAway,
          input.penaltyHome,
          input.penaltyAway,
          JSON.stringify(input.providerRaw),
        ],
      )
    ).rows,
    "match upsert",
  );
}

export async function listCurrentSerieAMatches(
  queryable: Queryable,
): Promise<CurrentSerieAMatch[]> {
  const result = await queryable.query<MatchListRow>(
    `
      select
        m.id,
        m.provider_fixture_id,
        m.round,
        m.kickoff_at,
        m.venue_name,
        m.venue_city,
        m.status,
        m.polling_category,
        m.provider_status_long,
        m.provider_status_short,
        m.status_elapsed,
        m.status_extra,
        m.home_goals,
        m.away_goals,
        home.slug as home_slug,
        home.provider_name as home_provider_name,
        away.slug as away_slug,
        away.provider_name as away_provider_name,
        home.name_ru as home_name_ru,
        away.name_ru as away_name_ru,
        home.name_ru_review_status as home_name_ru_review_status,
        away.name_ru_review_status as away_name_ru_review_status,
        home.code as home_code,
        away.code as away_code,
        home.provider_logo_url as home_logo_url,
        away.provider_logo_url as away_logo_url
      from football.competitions comp
      join football.seasons s on s.competition_id = comp.id
      join football.matches m on m.season_id = s.id
      join football.clubs home on home.id = m.home_club_id
      join football.clubs away on away.id = m.away_club_id
      where comp.provider = $1
        and comp.provider_competition_id = $2
        and s.provider = $1
        and s.provider_season_year = $3
      order by
        m.kickoff_at is null,
        m.kickoff_at,
        m.provider_fixture_id
    `,
    [API_FOOTBALL_PROVIDER, SERIE_A_PROVIDER_LEAGUE_ID, SERIE_A_CURRENT_SEASON],
  );

  return result.rows.map((row) => ({
    id: row.id,
    providerFixtureId: row.provider_fixture_id,
    round: row.round,
    kickoffAt: row.kickoff_at,
    venueName: row.venue_name,
    venueCity: row.venue_city,
    status: row.status,
    pollingCategory: row.polling_category,
    providerStatusLong: row.provider_status_long,
    providerStatusShort: row.provider_status_short,
    statusElapsed: row.status_elapsed,
    statusExtra: row.status_extra,
    homeGoals: row.home_goals,
    awayGoals: row.away_goals,
    homeClub: {
      slug: row.home_slug,
      displayName: resolveFootballProperName({
        providerName: row.home_provider_name,
        nameRu: row.home_name_ru,
        reviewStatus: row.home_name_ru_review_status,
      }),
      code: row.home_code,
      providerLogoUrl: row.home_logo_url,
    },
    awayClub: {
      slug: row.away_slug,
      displayName: resolveFootballProperName({
        providerName: row.away_provider_name,
        nameRu: row.away_name_ru,
        reviewStatus: row.away_name_ru_review_status,
      }),
      code: row.away_code,
      providerLogoUrl: row.away_logo_url,
    },
  }));
}
