export const API_FOOTBALL_PROVIDER = "api-football";
export const SERIE_A_PROVIDER_LEAGUE_ID = 135;
export const SERIE_A_CURRENT_SEASON = 2026;
export const SERIE_A_SLUG = "serie-a";
export const SERIE_A_CURRENT_SEASON_LABEL = "2026/27";
export const SERIE_A_EXPECTED_CURRENT_CLUBS = 20;
export const SERIE_A_EXPECTED_CURRENT_MATCHES = 380;
export const SERIE_A_EXPECTED_CURRENT_STANDINGS_ROWS = 20;

export const SERIE_A_FOUNDATION_JOB_TYPE = "football.sync-serie-a-foundation";
export const SERIE_A_FOUNDATION_IDEMPOTENCY_KEY =
  "api-football:league:135:season:2026:foundation";

export const SERIE_A_MATCHES_JOB_TYPE = "football.sync-serie-a-matches";
export const SERIE_A_MATCHES_IDEMPOTENCY_KEY =
  "api-football:league:135:season:2026:matches";

export const SERIE_A_STANDINGS_JOB_TYPE = "football.sync-serie-a-standings";
export const SERIE_A_STANDINGS_IDEMPOTENCY_KEY =
  "api-football:league:135:season:2026:standings";

export const SERIE_A_SQUADS_JOB_TYPE = "football.sync-serie-a-squads";
export const SERIE_A_SQUADS_IDEMPOTENCY_KEY =
  "api-football:league:135:season:2026:squads";

export const SERIE_A_PLAYER_STATISTICS_JOB_TYPE =
  "football.sync-serie-a-player-statistics";
export const SERIE_A_PLAYER_STATISTICS_IDEMPOTENCY_KEY =
  "api-football:league:135:season:2026:player-statistics";

export const SERIE_A_MATCH_EVENTS_JOB_TYPE =
  "football.sync-serie-a-match-events";

export function createSerieAMatchEventsIdempotencyKey(matchId: string): string {
  return `api-football:league:135:season:2026:match:${matchId}:events`;
}

export const SERIE_A_MATCH_LINEUPS_JOB_TYPE =
  "football.sync-serie-a-match-lineups";

export function createSerieAMatchLineupsIdempotencyKey(matchId: string): string {
  return `api-football:league:135:season:2026:match:${matchId}:lineups`;
}

export const SERIE_A_MATCH_STATISTICS_JOB_TYPE =
  "football.sync-serie-a-match-statistics";

export function createSerieAMatchStatisticsIdempotencyKey(
  matchId: string,
): string {
  return `api-football:league:135:season:2026:match:${matchId}:statistics`;
}
