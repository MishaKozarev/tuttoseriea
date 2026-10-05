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
  season_id: string;
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
  home_id: string;
  home_slug: string;
  home_provider_name: string;
  home_name_ru: string | null;
  home_name_ru_review_status: string | null;
  home_code: string | null;
  home_logo_url: string | null;
  away_id: string;
  away_slug: string;
  away_provider_name: string;
  away_name_ru: string | null;
  away_name_ru_review_status: string | null;
  away_code: string | null;
  away_logo_url: string | null;
};

type MatchPageEventRow = {
  event_id: string;
  provider_order: number;
  elapsed: number;
  extra: number | null;
  club_id: string;
  provider_player_id: number | null;
  provider_player_name: string | null;
  player_id: string | null;
  player_slug: string | null;
  player_provider_name: string | null;
  player_name_ru: string | null;
  player_name_ru_review_status: string | null;
  provider_related_player_id: number | null;
  provider_related_player_name: string | null;
  related_player_id: string | null;
  related_player_slug: string | null;
  related_player_provider_name: string | null;
  related_player_name_ru: string | null;
  related_player_name_ru_review_status: string | null;
  provider_type: string;
  provider_detail: string;
  comments: string | null;
};

type MatchPageLineupRow = {
  lineup_id: string;
  club_id: string;
  formation: string | null;
  provider_coach_name: string | null;
  entry_id: string | null;
  role: MatchPageLineupRole | null;
  provider_order: number | null;
  provider_player_id: number | null;
  provider_player_name: string | null;
  player_id: string | null;
  player_slug: string | null;
  player_provider_name: string | null;
  player_name_ru: string | null;
  player_name_ru_review_status: string | null;
  shirt_number: number | null;
  provider_position: string | null;
};

type MatchPageStatisticRow = {
  statistics_id: string;
  club_id: string;
  scope: "full_match";
  item_id: string | null;
  provider_type: string | null;
  provider_value: number | string | null;
  provider_order: number | null;
};

type SlugRow = {
  slug: string;
};

export type MatchPageClub = {
  id: string;
  slug: string;
  displayName: string;
  code: string | null;
  providerLogoUrl: string | null;
};

export type MatchPageScore = {
  home: number | null;
  away: number | null;
};

export type MatchPagePlayerIdentity = {
  resolvedPlayerId: string | null;
  providerPlayerId: number | null;
  displayName: string | null;
  publicSlug: string | null;
};

export type MatchPageEvent = {
  id: string;
  providerOrder: number;
  elapsed: number;
  extra: number | null;
  club: MatchPageClub;
  player: MatchPagePlayerIdentity;
  relatedPlayer: MatchPagePlayerIdentity;
  providerType: string;
  providerDetail: string;
  comments: string | null;
};

export type MatchPageLineupRole = "starter" | "substitute";

export type MatchPageLineupEntry = {
  id: string;
  role: MatchPageLineupRole;
  providerOrder: number;
  shirtNumber: number | null;
  providerPosition: string | null;
  player: MatchPagePlayerIdentity;
};

export type MatchPageLineup = {
  id: string;
  club: MatchPageClub;
  formation: string | null;
  coachName: string | null;
  starters: MatchPageLineupEntry[];
  substitutes: MatchPageLineupEntry[];
};

export type MatchPageStatisticItem = {
  id: string;
  providerOrder: number;
  providerType: string;
  providerValue: number | string | null;
};

export type MatchPageStatistics = {
  id: string;
  club: MatchPageClub;
  scope: "full_match";
  items: MatchPageStatisticItem[];
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
    id: string;
    displayLabel: string;
  };
  homeClub: MatchPageClub;
  awayClub: MatchPageClub;
  events: MatchPageEvent[];
  lineups: MatchPageLineup[];
  statistics: MatchPageStatistics[];
};

