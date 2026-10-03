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
};

type PlayerIdentityRow = {
  id: string;
  provider_player_id: number;
};

export type MatchEventContext = {
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
};

export type InsertMatchEventInput = {
  providerOrder: number;
  elapsed: number;
  extra: number | null;
  clubId: string;
  providerPlayerId: number | null;
  providerPlayerName: string | null;
  playerId: string | null;
  providerRelatedPlayerId: number | null;
  providerRelatedPlayerName: string | null;
  relatedPlayerId: string | null;
  providerType: string;
  providerDetail: string;
  comments: string | null;
  providerRaw: Record<string, unknown>;
};

export async function getCurrentSerieAMatchEventContext(
  queryable: Queryable,
  matchId: string,
): Promise<MatchEventContext | null> {
  const result = await queryable.query<MatchContextRow>(
    `
      select
        m.id,
        m.provider_fixture_id,
        m.status,
        home.id as home_club_id,
        home.provider_club_id as home_provider_club_id,
        away.id as away_club_id,
        away.provider_club_id as away_provider_club_id
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
  };
}

export async function resolveApiFootballPlayerIds(
  queryable: Queryable,
  providerPlayerIds: readonly number[],
): Promise<Map<number, string>> {
  if (providerPlayerIds.length === 0) {
    return new Map();
  }

  const result = await queryable.query<PlayerIdentityRow>(
    `
      select id, provider_player_id
      from football.players
      where provider = $1
        and provider_player_id = any($2::integer[])
    `,
    [API_FOOTBALL_PROVIDER, providerPlayerIds],
  );

  return new Map(result.rows.map((row) => [row.provider_player_id, row.id]));
}

export async function replaceMatchEvents(
  queryable: Queryable,
  matchId: string,
  events: readonly InsertMatchEventInput[],
): Promise<void> {
  await queryable.query("delete from football.match_events where match_id = $1", [
    matchId,
  ]);

  for (const event of events) {
    await queryable.query(
      `
        insert into football.match_events (
          id,
          match_id,
          provider_order,
          elapsed,
          extra,
          club_id,
          provider_player_id,
          provider_player_name,
          player_id,
          provider_related_player_id,
          provider_related_player_name,
          related_player_id,
          provider_type,
          provider_detail,
          comments,
          provider_raw
        )
        values (
          $1, $2, $3, $4, $5, $6, $7, $8,
          $9, $10, $11, $12, $13, $14, $15, $16::jsonb
        )
      `,
      [
        randomUUID(),
        matchId,
        event.providerOrder,
        event.elapsed,
        event.extra,
        event.clubId,
        event.providerPlayerId,
        event.providerPlayerName,
        event.playerId,
        event.providerRelatedPlayerId,
        event.providerRelatedPlayerName,
        event.relatedPlayerId,
        event.providerType,
        event.providerDetail,
        event.comments,
        JSON.stringify(event.providerRaw),
      ],
    );
  }
}
