// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { StandingsTable } from "@/components/football/standings-table";
import type { CurrentSerieAStanding } from "@/src/football/standings-repository";

afterEach(() => {
  cleanup();
});

const standing: CurrentSerieAStanding = {
  id: "standing-1",
  clubId: "club-1",
  groupName: "Serie A",
  rank: 1,
  points: 63,
  goalsDiff: 24,
  form: "WWDLW",
  providerStatus: "same",
  description: "Champions League",
  overall: { played: 25, wins: 19, draws: 6, losses: 0, goalsFor: 50, goalsAgainst: 26 },
  home: { played: 13, wins: 10, draws: 3, losses: 0, goalsFor: 30, goalsAgainst: 12 },
  away: { played: 12, wins: 9, draws: 3, losses: 0, goalsFor: 20, goalsAgainst: 14 },
  club: {
    displayName: "Милан",
    code: "MIL",
    providerLogoUrl: null,
  },
};

describe("StandingsTable", () => {
  it("renders an empty state before the first standings sync", () => {
    render(<StandingsTable standings={[]} />);

    expect(
      screen.getByText("Таблица появится после синхронизации текущего положения команд Серии А."),
    ).toBeTruthy();
  });

  it("renders the persisted current table without custom zone classification", () => {
    render(<StandingsTable standings={[standing]} />);

    expect(screen.getByRole("table", { name: "Таблица Серии А сезона 2026/27" })).toBeTruthy();
    expect(screen.getByText("Милан")).toBeTruthy();
    expect(screen.getByText("Лига чемпионов")).toBeTruthy();
    expect(screen.getByText("ВВНПВ")).toBeTruthy();
    expect(screen.getByText("50:26")).toBeTruthy();
    expect(screen.getByText("+24")).toBeTruthy();
    expect(screen.queryByRole("link")).toBeNull();
  });
});
