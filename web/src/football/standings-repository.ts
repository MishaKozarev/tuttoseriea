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
};

type StandingListRow = {
  id: string;
  rank: number;
  group_name: string | null;
  points: number;
  goals_diff: number;
  form: string | null;
  provider_status: string | null;
  description: string | null;
  played: number;
  wins: number;
  draws: number;
  losses: number;
  goals_for: number;
  goals_against: number;
  home_played: number;
  home_wins: number;
  home_draws: number;
  home_losses: number;
  home_goals_for: number;
  home_goals_against: number;
  away_played: number;
  away_wins: number;
  away_draws: number;
  away_losses: number;
  away_goals_for: number;
  away_goals_against: number;
  club_id: string;
  club_slug: string;
  provider_name: string;
  name_ru: string | null;
  name_ru_review_status: string | null;
  code: string | null;
  provider_logo_url: string | null;
};

export type StandingStatistics = {
  played: number;
  wins: number;
  draws: number;
  losses: number;
  goalsFor: number;
  goalsAgainst: number;
};

export type UpsertStandingInput = {
  seasonId: string;
  clubId: string;
  groupName: string | null;
  rank: number;
  points: number;
  goalsDiff: number;
  form: string | null;
  providerStatus: string | null;
  description: string | null;
  overall: StandingStatistics;
  home: StandingStatistics;
  away: StandingStatistics;
  providerRaw: Record<string, unknown>;
};

export type SerieAStandingsContext = {
  seasonId: string;
  clubIdsByProviderId: Map<number, string>;
};

export type CurrentSerieAStanding = Omit<UpsertStandingInput, "providerRaw" | "seasonId"> & {
  id: string;
  club: {
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

export async function getSerieAStandingsContext(
  queryable: Queryable,
): Promise<SerieAStandingsContext | null> {
  const result = await queryable.query<SeasonClubRow>(
    `
      select
        s.id as season_id,
        c.provider_club_id,
        c.id as club_id
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
  };
}

export async function upsertStanding(
  queryable: Queryable,
  input: UpsertStandingInput,
): Promise<string> {
  return firstId(
    (
      await queryable.query<IdRow>(
        `
          insert into football.standings (
            id,
            season_id,
            club_id,
            group_name,
            rank,
            points,
            goals_diff,
            form,
            provider_status,
            description,
            played,
            wins,
            draws,
            losses,
            goals_for,
            goals_against,
            home_played,
            home_wins,
            home_draws,
            home_losses,
            home_goals_for,
            home_goals_against,
            away_played,
            away_wins,
            away_draws,
            away_losses,
            away_goals_for,
            away_goals_against,
            provider_raw
          )
          values (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
            $11, $12, $13, $14, $15, $16, $17, $18, $19, $20,
            $21, $22, $23, $24, $25, $26, $27, $28, $29::jsonb
          )
          on conflict (season_id, club_id)
          do update set
            group_name = excluded.group_name,
            rank = excluded.rank,
            points = excluded.points,
            goals_diff = excluded.goals_diff,
            form = excluded.form,
            provider_status = excluded.provider_status,
            description = excluded.description,
            played = excluded.played,
            wins = excluded.wins,
            draws = excluded.draws,
            losses = excluded.losses,
            goals_for = excluded.goals_for,
            goals_against = excluded.goals_against,
            home_played = excluded.home_played,
            home_wins = excluded.home_wins,
            home_draws = excluded.home_draws,
            home_losses = excluded.home_losses,
            home_goals_for = excluded.home_goals_for,
            home_goals_against = excluded.home_goals_against,
            away_played = excluded.away_played,
            away_wins = excluded.away_wins,
            away_draws = excluded.away_draws,
            away_losses = excluded.away_losses,
            away_goals_for = excluded.away_goals_for,
            away_goals_against = excluded.away_goals_against,
            provider_raw = excluded.provider_raw,
            updated_at = now()
          returning id
        `,
        [
          randomUUID(),
          input.seasonId,
          input.clubId,
          input.groupName,
          input.rank,
          input.points,
          input.goalsDiff,
          input.form,
          input.providerStatus,
          input.description,
          input.overall.played,
          input.overall.wins,
          input.overall.draws,
          input.overall.losses,
          input.overall.goalsFor,
          input.overall.goalsAgainst,
          input.home.played,
          input.home.wins,
          input.home.draws,
          input.home.losses,
          input.home.goalsFor,
          input.home.goalsAgainst,
          input.away.played,
          input.away.wins,
          input.away.draws,
          input.away.losses,
          input.away.goalsFor,
          input.away.goalsAgainst,
          JSON.stringify(input.providerRaw),
        ],
      )
    ).rows,
    "standing upsert",
  );
}

export async function reserveStandingRanksForSnapshot(
  queryable: Queryable,
  seasonId: string,
): Promise<void> {
  await queryable.query(
    `
      update football.standings
      set rank = rank + 1000000
      where season_id = $1
    `,
    [seasonId],
  );
}

export async function listCurrentSerieAStandings(
  queryable: Queryable,
): Promise<CurrentSerieAStanding[]> {
  const result = await queryable.query<StandingListRow>(
    `
      select
        st.id,
        st.rank,
        st.group_name,
        st.points,
        st.goals_diff,
        st.form,
        st.provider_status,
        st.description,
        st.played,
        st.wins,
        st.draws,
        st.losses,
        st.goals_for,
        st.goals_against,
        st.home_played,
        st.home_wins,
        st.home_draws,
        st.home_losses,
        st.home_goals_for,
        st.home_goals_against,
        st.away_played,
        st.away_wins,
        st.away_draws,
        st.away_losses,
        st.away_goals_for,
        st.away_goals_against,
        c.id as club_id,
        c.slug as club_slug,
        c.provider_name,
        c.name_ru,
        c.name_ru_review_status,
        c.code,
        c.provider_logo_url
      from football.competitions comp
      join football.seasons s on s.competition_id = comp.id
      join football.standings st on st.season_id = s.id
      join football.clubs c on c.id = st.club_id
      where comp.provider = $1
        and comp.provider_competition_id = $2
        and s.provider = $1
        and s.provider_season_year = $3
      order by st.rank, c.provider_club_id
    `,
    [API_FOOTBALL_PROVIDER, SERIE_A_PROVIDER_LEAGUE_ID, SERIE_A_CURRENT_SEASON],
  );

  return result.rows.map((row) => ({
    id: row.id,
    clubId: row.club_id,
    groupName: row.group_name,
    rank: row.rank,
    points: row.points,
    goalsDiff: row.goals_diff,
    form: row.form,
    providerStatus: row.provider_status,
    description: row.description,
    overall: {
      played: row.played,
      wins: row.wins,
      draws: row.draws,
      losses: row.losses,
      goalsFor: row.goals_for,
      goalsAgainst: row.goals_against,
    },
    home: {
      played: row.home_played,
      wins: row.home_wins,
      draws: row.home_draws,
      losses: row.home_losses,
      goalsFor: row.home_goals_for,
      goalsAgainst: row.home_goals_against,
    },
    away: {
      played: row.away_played,
      wins: row.away_wins,
      draws: row.away_draws,
      losses: row.away_losses,
      goalsFor: row.away_goals_for,
      goalsAgainst: row.away_goals_against,
    },
    club: {
      slug: row.club_slug,
      displayName: resolveFootballProperName({
        providerName: row.provider_name,
        nameRu: row.name_ru,
        reviewStatus: row.name_ru_review_status,
      }),
      code: row.code,
      providerLogoUrl: row.provider_logo_url,
    },
  }));
}
