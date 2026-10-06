export const MATCH_EVENTS_MATCH_ID = "11111111-1111-4111-8111-111111111111";
export const MATCH_EVENTS_PROVIDER_FIXTURE_ID = 1_550_114;
export const MATCH_EVENTS_HOME_PROVIDER_CLUB_ID = 496;
export const MATCH_EVENTS_AWAY_PROVIDER_CLUB_ID = 489;

export function createMatchEventsResponse() {
  return [
    {
      time: { elapsed: 46, extra: 2 },
      team: { id: MATCH_EVENTS_HOME_PROVIDER_CLUB_ID, name: "Juventus" },
      player: { id: 10_001, name: "Player Out" },
      assist: { id: 10_002, name: "Player In" },
      type: "subst",
      detail: "Substitution 1",
      comments: null,
      providerFutureField: { preserved: true },
    },
    {
      time: { elapsed: 60, extra: null },
      team: { id: MATCH_EVENTS_AWAY_PROVIDER_CLUB_ID, name: "AC Milan" },
      player: { id: 17, name: "C. Pulisic" },
      assist: { id: 10_003, name: "Assisting Player" },
      type: "Goal",
      detail: "Normal Goal",
      comments: "Goal confirmed after review",
    },
    {
      time: { elapsed: 90, extra: 6 },
      team: { id: MATCH_EVENTS_AWAY_PROVIDER_CLUB_ID, name: "AC Milan" },
      player: { id: 10_004, name: "Booked Player" },
      assist: null,
      type: "Card",
      detail: "Yellow Card",
      comments: null,
    },
  ];
}

export function createPreMatchEventResponse() {
  return [
    {
      time: { elapsed: -5, extra: null },
      team: { id: MATCH_EVENTS_HOME_PROVIDER_CLUB_ID, name: "Juventus" },
      player: { id: 31_137, name: "Stefano Sabelli" },
      assist: null,
      type: "Card",
      detail: "Yellow Card",
      comments: "Argument",
    },
  ];
}
