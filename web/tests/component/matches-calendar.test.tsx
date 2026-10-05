// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { MatchesCalendar } from "@/components/football/matches-calendar";
import type { CurrentSerieAMatch } from "@/src/football/matches-repository";

afterEach(() => {
  cleanup();
});

const match: CurrentSerieAMatch = {
  id: "match-1",
  slug: "ac-milan-inter-12345",
  providerFixtureId: 12345,
  round: "Regular Season - 1",
  kickoffAt: new Date("2026-08-22T18:45:00.000Z"),
  venueName: "San Siro",
  venueCity: "Milano",
  status: "scheduled",
  pollingCategory: "WATCH",
  providerStatusLong: "Not Started",
  providerStatusShort: "NS",
  statusElapsed: null,
  statusExtra: null,
  homeGoals: null,
  awayGoals: null,
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

describe("MatchesCalendar", () => {
  it("renders an empty state before the first matches sync", () => {
    render(<MatchesCalendar matches={[]} />);

    expect(
      screen.getByText(
        "Календарь появится после синхронизации матчей Серии А из сохранённых данных.",
      ),
    ).toBeTruthy();
  });

  it("links the fixture summary to its canonical Match Page without nested anchors", () => {
    const { container } = render(<MatchesCalendar matches={[match]} />);

    expect(screen.getByRole("heading", { name: "1-й тур" })).toBeTruthy();
    expect(screen.getByText("Милан")).toBeTruthy();
    expect(screen.getByText("Интер")).toBeTruthy();
    expect(screen.getByText("Не начался")).toBeTruthy();
    expect(screen.getByText("San Siro, Milano")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Милан" }).getAttribute("href")).toBe(
      "/clubs/ac-milan-489",
    );
    expect(screen.getByRole("link", { name: "Интер" }).getAttribute("href")).toBe(
      "/clubs/inter-505",
    );
    expect(
      container.querySelector('a[href="/matches/ac-milan-inter-12345"]'),
    ).toBeTruthy();
    expect(screen.getByText("Не начался").closest("a")?.getAttribute("href")).toBe(
      "/matches/ac-milan-inter-12345",
    );
    expect(container.querySelector("a a")).toBeNull();
  });

  it("uses normalized Russian status labels instead of provider English", () => {
    render(
      <MatchesCalendar
        matches={[
          {
            ...match,
            status: "suspended",
            providerStatusLong: "Match Suspended",
            providerStatusShort: "SUSP",
          },
        ]}
      />,
    );

    expect(screen.getByText("Приостановлен")).toBeTruthy();
    expect(screen.queryByText("Match Suspended")).toBeNull();
  });
});
