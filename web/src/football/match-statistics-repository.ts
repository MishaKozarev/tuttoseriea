import { randomUUID } from "node:crypto";

import type { Pool, PoolClient } from "pg";

import type { NormalizedFixtureState } from "./api-football/fixture-status";
import {
  API_FOOTBALL_PROVIDER,
  SERIE_A_CURRENT_SEASON,
  SERIE_A_PROVIDER_LEAGUE_ID,
} from "./foundation";

type Queryable = Pick<Pool | PoolClient, "query">;

type MatchContextRow = {
  id: string;
  provider_fixture_id: number;
  status: NormalizedFixtureState;
  home_club_id: string;
  home_provider_club_id: number;
  away_club_id: string;
  away_provider_club_id: number;
  persisted_statistics_club_ids: string[];
};

export type MatchStatisticsScope = "full_match";

export type MatchStatisticsContext = {
  matchId: string;
  providerFixtureId: number;
  status: NormalizedFixtureState;
  homeClub: {
    id: string;
    providerClubId: number;
  };
  awayClub: {
    id: string;
    providerClubId: number;
  };
  persistedStatisticsClubIds: string[];
};

export type InsertMatchStatisticItemInput = {
  providerType: string;
  providerValue: number | string | null;
  providerOrder: number;
  providerRaw: Record<string, unknown>;
};

export type ReplaceMatchStatisticsInput = {
  clubId: string;
  scope: MatchStatisticsScope;
  providerRaw: Record<string, unknown>;
  items: InsertMatchStatisticItemInput[];
};

export async function getCurrentSerieAMatchStatisticsContext(
  queryable: Queryable,
  matchId: string,
): Promise<MatchStatisticsContext | null> {
  const result = await queryable.query<MatchContextRow>(
    `
      select
        m.id,
        m.provider_fixture_id,
        m.status,
        home.id as home_club_id,
        home.provider_club_id as home_provider_club_id,
        away.id as away_club_id,
        away.provider_club_id as away_provider_club_id,
        coalesce(
          (
            select array_agg(ms.club_id order by ms.club_id)
            from football.match_statistics ms
            where ms.match_id = m.id
              and ms.scope = 'full_match'
          ),
          array[]::text[]
        ) as persisted_statistics_club_ids
      from football.competitions comp
      join football.seasons s on s.competition_id = comp.id
      join football.matches m on m.season_id = s.id
      join football.clubs home on home.id = m.home_club_id
      join football.clubs away on away.id = m.away_club_id
      where m.id = $1
        and m.provider = $2
        and comp.provider = $2
        and comp.provider_competition_id = $3
        and s.provider = $2
        and s.provider_season_year = $4
        and home.provider = $2
        and away.provider = $2
    `,
    [
      matchId,
      API_FOOTBALL_PROVIDER,
      SERIE_A_PROVIDER_LEAGUE_ID,
      SERIE_A_CURRENT_SEASON,
    ],
  );
  const row = result.rows[0];

  if (!row) {
    return null;
  }

  return {
    matchId: row.id,
    providerFixtureId: row.provider_fixture_id,
    status: row.status,
    homeClub: {
      id: row.home_club_id,
      providerClubId: row.home_provider_club_id,
    },
    awayClub: {
      id: row.away_club_id,
      providerClubId: row.away_provider_club_id,
    },
    persistedStatisticsClubIds: row.persisted_statistics_club_ids,
  };
}

export async function replaceMatchStatistics(
  queryable: Queryable,
  matchId: string,
  snapshots: readonly ReplaceMatchStatisticsInput[],
): Promise<void> {
  for (const snapshot of snapshots) {
    await queryable.query(
      `
        delete from football.match_statistics
        where match_id = $1
          and club_id = $2
          and scope = $3
      `,
      [matchId, snapshot.clubId, snapshot.scope],
    );

    const snapshotId = randomUUID();

    await queryable.query(
      `
        insert into football.match_statistics (
          id,
          match_id,
          club_id,
          scope,
          provider_raw
        )
        values ($1, $2, $3, $4, $5::jsonb)
      `,
      [
        snapshotId,
        matchId,
        snapshot.clubId,
        snapshot.scope,
        JSON.stringify(snapshot.providerRaw),
      ],
    );

    for (const item of snapshot.items) {
      await queryable.query(
        `
          insert into football.match_statistic_items (
            id,
            match_statistics_id,
            provider_type,
            provider_value,
            provider_order,
            provider_raw
          )
          values ($1, $2, $3, $4::jsonb, $5, $6::jsonb)
        `,
        [
          randomUUID(),
          snapshotId,
          item.providerType,
          JSON.stringify(item.providerValue),
          item.providerOrder,
          JSON.stringify(item.providerRaw),
        ],
      );
    }
  }
}
