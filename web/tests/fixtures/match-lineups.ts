export const MATCH_LINEUPS_MATCH_ID = "11111111-1111-4111-8111-111111111111";
export const MATCH_LINEUPS_PROVIDER_FIXTURE_ID = 1_550_114;
export const MATCH_LINEUPS_HOME_PROVIDER_CLUB_ID = 496;
export const MATCH_LINEUPS_AWAY_PROVIDER_CLUB_ID = 489;

type PlayerOverrides = {
  grid?: string | null;
  name?: string | null;
  number?: number | null;
  pos?: string | null;
};

export function createMatchLineupPlayer(
  id: number | null,
  overrides: PlayerOverrides = {},
) {
  return {
    player: {
      id,
      name: overrides.name === undefined ? (id === null ? "Named Player" : `Player ${id}`) : overrides.name,
      number: overrides.number === undefined ? 10 : overrides.number,
      pos: overrides.pos === undefined ? "M" : overrides.pos,
      grid: overrides.grid === undefined ? "2:1" : overrides.grid,
      providerFutureField: { preserved: true },
    },
  };
}

type LineupOptions = {
  coachId?: number | null;
  formation?: string | null;
  starterCount?: number;
  substituteCount?: number;
};

export function createMatchLineup(
  providerClubId: number,
  options: LineupOptions = {},
) {
  const basePlayerId = providerClubId * 1_000;
  const starterCount = options.starterCount ?? 11;
  const substituteCount = options.substituteCount ?? 2;

  return {
    team: {
      id: providerClubId,
      name: `Team ${providerClubId}`,
      logo: `https://media.example.invalid/teams/${providerClubId}.png`,
      colors: {
        player: { primary: "ffffff", number: "000000", border: "ffffff" },
        goalkeeper: { primary: "000000", number: "ffffff", border: "000000" },
      },
    },
    coach: {
      id: options.coachId === undefined ? providerClubId + 10_000 : options.coachId,
      name: `Coach ${providerClubId}`,
      photo: `https://media.example.invalid/coaches/${providerClubId}.png`,
    },
    formation: options.formation === undefined ? "4-3-3" : options.formation,
    startXI: Array.from({ length: starterCount }, (_, index) =>
      createMatchLineupPlayer(basePlayerId + index + 1, {
        grid: `${Math.trunc(index / 4) + 1}:${(index % 4) + 1}`,
        number: index + 1,
      }),
    ),
    substitutes: Array.from({ length: substituteCount }, (_, index) =>
      createMatchLineupPlayer(basePlayerId + 100 + index + 1, {
        grid: null,
        number: index + 20,
      }),
    ),
    providerFutureField: { preserved: true },
  };
}

export function createMatchLineupsResponse() {
  return [
    createMatchLineup(MATCH_LINEUPS_HOME_PROVIDER_CLUB_ID),
    createMatchLineup(MATCH_LINEUPS_AWAY_PROVIDER_CLUB_ID),
  ];
}
