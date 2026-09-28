import { randomUUID } from "node:crypto";

import type { Pool, PoolClient } from "pg";

import {
  API_FOOTBALL_PROVIDER,
  SERIE_A_CURRENT_SEASON,
  SERIE_A_PROVIDER_LEAGUE_ID,
} from "./foundation";

type Queryable = Pick<Pool | PoolClient, "query">;

type IdRow = {
  id: string;
};

type SquadScopeRow = {
  season_id: string;
  club_id: string;
  provider_club_id: number;
};

export type SerieASquadClub = {
  clubId: string;
  providerClubId: number;
};

export type SerieASquadScope = {
  seasonId: string;
  clubs: SerieASquadClub[];
};

export type UpsertPlayerInput = {
  providerPlayerId: number;
  providerName: string;
  age: number | null;
  providerPhotoUrl: string | null;
};

export type UpsertSquadMembershipInput = {
  clubId: string;
  playerId: string;
  shirtNumber: number | null;
  position: string;
  providerRaw: Record<string, unknown>[];
};

function firstId(rows: IdRow[], label: string): string {
  const id = rows[0]?.id;

  if (!id) {
    throw new Error(`${label} did not return an id`);
  }

  return id;
}

export async function getSerieASquadScope(
  queryable: Queryable,
): Promise<SerieASquadScope | null> {
  const result = await queryable.query<SquadScopeRow>(
    `
      select
        s.id as season_id,
        c.id as club_id,
        c.provider_club_id
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
    clubs: result.rows.map((row) => ({
      clubId: row.club_id,
      providerClubId: row.provider_club_id,
    })),
  };
}

export async function upsertPlayer(
  queryable: Queryable,
  input: UpsertPlayerInput,
): Promise<string> {
  return firstId(
    (
      await queryable.query<IdRow>(
        `
          insert into football.players (
            id,
            provider,
            provider_player_id,
            provider_name,
            age,
            provider_photo_url
          )
          values ($1, $2, $3, $4, $5, $6)
          on conflict (provider, provider_player_id)
          do update set
            provider_name = excluded.provider_name,
            age = excluded.age,
            provider_photo_url = excluded.provider_photo_url,
            updated_at = now()
          returning id
        `,
        [
          randomUUID(),
          API_FOOTBALL_PROVIDER,
          input.providerPlayerId,
          input.providerName,
          input.age,
          input.providerPhotoUrl,
        ],
      )
    ).rows,
    "player upsert",
  );
}

export async function upsertSquadMembership(
  queryable: Queryable,
  input: UpsertSquadMembershipInput,
): Promise<string> {
  return firstId(
    (
      await queryable.query<IdRow>(
        `
          insert into football.squad_memberships (
            id,
            club_id,
            player_id,
            shirt_number,
            position,
            provider_raw
          )
          values ($1, $2, $3, $4, $5, $6::jsonb)
          on conflict (club_id, player_id)
          do update set
            shirt_number = excluded.shirt_number,
            position = excluded.position,
            provider_raw = excluded.provider_raw,
            updated_at = now()
          returning id
        `,
        [
          randomUUID(),
          input.clubId,
          input.playerId,
          input.shirtNumber,
          input.position,
          JSON.stringify(input.providerRaw),
        ],
      )
    ).rows,
    "squad membership upsert",
  );
}

export async function deleteStaleSquadMemberships(
  queryable: Queryable,
  clubId: string,
  currentPlayerIds: readonly string[],
): Promise<void> {
  if (currentPlayerIds.length === 0) {
    throw new Error("Current squad reconciliation requires at least one player id");
  }

  await queryable.query(
    `
      delete from football.squad_memberships
      where club_id = $1
        and not (player_id = any($2::text[]))
    `,
    [clubId, currentPlayerIds],
  );
}
