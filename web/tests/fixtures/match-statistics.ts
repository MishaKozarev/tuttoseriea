export const MATCH_STATISTICS_MATCH_ID =
  "44444444-4444-4444-8444-444444444444";
export const MATCH_STATISTICS_PROVIDER_FIXTURE_ID = 1_550_114;
export const MATCH_STATISTICS_HOME_PROVIDER_CLUB_ID = 496;
export const MATCH_STATISTICS_AWAY_PROVIDER_CLUB_ID = 489;

export function createMatchStatistic(
  type: string,
  value: number | string | null,
  extra: Record<string, unknown> = {},
) {
  return { type, value, ...extra };
}

export function createMatchStatisticsTeam(
  providerTeamId: number,
  statistics: unknown[] = [
    createMatchStatistic("Shots on Goal", 4),
    createMatchStatistic("Ball Possession", "49%"),
    createMatchStatistic("expected_goals", "1.59"),
    createMatchStatistic("Blocked Shots", 0),
    createMatchStatistic("Corner Kicks", null),
  ],
  marker = "initial",
) {
  return {
    team: {
      id: providerTeamId,
      name: providerTeamId === MATCH_STATISTICS_HOME_PROVIDER_CLUB_ID
        ? "Juventus"
        : "AC Milan",
      logo: `https://media.api-sports.io/football/teams/${providerTeamId}.png`,
    },
    statistics,
    snapshot: { marker },
  };
}

export function createMatchStatisticsResponse(
  homeStatistics?: unknown[],
  awayStatistics: unknown[] = [
    createMatchStatistic("Shots on Goal", 3),
    createMatchStatistic("Ball Possession", "51%"),
    createMatchStatistic("expected_goals", 0.51),
    createMatchStatistic("Fouls", 12),
  ],
) {
  return [
    createMatchStatisticsTeam(
      MATCH_STATISTICS_HOME_PROVIDER_CLUB_ID,
      homeStatistics,
    ),
    createMatchStatisticsTeam(
      MATCH_STATISTICS_AWAY_PROVIDER_CLUB_ID,
      awayStatistics,
    ),
  ];
}
