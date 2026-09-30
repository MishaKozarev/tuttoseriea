import type { Pool, PoolClient } from "pg";

import {
  API_FOOTBALL_PROVIDER,
  SERIE_A_CURRENT_SEASON,
  SERIE_A_PROVIDER_LEAGUE_ID,
} from "./foundation";
import { resolveFootballProperName } from "./localization";
import {
  listCurrentSerieAStandings,
  type CurrentSerieAStanding,
} from "./standings-repository";

type Queryable = Pick<Pool | PoolClient, "query">;

type ContributingClubRow = {
  id: string;
  slug: string;
  providerClubId: number;
  providerName: string;
  nameRu: string | null;
  nameRuReviewStatus: string | null;
};

type PlayerAggregateRow = {
  player_id: string;
  provider_player_id: number;
  slug: string;
  provider_name: string;
  name_ru: string | null;
  name_ru_review_status: string | null;
  contributing_clubs: ContributingClubRow[];
  goals: number | null;
  assists: number | null;
  appearances: number | null;
  minutes: number | null;
};

export type StatisticsPageClub = {
  id: string;
  slug: string;
  displayName: string;
};

export type SeasonPlayerAggregate = {
  player: {
    id: string;
    providerPlayerId: number;
    slug: string;
    displayName: string;
  };
  clubs: StatisticsPageClub[];
  goals: number | null;
  assists: number | null;
  appearances: number | null;
  minutes: number | null;
};

export type StatisticsLeaderboardMetric =
  | "goals"
  | "assists"
  | "appearances"
  | "minutes";

export type RankedPlayerStatistic = SeasonPlayerAggregate & {
  rank: number;
  value: number;
};

export type CurrentSerieAStatisticsPageData = {
  leaderboards: Record<StatisticsLeaderboardMetric, RankedPlayerStatistic[]>;
  standings: CurrentSerieAStanding[];
};

const LEADERBOARD_LIMIT = 20;

function requiresPositiveValue(metric: StatisticsLeaderboardMetric): boolean {
  return metric === "goals" || metric === "assists";
}

export function rankSeasonPlayerAggregates(
  aggregates: readonly SeasonPlayerAggregate[],
  metric: StatisticsLeaderboardMetric,
  limit = LEADERBOARD_LIMIT,
): RankedPlayerStatistic[] {
  const rankedCandidates = aggregates
    .flatMap((aggregate) => {
      const value = aggregate[metric];

      if (value == null || (requiresPositiveValue(metric) && value <= 0)) {
        return [];
      }

      return [{ aggregate, value }];
    })
    .sort(
      (left, right) =>
        right.value - left.value ||
        left.aggregate.player.providerPlayerId - right.aggregate.player.providerPlayerId,
    )
    .slice(0, limit);

  let previousValue: number | null = null;
  let previousRank = 0;

  return rankedCandidates.map(({ aggregate, value }, index) => {
    const rank = previousValue === value ? previousRank : index + 1;

    previousValue = value;
    previousRank = rank;

    return { ...aggregate, rank, value };
  });
}

export async function listCurrentSerieAPlayerAggregates(
  queryable: Queryable,
): Promise<SeasonPlayerAggregate[]> {
  const result = await queryable.query<PlayerAggregateRow>(
    `
      select
        p.id as player_id,
        p.provider_player_id,
        p.slug,
        p.provider_name,
        p.name_ru,
        p.name_ru_review_status,
        jsonb_agg(
          jsonb_build_object(
            'id', c.id,
            'slug', c.slug,
            'providerClubId', c.provider_club_id,
            'providerName', c.provider_name,
            'nameRu', c.name_ru,
            'nameRuReviewStatus', c.name_ru_review_status
          )
          order by c.provider_club_id
        ) as contributing_clubs,
        case
          when count(ps.goals_total) = count(*) then sum(ps.goals_total)::integer
          else null
        end as goals,
        case
          when count(ps.goals_assists) = count(*) then sum(ps.goals_assists)::integer
          else null
        end as assists,
        case
          when count(ps.appearances) = count(*) then sum(ps.appearances)::integer
          else null
        end as appearances,
        case
          when count(ps.minutes) = count(*) then sum(ps.minutes)::integer
          else null
        end as minutes
      from football.competitions comp
      join football.seasons s on s.competition_id = comp.id
      join football.player_statistics ps on ps.season_id = s.id
      join football.players p on p.id = ps.player_id
      join football.clubs c on c.id = ps.club_id
      where comp.provider = $1
        and comp.provider_competition_id = $2
        and s.provider = $1
        and s.provider_season_year = $3
        and p.provider = $1
        and c.provider = $1
      group by
        p.id,
        p.provider_player_id,
        p.slug,
        p.provider_name,
        p.name_ru,
        p.name_ru_review_status
      order by p.provider_player_id
    `,
    [API_FOOTBALL_PROVIDER, SERIE_A_PROVIDER_LEAGUE_ID, SERIE_A_CURRENT_SEASON],
  );

  return result.rows.map((row) => ({
    player: {
      id: row.player_id,
      providerPlayerId: row.provider_player_id,
      slug: row.slug,
      displayName: resolveFootballProperName({
        providerName: row.provider_name,
        nameRu: row.name_ru,
        reviewStatus: row.name_ru_review_status,
      }),
    },
    clubs: row.contributing_clubs.map((club) => ({
      id: club.id,
      slug: club.slug,
      displayName: resolveFootballProperName({
        providerName: club.providerName,
        nameRu: club.nameRu,
        reviewStatus: club.nameRuReviewStatus,
      }),
    })),
    goals: row.goals,
    assists: row.assists,
    appearances: row.appearances,
    minutes: row.minutes,
  }));
}

export async function getCurrentSerieAStatisticsPageData(
  queryable: Queryable,
): Promise<CurrentSerieAStatisticsPageData> {
  const [aggregates, standings] = await Promise.all([
    listCurrentSerieAPlayerAggregates(queryable),
    listCurrentSerieAStandings(queryable),
  ]);

  return {
    leaderboards: {
      goals: rankSeasonPlayerAggregates(aggregates, "goals"),
      assists: rankSeasonPlayerAggregates(aggregates, "assists"),
      appearances: rankSeasonPlayerAggregates(aggregates, "appearances"),
      minutes: rankSeasonPlayerAggregates(aggregates, "minutes"),
    },
    standings,
  };
}
