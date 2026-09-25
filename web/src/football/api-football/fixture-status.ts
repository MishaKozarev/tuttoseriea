export const API_FOOTBALL_FIXTURE_STATUS_CODES = [
  "TBD",
  "NS",
  "1H",
  "HT",
  "2H",
  "ET",
  "BT",
  "P",
  "SUSP",
  "INT",
  "LIVE",
  "FT",
  "AET",
  "PEN",
  "PST",
  "CANC",
  "ABD",
  "AWD",
  "WO",
] as const;

export type ApiFootballFixtureStatusCode =
  (typeof API_FOOTBALL_FIXTURE_STATUS_CODES)[number];

export type NormalizedFixtureState =
  | "scheduled"
  | "live"
  | "paused"
  | "suspended"
  | "interrupted"
  | "postponed"
  | "abandoned"
  | "finished"
  | "cancelled"
  | "awarded"
  | "walkover";

export type FixturePollingCategory = "ACTIVE" | "WATCH" | "TERMINAL";

export type NormalizedFixtureStatus = {
  providerCode: ApiFootballFixtureStatusCode;
  state: NormalizedFixtureState;
  pollingCategory: FixturePollingCategory;
  terminal: boolean;
};

export class UnsupportedApiFootballFixtureStatusError extends Error {
  readonly code = "unsupported_fixture_status";

  constructor(providerCode: string) {
    super(`Unsupported API-Football fixture status: ${providerCode}`);
    this.name = "UnsupportedApiFootballFixtureStatusError";
  }
}

const fixtureStatusMap = {
  TBD: { state: "scheduled", pollingCategory: "WATCH", terminal: false },
  NS: { state: "scheduled", pollingCategory: "WATCH", terminal: false },
  "1H": { state: "live", pollingCategory: "ACTIVE", terminal: false },
  HT: { state: "paused", pollingCategory: "WATCH", terminal: false },
  "2H": { state: "live", pollingCategory: "ACTIVE", terminal: false },
  ET: { state: "live", pollingCategory: "ACTIVE", terminal: false },
  BT: { state: "paused", pollingCategory: "WATCH", terminal: false },
  P: { state: "live", pollingCategory: "ACTIVE", terminal: false },
  SUSP: { state: "suspended", pollingCategory: "WATCH", terminal: false },
  INT: { state: "interrupted", pollingCategory: "WATCH", terminal: false },
  LIVE: { state: "live", pollingCategory: "ACTIVE", terminal: false },
  FT: { state: "finished", pollingCategory: "TERMINAL", terminal: true },
  AET: { state: "finished", pollingCategory: "TERMINAL", terminal: true },
  PEN: { state: "finished", pollingCategory: "TERMINAL", terminal: true },
  PST: { state: "postponed", pollingCategory: "WATCH", terminal: false },
  CANC: { state: "cancelled", pollingCategory: "TERMINAL", terminal: true },
  ABD: { state: "abandoned", pollingCategory: "WATCH", terminal: false },
  AWD: { state: "awarded", pollingCategory: "TERMINAL", terminal: true },
  WO: { state: "walkover", pollingCategory: "TERMINAL", terminal: true },
} satisfies Record<
  ApiFootballFixtureStatusCode,
  Omit<NormalizedFixtureStatus, "providerCode">
>;

export function normalizeApiFootballFixtureStatus(
  providerCode: string,
): NormalizedFixtureStatus {
  if (!Object.hasOwn(fixtureStatusMap, providerCode)) {
    throw new UnsupportedApiFootballFixtureStatusError(providerCode);
  }

  const code = providerCode as ApiFootballFixtureStatusCode;

  return {
    providerCode: code,
    ...fixtureStatusMap[code],
  };
}
