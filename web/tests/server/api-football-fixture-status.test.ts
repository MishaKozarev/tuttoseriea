import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  API_FOOTBALL_FIXTURE_STATUS_CODES,
  UnsupportedApiFootballFixtureStatusError,
  normalizeApiFootballFixtureStatus,
} from "@/src/football/api-football";

describe("API-Football fixture status normalization", () => {
  it("covers every known API-Football fixture status code", () => {
    expect.assertions(API_FOOTBALL_FIXTURE_STATUS_CODES.length);

    for (const code of API_FOOTBALL_FIXTURE_STATUS_CODES) {
      expect(normalizeApiFootballFixtureStatus(code).providerCode).toBe(code);
    }
  });

  it("keeps postponed and abandoned fixtures non-terminal for polling", () => {
    expect(normalizeApiFootballFixtureStatus("PST")).toMatchObject({
      pollingCategory: "WATCH",
      state: "postponed",
      terminal: false,
    });
    expect(normalizeApiFootballFixtureStatus("ABD")).toMatchObject({
      pollingCategory: "WATCH",
      state: "abandoned",
      terminal: false,
    });
  });

  it("marks normal final statuses as terminal", () => {
    for (const code of ["FT", "AET", "PEN", "CANC", "AWD", "WO"]) {
      expect(normalizeApiFootballFixtureStatus(code)).toMatchObject({
        pollingCategory: "TERMINAL",
        terminal: true,
      });
    }
  });

  it("does not silently map unknown statuses", () => {
    expect(() => normalizeApiFootballFixtureStatus("MYSTERY")).toThrow(
      UnsupportedApiFootballFixtureStatusError,
    );
  });
});
