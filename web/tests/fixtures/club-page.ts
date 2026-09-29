import type { CurrentSerieAClubPageData } from "@/src/football/club-page-repository";

export function clubPageFixture(): CurrentSerieAClubPageData {
  return {
    club: {
      id: "club-1",
      slug: "ac-milan-489",
      displayName: "Милан",
      providerName: "AC Milan",
      code: "MIL",
      country: "Italy",
      founded: 1899,
      providerLogoUrl: null,
    },
    competition: {
      displayName: "Serie A",
    },
    season: {
      id: "season-2026",
      displayLabel: "2026/27",
    },
    standing: {
      rank: 2,
      points: 61,
      goalsDiff: 21,
      form: "WWDLW",
      description: "Champions League league stage",
      played: 28,
      wins: 18,
      draws: 7,
      losses: 3,
      goalsFor: 52,
      goalsAgainst: 31,
    },
    recentMatches: [
      {
        id: "match-recent",
        providerFixtureId: 1001,
        round: "Regular Season - 28",
        kickoffAt: new Date("2027-03-14T19:45:00.000Z"),
        status: "finished",
        providerStatusLong: "Match Finished",
        providerStatusShort: "FT",
        statusElapsed: 90,
        statusExtra: null,
        homeGoals: 2,
        awayGoals: 1,
        homeClub: {
          displayName: "Милан",
          code: "MIL",
          providerLogoUrl: null,
        },
        awayClub: {
          displayName: "Интер",
          code: "INT",
          providerLogoUrl: null,
        },
      },
    ],
    upcomingMatches: [
      {
        id: "match-upcoming",
        providerFixtureId: 1002,
        round: "Regular Season - 29",
        kickoffAt: new Date("2027-03-21T19:45:00.000Z"),
        status: "scheduled",
        providerStatusLong: "Not Started",
        providerStatusShort: "NS",
        statusElapsed: null,
        statusExtra: null,
        homeGoals: null,
        awayGoals: null,
        homeClub: {
          displayName: "Ювентус",
          code: "JUV",
          providerLogoUrl: null,
        },
        awayClub: {
          displayName: "Милан",
          code: "MIL",
          providerLogoUrl: null,
        },
      },
    ],
    squad: [
      {
        membershipId: "membership-1",
        playerId: "player-1",
        displayName: "Игрок Один",
        providerPhotoUrl: null,
        shirtNumber: 10,
        position: "Midfielder",
        statistics: {
          appearances: 25,
          lineups: 22,
          minutes: 1940,
          goals: 8,
          assists: 6,
          rating: "7.20",
        },
      },
      {
        membershipId: "membership-2",
        playerId: "player-2",
        displayName: "Player Two",
        providerPhotoUrl: null,
        shirtNumber: null,
        position: "Defender",
        statistics: null,
      },
    ],
  };
}
