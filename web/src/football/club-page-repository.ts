import type { Pool, PoolClient } from "pg";

import {
  API_FOOTBALL_PROVIDER,
  SERIE_A_CURRENT_SEASON,
  SERIE_A_PROVIDER_LEAGUE_ID,
} from "./foundation";
import { resolveFootballProperName } from "./localization";

type Queryable = Pick<Pool | PoolClient, "query">;

const CLUB_PAGE_MATCH_LIMIT = 5;

type ClubScopeRow = {
  id: string;
  slug: string;
  provider_name: string;
  name_ru: string | null;
  name_ru_review_status: string | null;
  code: string | null;
  country: string | null;
  founded: number | null;
  provider_logo_url: string | null;
  season_id: string;
  season_display_label: string;
  competition_provider_name: string;
  competition_name_ru: string | null;
  competition_name_ru_review_status: string | null;
};

type StandingRow = {
  rank: number;
  points: number;
  goals_diff: number;
  form: string | null;
  description: string | null;
  played: number;
  wins: number;
  draws: number;
  losses: number;
  goals_for: number;
  goals_against: number;
};

type MatchRow = {
  id: string;
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

type SquadRow = {
  membership_id: string;
  shirt_number: number | null;
  position: string;
  player_id: string;
  public_player_slug: string | null;
  provider_name: string;
  name_ru: string | null;
  name_ru_review_status: string | null;
  provider_photo_url: string | null;
  statistics_id: string | null;
  appearances: number | null;
  lineups: number | null;
  minutes: number | null;
  goals_total: number | null;
  goals_assists: number | null;
  rating: string | null;
};

type SlugRow = {
  slug: string;
};

export type ClubPageStanding = {
  rank: number;
  points: number;
  goalsDiff: number;
  form: string | null;
  description: string | null;
  played: number;
  wins: number;
  draws: number;
  losses: number;
  goalsFor: number;
  goalsAgainst: number;
};

export type ClubPageMatch = {
  id: string;
  providerFixtureId: number;
  round: string;
  kickoffAt: Date | null;
  status: string;
  providerStatusLong: string | null;
  providerStatusShort: string;
  statusElapsed: number | null;
  statusExtra: number | null;
  homeGoals: number | null;
  awayGoals: number | null;
  homeClub: ClubPageMatchClub;
  awayClub: ClubPageMatchClub;
};

type ClubPageMatchClub = {
  slug: string;
  displayName: string;
  code: string | null;
  providerLogoUrl: string | null;
};

export type ClubPagePlayerStatistics = {
  appearances: number | null;
  lineups: number | null;
  minutes: number | null;
  goals: number | null;
  assists: number | null;
  rating: string | null;
};

export type ClubPageSquadPlayer = {
  membershipId: string;
  playerId: string;
  publicPlayerSlug: string | null;
  displayName: string;
  providerPhotoUrl: string | null;
  shirtNumber: number | null;
  position: string;
  statistics: ClubPagePlayerStatistics | null;
};

export type CurrentSerieAClubPageData = {
  club: {
    id: string;
    slug: string;
    displayName: string;
    providerName: string;
    code: string | null;
    country: string | null;
    founded: number | null;
    providerLogoUrl: string | null;
  };
  competition: {
    displayName: string;
  };
  season: {
    id: string;
    displayLabel: string;
  };
  standing: ClubPageStanding | null;
  recentMatches: ClubPageMatch[];
  upcomingMatches: ClubPageMatch[];
  squad: ClubPageSquadPlayer[];
};

function mapMatch(row: MatchRow): ClubPageMatch {
  return {
    id: row.id,
    providerFixtureId: row.provider_fixture_id,
    round: row.round,
    kickoffAt: row.kickoff_at,
    status: row.status,
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
  };
}

async function listClubMatches(
  queryable: Queryable,
  seasonId: string,
  clubId: string,
  kind: "recent" | "upcoming",
): Promise<ClubPageMatch[]> {
  const categoryPredicate =
    kind === "recent"
      ? "m.polling_category = 'TERMINAL'"
      : "m.polling_category in ('ACTIVE', 'WATCH')";
  const ordering =
    kind === "recent"
      ? "m.kickoff_at desc nulls last, m.provider_fixture_id desc"
      : "m.kickoff_at asc nulls last, m.provider_fixture_id";
  const result = await queryable.query<MatchRow>(
    `
      select
        m.id,
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
      join football.clubs home on home.id = m.home_club_id
      join football.clubs away on away.id = m.away_club_id
      where m.season_id = $1
        and (m.home_club_id = $2 or m.away_club_id = $2)
        and ${categoryPredicate}
      order by ${ordering}
      limit $3
    `,
    [seasonId, clubId, CLUB_PAGE_MATCH_LIMIT],
  );

  return result.rows.map(mapMatch);
}

export async function getCurrentSerieAClubPageData(
  queryable: Queryable,
  slug: string,
): Promise<CurrentSerieAClubPageData | null> {
  const scopeResult = await queryable.query<ClubScopeRow>(
    `
      select
        c.id,
        c.slug,
        c.provider_name,
        c.name_ru,
        c.name_ru_review_status,
        c.code,
        c.country,
        c.founded,
        c.provider_logo_url,
        s.id as season_id,
        s.display_label as season_display_label,
        comp.provider_name as competition_provider_name,
        comp.name_ru as competition_name_ru,
        comp.name_ru_review_status as competition_name_ru_review_status
      from football.competitions comp
      join football.seasons s on s.competition_id = comp.id
      join football.season_clubs sc on sc.season_id = s.id
      join football.clubs c on c.id = sc.club_id
      where comp.provider = $1
        and comp.provider_competition_id = $2
        and s.provider = $1
        and s.provider_season_year = $3
        and c.slug = $4
      limit 1
    `,
    [API_FOOTBALL_PROVIDER, SERIE_A_PROVIDER_LEAGUE_ID, SERIE_A_CURRENT_SEASON, slug],
  );
  const scope = scopeResult.rows[0];

  if (!scope) {
    return null;
  }

  const standingResult = await queryable.query<StandingRow>(
    `
      select
        rank,
        points,
        goals_diff,
        form,
        description,
        played,
        wins,
        draws,
        losses,
        goals_for,
        goals_against
      from football.standings
      where season_id = $1 and club_id = $2
      limit 1
    `,
    [scope.season_id, scope.id],
  );
  const recentMatches = await listClubMatches(
    queryable,
    scope.season_id,
    scope.id,
    "recent",
  );
  const upcomingMatches = await listClubMatches(
    queryable,
    scope.season_id,
    scope.id,
    "upcoming",
  );
  const squadResult = await queryable.query<SquadRow>(
    `
      select
        sm.id as membership_id,
        sm.shirt_number,
        sm.position,
        p.id as player_id,
        case
          when p.provider = $3
            and (
              exists (
                select 1
                from football.squad_memberships eligible_sm
                join football.season_clubs eligible_sc
                  on eligible_sc.club_id = eligible_sm.club_id
                  and eligible_sc.season_id = $1
                where eligible_sm.player_id = p.id
              )
              or exists (
                select 1
                from football.player_statistics eligible_ps
                where eligible_ps.player_id = p.id
                  and eligible_ps.season_id = $1
              )
            )
          then p.slug
          else null
        end as public_player_slug,
        p.provider_name,
        p.name_ru,
        p.name_ru_review_status,
        p.provider_photo_url,
        ps.id as statistics_id,
        ps.appearances,
        ps.lineups,
        ps.minutes,
        ps.goals_total,
        ps.goals_assists,
        ps.rating
      from football.squad_memberships sm
      join football.players p on p.id = sm.player_id
      left join football.player_statistics ps
        on ps.season_id = $1
        and ps.club_id = sm.club_id
        and ps.player_id = sm.player_id
      where sm.club_id = $2
      order by
        sm.position,
        sm.shirt_number nulls last,
        p.provider_name,
        p.provider_player_id
    `,
    [scope.season_id, scope.id, API_FOOTBALL_PROVIDER],
  );
  const standing = standingResult.rows[0];

  return {
    club: {
      id: scope.id,
      slug: scope.slug,
      displayName: resolveFootballProperName({
        providerName: scope.provider_name,
        nameRu: scope.name_ru,
        reviewStatus: scope.name_ru_review_status,
      }),
      providerName: scope.provider_name,
      code: scope.code,
      country: scope.country,
      founded: scope.founded,
      providerLogoUrl: scope.provider_logo_url,
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
    standing: standing
      ? {
          rank: standing.rank,
          points: standing.points,
          goalsDiff: standing.goals_diff,
          form: standing.form,
          description: standing.description,
          played: standing.played,
          wins: standing.wins,
          draws: standing.draws,
          losses: standing.losses,
          goalsFor: standing.goals_for,
          goalsAgainst: standing.goals_against,
        }
      : null,
    recentMatches,
    upcomingMatches,
    squad: squadResult.rows.map((row) => ({
      membershipId: row.membership_id,
      playerId: row.player_id,
      publicPlayerSlug: row.public_player_slug,
      displayName: resolveFootballProperName({
        providerName: row.provider_name,
        nameRu: row.name_ru,
        reviewStatus: row.name_ru_review_status,
      }),
      providerPhotoUrl: row.provider_photo_url,
      shirtNumber: row.shirt_number,
      position: row.position,
      statistics: row.statistics_id
        ? {
            appearances: row.appearances,
            lineups: row.lineups,
            minutes: row.minutes,
            goals: row.goals_total,
            assists: row.goals_assists,
            rating: row.rating,
          }
        : null,
    })),
  };
}

export async function listCurrentSerieAClubSlugs(
  queryable: Queryable,
): Promise<string[]> {
  const result = await queryable.query<SlugRow>(
    `
      select c.slug
      from football.competitions comp
      join football.seasons s on s.competition_id = comp.id
      join football.season_clubs sc on sc.season_id = s.id
      join football.clubs c on c.id = sc.club_id
      where comp.provider = $1
        and comp.provider_competition_id = $2
        and s.provider = $1
        and s.provider_season_year = $3
      order by c.slug
    `,
    [API_FOOTBALL_PROVIDER, SERIE_A_PROVIDER_LEAGUE_ID, SERIE_A_CURRENT_SEASON],
  );

  return result.rows.map((row) => row.slug);
}

export async function currentSerieAClubSlugExists(
  queryable: Queryable,
  slug: string,
): Promise<boolean> {
  const result = await queryable.query(
    `
      select 1
      from football.competitions comp
      join football.seasons s on s.competition_id = comp.id
      join football.season_clubs sc on sc.season_id = s.id
      join football.clubs c on c.id = sc.club_id
      where comp.provider = $1
        and comp.provider_competition_id = $2
        and s.provider = $1
        and s.provider_season_year = $3
        and c.slug = $4
      limit 1
    `,
    [API_FOOTBALL_PROVIDER, SERIE_A_PROVIDER_LEAGUE_ID, SERIE_A_CURRENT_SEASON, slug],
  );

  return result.rowCount === 1;
}
