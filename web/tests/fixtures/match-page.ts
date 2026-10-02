import type { CurrentSerieAMatchPageData } from "@/src/football/match-page-repository";

export function matchPageFixture(): CurrentSerieAMatchPageData {
  return {
    match: {
      id: "match-1",
      slug: "ac-milan-inter-12345",
      providerFixtureId: 12345,
      round: "Regular Season - 12",
      kickoffAt: new Date("2026-11-08T19:45:00.000Z"),
      status: "finished",
      providerStatusLong: "Match Finished",
      providerStatusShort: "FT",
      statusElapsed: 90,
      statusExtra: null,
      score: { home: 2, away: 1 },
      halftimeScore: { home: 1, away: 0 },
      fulltimeScore: { home: 2, away: 1 },
      extratimeScore: { home: null, away: null },
      penaltyScore: { home: null, away: null },
      venueName: "San Siro",
      venueCity: "Milano",
      referee: "Marco Rossi",
    },
    competition: {
      displayName: "Serie A",
    },
    season: {
      displayLabel: "2026/27",
    },
    homeClub: {
      slug: "ac-milan-489",
      displayName: "Милан",
      code: "MIL",
      providerLogoUrl: null,
    },
    awayClub: {
      slug: "inter-505",
      displayName: "Интер",
      code: "INT",
      providerLogoUrl: null,
    },
  };
}
