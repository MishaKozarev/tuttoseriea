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

type ContextRow = {
  season_id: string;
  club_id: string;
  provider_club_id: number;
};

export type SerieAPlayerStatisticsContext = {
  seasonId: string;
  clubIdsByProviderId: Map<number, string>;
};

export type PlayerProfileInput = {
  providerPlayerId: number;
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

export type PlayerStatisticsValues = {
  appearances: number | null;
  lineups: number | null;
  minutes: number | null;
  shirtNumber: number | null;
  position: string | null;
  rating: string | null;
  captain: boolean | null;
  substitutesIn: number | null;
  substitutesOut: number | null;
  substitutesBench: number | null;
  shotsTotal: number | null;
  shotsOn: number | null;
  goalsTotal: number | null;
  goalsConceded: number | null;
  goalsAssists: number | null;
  passesTotal: number | null;
  passesKey: number | null;
  passesAccuracy: number | null;
  tacklesTotal: number | null;
  tacklesBlocks: number | null;
  tacklesInterceptions: number | null;
  duelsTotal: number | null;
  duelsWon: number | null;
  dribblesAttempts: number | null;
  dribblesSuccess: number | null;
  foulsDrawn: number | null;
  foulsCommitted: number | null;
  cardsYellow: number | null;
  cardsYellowRed: number | null;
  cardsRed: number | null;
  penaltyCommitted: number | null;
  penaltyScored: number | null;
  penaltyMissed: number | null;
};

export type UpsertPlayerStatisticsInput = PlayerStatisticsValues & {
  seasonId: string;
  clubId: string;
  playerId: string;
  playerRaw: Record<string, unknown>;
  statisticsRaw: Record<string, unknown>;
};

function firstId(rows: IdRow[], label: string): string {
  const id = rows[0]?.id;

  if (!id) {
    throw new Error(`${label} did not return an id`);
  }

  return id;
}

export async function getSerieAPlayerStatisticsContext(
  queryable: Queryable,
): Promise<SerieAPlayerStatisticsContext | null> {
  const result = await queryable.query<ContextRow>(
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
    clubIdsByProviderId: new Map(
      result.rows.map((row) => [row.provider_club_id, row.club_id]),
    ),
  };
}

export async function upsertPlayerProfile(
  queryable: Queryable,
  input: PlayerProfileInput,
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
            firstname,
            lastname,
            age,
            birth_date,
            birth_place,
            birth_country,
            nationality,
            height,
            weight,
            injured,
            provider_photo_url
          )
          values (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
            $11, $12, $13, $14, $15
          )
          on conflict (provider, provider_player_id)
          do update set
            provider_name = excluded.provider_name,
            firstname = excluded.firstname,
            lastname = excluded.lastname,
            age = excluded.age,
            birth_date = excluded.birth_date,
            birth_place = excluded.birth_place,
            birth_country = excluded.birth_country,
            nationality = excluded.nationality,
            height = excluded.height,
            weight = excluded.weight,
            injured = excluded.injured,
            provider_photo_url = excluded.provider_photo_url,
            updated_at = now()
          returning id
        `,
        [
          randomUUID(),
          API_FOOTBALL_PROVIDER,
          input.providerPlayerId,
          input.providerName,
          input.firstname,
          input.lastname,
          input.age,
          input.birthDate,
          input.birthPlace,
          input.birthCountry,
          input.nationality,
          input.height,
          input.weight,
          input.injured,
          input.providerPhotoUrl,
        ],
      )
    ).rows,
    "player profile upsert",
  );
}

export async function upsertPlayerStatistics(
  queryable: Queryable,
  input: UpsertPlayerStatisticsInput,
): Promise<string> {
  return firstId(
    (
      await queryable.query<IdRow>(
        `
          insert into football.player_statistics (
            id, season_id, club_id, player_id,
            appearances, lineups, minutes, shirt_number, position, rating, captain,
            substitutes_in, substitutes_out, substitutes_bench,
            shots_total, shots_on,
            goals_total, goals_conceded, goals_assists,
            passes_total, passes_key, passes_accuracy,
            tackles_total, tackles_blocks, tackles_interceptions,
            duels_total, duels_won,
            dribbles_attempts, dribbles_success,
            fouls_drawn, fouls_committed,
            cards_yellow, cards_yellow_red, cards_red,
            penalty_committed, penalty_scored, penalty_missed,
            player_raw, statistics_raw
          )
          values (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
            $11, $12, $13, $14, $15, $16, $17, $18, $19, $20,
            $21, $22, $23, $24, $25, $26, $27, $28, $29, $30,
            $31, $32, $33, $34, $35, $36, $37, $38::jsonb, $39::jsonb
          )
          on conflict (season_id, club_id, player_id)
          do update set
            appearances = excluded.appearances,
            lineups = excluded.lineups,
            minutes = excluded.minutes,
            shirt_number = excluded.shirt_number,
            position = excluded.position,
            rating = excluded.rating,
            captain = excluded.captain,
            substitutes_in = excluded.substitutes_in,
            substitutes_out = excluded.substitutes_out,
            substitutes_bench = excluded.substitutes_bench,
            shots_total = excluded.shots_total,
            shots_on = excluded.shots_on,
            goals_total = excluded.goals_total,
            goals_conceded = excluded.goals_conceded,
            goals_assists = excluded.goals_assists,
            passes_total = excluded.passes_total,
            passes_key = excluded.passes_key,
            passes_accuracy = excluded.passes_accuracy,
            tackles_total = excluded.tackles_total,
            tackles_blocks = excluded.tackles_blocks,
            tackles_interceptions = excluded.tackles_interceptions,
            duels_total = excluded.duels_total,
            duels_won = excluded.duels_won,
            dribbles_attempts = excluded.dribbles_attempts,
            dribbles_success = excluded.dribbles_success,
            fouls_drawn = excluded.fouls_drawn,
            fouls_committed = excluded.fouls_committed,
            cards_yellow = excluded.cards_yellow,
            cards_yellow_red = excluded.cards_yellow_red,
            cards_red = excluded.cards_red,
            penalty_committed = excluded.penalty_committed,
            penalty_scored = excluded.penalty_scored,
            penalty_missed = excluded.penalty_missed,
            player_raw = excluded.player_raw,
            statistics_raw = excluded.statistics_raw,
            updated_at = now()
          returning id
        `,
        [
          randomUUID(),
          input.seasonId,
          input.clubId,
          input.playerId,
          input.appearances,
          input.lineups,
          input.minutes,
          input.shirtNumber,
          input.position,
          input.rating,
          input.captain,
          input.substitutesIn,
          input.substitutesOut,
          input.substitutesBench,
          input.shotsTotal,
          input.shotsOn,
          input.goalsTotal,
          input.goalsConceded,
          input.goalsAssists,
          input.passesTotal,
          input.passesKey,
          input.passesAccuracy,
          input.tacklesTotal,
          input.tacklesBlocks,
          input.tacklesInterceptions,
          input.duelsTotal,
          input.duelsWon,
          input.dribblesAttempts,
          input.dribblesSuccess,
          input.foulsDrawn,
          input.foulsCommitted,
          input.cardsYellow,
          input.cardsYellowRed,
          input.cardsRed,
          input.penaltyCommitted,
          input.penaltyScored,
          input.penaltyMissed,
          JSON.stringify(input.playerRaw),
          JSON.stringify(input.statisticsRaw),
        ],
      )
    ).rows,
    "player statistics upsert",
  );
}

export async function deleteStalePlayerStatistics(
  queryable: Queryable,
  seasonId: string,
  currentIdentities: readonly { clubId: string; playerId: string }[],
): Promise<void> {
  const clubIds = currentIdentities.map((identity) => identity.clubId);
  const playerIds = currentIdentities.map((identity) => identity.playerId);

  await queryable.query(
    `
      delete from football.player_statistics ps
      where ps.season_id = $1
        and not exists (
          select 1
          from unnest($2::text[], $3::text[]) as snapshot(club_id, player_id)
          where snapshot.club_id = ps.club_id
            and snapshot.player_id = ps.player_id
        )
    `,
    [seasonId, clubIds, playerIds],
  );
}
