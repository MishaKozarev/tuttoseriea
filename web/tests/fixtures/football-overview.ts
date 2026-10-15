import type { FootballOverviewData } from "@/src/admin/football-overview-repository";

export function footballOverviewFixture(): FootballOverviewData {
  return {
    checkedAt: new Date("2026-10-15T12:00:00Z"),
    facts: {
      season_count: 1, clubs: 20, matches: 380, standings: 20,
      squad_clubs: 20, squad_memberships: 500, squad_players: 490,
      player_statistics: 520, statistics_players: 495, events: 0, lineups: 2, statistics: 2,
      observations: {
        foundation: { oldest: "2026-10-01T12:00:00Z", newest: "2026-10-01T12:00:00Z" },
        matches: { oldest: "2026-10-01T12:00:00Z", newest: "2026-10-15T11:00:00Z" },
        standings: { oldest: null, newest: null }, squads: { oldest: null, newest: null },
        "player-statistics": { oldest: null, newest: null }, events: { oldest: null, newest: null },
        lineups: { oldest: null, newest: null }, statistics: { oldest: null, newest: null },
      },
    },
    finishedMatches: [{ matchId: "finished-match", providerFixtureId: 1, statusChangedAt: null,
      eventsComplete: true, lineupsComplete: true, statisticsComplete: true }],
    jobs: [],
    recentExecutions: [],
  };
}