function resolveClub(row: MatchPageRow, side: "home" | "away"): MatchPageClub {
  return {
    id: row[`${side}_id`],
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

function resolvePlayerIdentity(input: {
  providerPlayerId: number | null;
  providerPlayerName: string | null;
  playerId: string | null;
  publicSlug: string | null;
  playerProviderName: string | null;
  playerNameRu: string | null;
  playerNameRuReviewStatus: string | null;
}): MatchPagePlayerIdentity {
  return {
    resolvedPlayerId: input.playerId,
    providerPlayerId: input.providerPlayerId,
    displayName:
      input.playerId !== null && input.playerProviderName !== null
        ? resolveFootballProperName({
            providerName: input.playerProviderName,
            nameRu: input.playerNameRu,
            reviewStatus: input.playerNameRuReviewStatus,
          })
        : input.providerPlayerName,
    publicSlug: input.playerId === null ? null : input.publicSlug,
  };
}

async function listMatchPageEvents(
  queryable: Queryable,
  matchId: string,
  seasonId: string,
  clubsById: ReadonlyMap<string, MatchPageClub>,
): Promise<MatchPageEvent[]> {
  const result = await queryable.query<MatchPageEventRow>(
    `
      with eligible_players as (
        select sm.player_id
        from football.squad_memberships sm
        join football.season_clubs sc
          on sc.club_id = sm.club_id
          and sc.season_id = $2
        union
        select ps.player_id
        from football.player_statistics ps
        where ps.season_id = $2
      )
      select
        me.id as event_id,
        me.provider_order,
        me.elapsed,
        me.extra,
        me.club_id,
        me.provider_player_id,
        me.provider_player_name,
        player.id as player_id,
        case
          when player.provider = $3 and player_eligibility.player_id is not null
          then player.slug
        end as player_slug,
        player.provider_name as player_provider_name,
        player.name_ru as player_name_ru,
        player.name_ru_review_status as player_name_ru_review_status,
        me.provider_related_player_id,
        me.provider_related_player_name,
        related_player.id as related_player_id,
        case
          when related_player.provider = $3
            and related_player_eligibility.player_id is not null
          then related_player.slug
        end as related_player_slug,
        related_player.provider_name as related_player_provider_name,
        related_player.name_ru as related_player_name_ru,
        related_player.name_ru_review_status as related_player_name_ru_review_status,
        me.provider_type,
        me.provider_detail,
        me.comments
      from football.match_events me
      left join football.players player on player.id = me.player_id
      left join eligible_players player_eligibility
        on player_eligibility.player_id = player.id
      left join football.players related_player on related_player.id = me.related_player_id
      left join eligible_players related_player_eligibility
        on related_player_eligibility.player_id = related_player.id
      where me.match_id = $1
      order by me.provider_order
    `,
    [matchId, seasonId, API_FOOTBALL_PROVIDER],
  );

  return result.rows.map((row) => {
    const club = clubsById.get(row.club_id);

    if (!club) {
      throw new Error(`Match Event references unexpected Club ${row.club_id}`);
    }

    return {
      id: row.event_id,
      providerOrder: row.provider_order,
      elapsed: row.elapsed,
      extra: row.extra,
      club,
      player: resolvePlayerIdentity({
        providerPlayerId: row.provider_player_id,
        providerPlayerName: row.provider_player_name,
        playerId: row.player_id,
        publicSlug: row.player_slug,
        playerProviderName: row.player_provider_name,
        playerNameRu: row.player_name_ru,
        playerNameRuReviewStatus: row.player_name_ru_review_status,
      }),
      relatedPlayer: resolvePlayerIdentity({
        providerPlayerId: row.provider_related_player_id,
        providerPlayerName: row.provider_related_player_name,
        playerId: row.related_player_id,
        publicSlug: row.related_player_slug,
        playerProviderName: row.related_player_provider_name,
        playerNameRu: row.related_player_name_ru,
        playerNameRuReviewStatus: row.related_player_name_ru_review_status,
      }),
      providerType: row.provider_type,
      providerDetail: row.provider_detail,
      comments: row.comments,
    };
  });
}

async function listMatchPageLineups(
  queryable: Queryable,
  matchId: string,
  seasonId: string,
  clubsById: ReadonlyMap<string, MatchPageClub>,
  clubOrder: readonly string[],
): Promise<MatchPageLineup[]> {
  const result = await queryable.query<MatchPageLineupRow>(
    `
      with eligible_players as (
        select sm.player_id
        from football.squad_memberships sm
        join football.season_clubs sc
          on sc.club_id = sm.club_id
          and sc.season_id = $2
        union
        select ps.player_id
        from football.player_statistics ps
        where ps.season_id = $2
      )
      select
        ml.id as lineup_id,
        ml.club_id,
        ml.formation,
        ml.provider_coach_name,
        entry.id as entry_id,
        entry.role,
        entry.provider_order,
        entry.provider_player_id,
        entry.provider_player_name,
        player.id as player_id,
        case
          when player.provider = $3 and player_eligibility.player_id is not null
          then player.slug
        end as player_slug,
        player.provider_name as player_provider_name,
        player.name_ru as player_name_ru,
        player.name_ru_review_status as player_name_ru_review_status,
        entry.shirt_number,
        entry.provider_position
      from football.match_lineups ml
      left join football.match_lineup_entries entry on entry.lineup_id = ml.id
      left join football.players player on player.id = entry.player_id
      left join eligible_players player_eligibility
        on player_eligibility.player_id = player.id
      where ml.match_id = $1
      order by
        ml.club_id,
        case entry.role when 'starter' then 0 when 'substitute' then 1 else 2 end,
        entry.provider_order
    `,
    [matchId, seasonId, API_FOOTBALL_PROVIDER],
  );
  const lineupsByClubId = new Map<string, MatchPageLineup>();

  for (const row of result.rows) {
    const club = clubsById.get(row.club_id);

    if (!club) {
      throw new Error(`Match Lineup references unexpected Club ${row.club_id}`);
    }

    let lineup = lineupsByClubId.get(row.club_id);

    if (!lineup) {
      lineup = {
        id: row.lineup_id,
        club,
        formation: row.formation,
        coachName: row.provider_coach_name,
        starters: [],
        substitutes: [],
      };
      lineupsByClubId.set(row.club_id, lineup);
    }

    if (row.entry_id === null || row.role === null || row.provider_order === null) {
      continue;
    }

    const entry: MatchPageLineupEntry = {
      id: row.entry_id,
      role: row.role,
      providerOrder: row.provider_order,
      shirtNumber: row.shirt_number,
      providerPosition: row.provider_position,
      player: resolvePlayerIdentity({
        providerPlayerId: row.provider_player_id,
        providerPlayerName: row.provider_player_name,
        playerId: row.player_id,
        publicSlug: row.player_slug,
        playerProviderName: row.player_provider_name,
        playerNameRu: row.player_name_ru,
        playerNameRuReviewStatus: row.player_name_ru_review_status,
      }),
    };

    if (entry.role === "starter") {
      lineup.starters.push(entry);
    } else {
      lineup.substitutes.push(entry);
    }
  }

  return clubOrder.flatMap((clubId) => {
    const lineup = lineupsByClubId.get(clubId);
    return lineup ? [lineup] : [];
  });
}

async function listMatchPageStatistics(
  queryable: Queryable,
  matchId: string,
  clubsById: ReadonlyMap<string, MatchPageClub>,
  clubOrder: readonly string[],
): Promise<MatchPageStatistics[]> {
  const result = await queryable.query<MatchPageStatisticRow>(
    `
      select
        statistics.id as statistics_id,
        statistics.club_id,
        statistics.scope,
        item.id as item_id,
        item.provider_type,
        item.provider_value,
        item.provider_order
      from football.match_statistics statistics
      left join football.match_statistic_items item
        on item.match_statistics_id = statistics.id
      where statistics.match_id = $1
        and statistics.scope = 'full_match'
      order by statistics.club_id, item.provider_order
    `,
    [matchId],
  );
  const statisticsByClubId = new Map<string, MatchPageStatistics>();

  for (const row of result.rows) {
    const club = clubsById.get(row.club_id);

    if (!club) {
      throw new Error(`Match Statistics reference unexpected Club ${row.club_id}`);
    }

    let statistics = statisticsByClubId.get(row.club_id);

    if (!statistics) {
      statistics = {
        id: row.statistics_id,
        club,
        scope: row.scope,
        items: [],
      };
      statisticsByClubId.set(row.club_id, statistics);
    }

    if (
      row.item_id === null ||
      row.provider_type === null ||
      row.provider_order === null
    ) {
      continue;
    }

    statistics.items.push({
      id: row.item_id,
      providerOrder: row.provider_order,
      providerType: row.provider_type,
      providerValue: row.provider_value,
    });
  }

  return clubOrder.flatMap((clubId) => {
    const statistics = statisticsByClubId.get(clubId);
    return statistics ? [statistics] : [];
  });
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
        s.id as season_id,
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
        home.id as home_id,
        home.slug as home_slug,
        home.provider_name as home_provider_name,
        home.name_ru as home_name_ru,
        home.name_ru_review_status as home_name_ru_review_status,
        home.code as home_code,
        home.provider_logo_url as home_logo_url,
        away.id as away_id,
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

  const homeClub = resolveClub(row, "home");
  const awayClub = resolveClub(row, "away");
  const clubOrder = [homeClub.id, awayClub.id] as const;
  const clubsById = new Map(clubOrder.map((clubId) => [
    clubId,
    clubId === homeClub.id ? homeClub : awayClub,
  ]));
  const events = await listMatchPageEvents(
    queryable,
    row.id,
    row.season_id,
    clubsById,
  );
  const lineups = await listMatchPageLineups(
    queryable,
    row.id,
    row.season_id,
    clubsById,
    clubOrder,
  );
  const statistics = await listMatchPageStatistics(
    queryable,
    row.id,
    clubsById,
    clubOrder,
  );

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
      id: row.season_id,
      displayLabel: row.season_display_label,
    },
    homeClub,
    awayClub,
    events,
    lineups,
    statistics,
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
