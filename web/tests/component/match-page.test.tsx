// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { MatchPage } from "@/components/football/match-page";
import { matchPageFixture } from "@/tests/fixtures/match-page";

afterEach(() => {
  cleanup();
});

describe("MatchPage", () => {
  it("renders the persisted base Match facts and canonical Club links", () => {
    render(<MatchPage data={matchPageFixture()} />);

    expect(screen.getByRole("heading", { level: 1, name: "Милан — Интер" })).toBeTruthy();
    expect(screen.getByText("Serie A · 2026/27")).toBeTruthy();
    expect(screen.getByText("12-й тур")).toBeTruthy();
    expect(screen.getByText("Завершён")).toBeTruthy();
    expect(screen.getByText("8 ноября 2026 г. в 20:45")).toBeTruthy();
    expect(screen.getByLabelText("Счёт 2:1")).toBeTruthy();
    expect(screen.getByText("San Siro")).toBeTruthy();
    expect(screen.getByText("Milano")).toBeTruthy();
    expect(screen.getByText("Marco Rossi")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Милан" }).getAttribute("href")).toBe(
      "/clubs/ac-milan-489",
    );
    expect(screen.getByRole("link", { name: "Интер" }).getAttribute("href")).toBe(
      "/clubs/inter-505",
    );
    expect(document.querySelector('a[href^="/players/"]')).toBeNull();
    expect(screen.queryByText(/событи/iu)).toBeNull();
    expect(screen.queryByText(/состав/iu)).toBeNull();
    expect(screen.queryByText(/владение/iu)).toBeNull();
  });

  it("shows live elapsed time without inventing unavailable scores or details", () => {
    const data = matchPageFixture();

    render(
      <MatchPage
        data={{
          ...data,
          match: {
            ...data.match,
            status: "live",
            providerStatusLong: "Second Half",
            providerStatusShort: "2H",
            statusElapsed: 67,
            statusExtra: 2,
            score: { home: null, away: null },
            halftimeScore: { home: null, away: null },
            fulltimeScore: { home: null, away: null },
            venueName: null,
            venueCity: null,
            referee: null,
          },
        }}
      />,
    );

    expect(screen.getByText("Идёт матч · 67+2'")).toBeTruthy();
    expect(screen.queryByLabelText(/^Счёт/u)).toBeNull();
    expect(screen.queryByRole("heading", { name: "Счёт по периодам" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Детали матча" })).toBeNull();
    expect(screen.queryByText("0:0")).toBeNull();
  });

  it.each([
    ["scheduled", "Not Started", "Не начался"],
    ["postponed", "Match Postponed", "Перенесён"],
    ["cancelled", "Match Cancelled", "Отменён"],
  ])(
    "renders the %s lifecycle without inventing a score",
    (status, providerStatusLong, expectedLabel) => {
      const data = matchPageFixture();

      render(
        <MatchPage
          data={{
            ...data,
            match: {
              ...data.match,
              status,
              providerStatusLong,
              providerStatusShort: "NS",
              kickoffAt: status === "scheduled" ? null : data.match.kickoffAt,
              statusElapsed: null,
              score: { home: null, away: null },
              halftimeScore: { home: null, away: null },
              fulltimeScore: { home: null, away: null },
            },
          }}
        />,
      );

      expect(screen.getByText(expectedLabel)).toBeTruthy();
      expect(screen.queryByLabelText(/^Счёт/u)).toBeNull();
      expect(screen.queryByText("0:0")).toBeNull();
      if (status === "scheduled") {
        expect(screen.getByText("Дата уточняется")).toBeTruthy();
      }
    },
  );
});
