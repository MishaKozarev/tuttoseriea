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
  persisted_lineup_club_ids: string[];
};

type PlayerIdentityRow = {
  id: string;
  provider_player_id: number;
};

export type MatchLineupContext = {
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
  persistedLineupClubIds: string[];
};

export type MatchLineupRole = "starter" | "substitute";

export type InsertMatchLineupEntryInput = {
  role: MatchLineupRole;
  providerPlayerId: number | null;
  providerPlayerName: string | null;
  playerId: string | null;
  shirtNumber: number | null;
  providerPosition: string | null;
  grid: string | null;
  providerOrder: number;
  providerRaw: Record<string, unknown>;
};

export type ReplaceMatchLineupInput = {
  clubId: string;
  formation: string | null;
  providerCoachId: number | null;
  providerCoachName: string | null;
  providerCoachPhotoUrl: string | null;
  providerColors: Record<string, unknown> | null;
  providerRaw: Record<string, unknown>;
  entries: InsertMatchLineupEntryInput[];
};

export async function getCurrentSerieAMatchLineupContext(
  queryable: Queryable,
  matchId: string,
): Promise<MatchLineupContext | null> {
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
            select array_agg(ml.club_id order by ml.club_id)
            from football.match_lineups ml
            where ml.match_id = m.id
          ),
          array[]::text[]
        ) as persisted_lineup_club_ids
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
    persistedLineupClubIds: row.persisted_lineup_club_ids,
  };
}

export async function resolveApiFootballLineupPlayerIds(
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

export async function replaceMatchLineups(
  queryable: Queryable,
  matchId: string,
  lineups: readonly ReplaceMatchLineupInput[],
): Promise<void> {
  for (const lineup of lineups) {
    await queryable.query(
      "delete from football.match_lineups where match_id = $1 and club_id = $2",
      [matchId, lineup.clubId],
    );

    const lineupId = randomUUID();

    await queryable.query(
      `
        insert into football.match_lineups (
          id,
          match_id,
          club_id,
          formation,
          provider_coach_id,
          provider_coach_name,
          provider_coach_photo_url,
          provider_colors,
          provider_raw
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb)
      `,
      [
        lineupId,
        matchId,
        lineup.clubId,
        lineup.formation,
        lineup.providerCoachId,
        lineup.providerCoachName,
        lineup.providerCoachPhotoUrl,
        JSON.stringify(lineup.providerColors),
        JSON.stringify(lineup.providerRaw),
      ],
    );

    for (const entry of lineup.entries) {
      await queryable.query(
        `
          insert into football.match_lineup_entries (
            id,
            lineup_id,
            role,
            provider_player_id,
            provider_player_name,
            player_id,
            shirt_number,
            provider_position,
            grid,
            provider_order,
            provider_raw
          )
          values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb)
        `,
        [
          randomUUID(),
          lineupId,
          entry.role,
          entry.providerPlayerId,
          entry.providerPlayerName,
          entry.playerId,
          entry.shirtNumber,
          entry.providerPosition,
          entry.grid,
          entry.providerOrder,
          JSON.stringify(entry.providerRaw),
        ],
      );
    }
  }
}
