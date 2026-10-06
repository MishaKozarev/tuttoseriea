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

  it("renders ordered Events with independent Player resolution and exact fallbacks", () => {
    const data = matchPageFixture();

    render(
      <MatchPage
        data={{
          ...data,
          events: [
            {
              id: "event-pre-match-card",
              providerOrder: 0,
              elapsed: -5,
              extra: null,
              club: data.homeClub,
              player: {
                resolvedPlayerId: null,
                providerPlayerId: 31_137,
                displayName: "Stefano Sabelli",
                publicSlug: null,
              },
              relatedPlayer: {
                resolvedPlayerId: null,
                providerPlayerId: null,
                displayName: null,
                publicSlug: null,
              },
              providerType: "Card",
              providerDetail: "Yellow Card",
              comments: "Argument",
            },
            {
              id: "event-substitution",
              providerOrder: 1,
              elapsed: 68,
              extra: null,
              club: data.homeClub,
              player: {
                resolvedPlayerId: "player-out",
                providerPlayerId: 17,
                displayName: "Кристиан Пулишич",
                publicSlug: "c-pulisic-17",
              },
              relatedPlayer: {
                resolvedPlayerId: null,
                providerPlayerId: 18,
                displayName: "Incoming Player",
                publicSlug: null,
              },
              providerType: "subst",
              providerDetail: "Substitution 1",
              comments: null,
            },
            {
              id: "event-card",
              providerOrder: 2,
              elapsed: 75,
              extra: null,
              club: data.awayClub,
              player: {
                resolvedPlayerId: "player-card",
                providerPlayerId: 20,
                displayName: "Resolved Noneligible",
                publicSlug: null,
              },
              relatedPlayer: {
                resolvedPlayerId: null,
                providerPlayerId: null,
                displayName: null,
                publicSlug: null,
              },
              providerType: "Card",
              providerDetail: "Yellow Card",
              comments: "Provider comment",
            },
            {
              id: "event-goal",
              providerOrder: 3,
              elapsed: 90,
              extra: 6,
              club: data.homeClub,
              player: {
                resolvedPlayerId: null,
                providerPlayerId: 21,
                displayName: "Unresolved Scorer",
                publicSlug: null,
              },
              relatedPlayer: {
                resolvedPlayerId: "player-assist",
                providerPlayerId: 22,
                displayName: "Eligible Assistant",
                publicSlug: "eligible-assistant-22",
              },
              providerType: "Goal",
              providerDetail: "Normal Goal",
              comments: null,
            },
            {
              id: "event-unknown",
              providerOrder: 4,
              elapsed: 91,
              extra: null,
              club: data.awayClub,
              player: {
                resolvedPlayerId: null,
                providerPlayerId: null,
                displayName: null,
                publicSlug: null,
              },
              relatedPlayer: {
                resolvedPlayerId: null,
                providerPlayerId: null,
                displayName: null,
                publicSlug: null,
              },
              providerType: "Provider Event",
              providerDetail: "Provider Detail",
              comments: null,
            },
          ],
        }}
      />,
    );

    expect(screen.getByRole("heading", { name: "События матча" })).toBeTruthy();
    expect(screen.getByText("До матча")).toBeTruthy();
    expect(screen.queryByText("-5′")).toBeNull();
    expect(screen.getByText("68′")).toBeTruthy();
    expect(screen.getByText("90+6′")).toBeTruthy();
    expect(screen.getByText("Замена · Замена")).toBeTruthy();
    expect(screen.getAllByText("Карточка · Жёлтая карточка")).toHaveLength(2);
    expect(screen.getByText("Гол · Гол с игры")).toBeTruthy();
    expect(screen.getByText("Provider Event · Provider Detail")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Кристиан Пулишич" }).getAttribute("href"))
      .toBe("/players/c-pulisic-17");
    expect(screen.getByRole("link", { name: "Eligible Assistant" }).getAttribute("href"))
      .toBe("/players/eligible-assistant-22");
    expect(screen.getByText("Incoming Player").closest("a")).toBeNull();
    expect(screen.getByText("Resolved Noneligible").closest("a")).toBeNull();
    expect(screen.getByText("Unresolved Scorer").closest("a")).toBeNull();
    expect(screen.getByText("Provider comment")).toBeTruthy();
  });

  it("renders one persisted Team Lineup without interpreting grid, colors or freshness", () => {
    const data = matchPageFixture();

    render(
      <MatchPage
        data={{
          ...data,
          lineups: [
            {
              id: "lineup-home",
              club: data.homeClub,
              formation: "4-3-3",
              coachName: "Home Coach",
              starters: [
                {
                  id: "starter-1",
                  role: "starter",
                  providerOrder: 0,
                  shirtNumber: 11,
                  providerPosition: "M",
                  player: {
                    resolvedPlayerId: "player-17",
                    providerPlayerId: 17,
                    displayName: "Кристиан Пулишич",
                    publicSlug: "c-pulisic-17",
                  },
                },
                {
                  id: "starter-2",
                  role: "starter",
                  providerOrder: 1,
                  shirtNumber: 8,
                  providerPosition: "M",
                  player: {
                    resolvedPlayerId: "player-ineligible",
                    providerPlayerId: 19,
                    displayName: "Resolved Ineligible Starter",
                    publicSlug: null,
                  },
                },
              ],
              substitutes: [
                {
                  id: "substitute-1",
                  role: "substitute",
                  providerOrder: 0,
                  shirtNumber: null,
                  providerPosition: null,
                  player: {
                    resolvedPlayerId: null,
                    providerPlayerId: 18,
                    displayName: "Unresolved Substitute",
                    publicSlug: null,
                  },
                },
              ],
            },
          ],
        }}
      />,
    );

    expect(screen.getByRole("heading", { name: "Составы" })).toBeTruthy();
    expect(screen.getByText("Схема: 4-3-3 · Тренер: Home Coach")).toBeTruthy();
    expect(screen.getByText("Стартовый состав")).toBeTruthy();
    expect(screen.getByText("Запасные")).toBeTruthy();
    expect(screen.getAllByText("Полузащитник")).toHaveLength(2);
    expect(screen.getByText("Unresolved Substitute").closest("a")).toBeNull();
    expect(screen.getByText("Resolved Ineligible Starter").closest("a")).toBeNull();
    expect(screen.getAllByText("Данные отсутствуют.")).toHaveLength(1);
    expect(document.body.textContent).not.toMatch(/grid|color|обновлено|минут назад/iu);
  });

  it("renders independent Statistics lists without pairing or scalar coercion", () => {
    const data = matchPageFixture();

    render(
      <MatchPage
        data={{
          ...data,
          statistics: [
            {
              id: "statistics-home",
              club: data.homeClub,
              scope: "full_match",
              items: [
                {
                  id: "statistic-home-1",
                  providerOrder: 0,
                  providerType: "Shots on Goal",
                  providerValue: 0,
                },
                {
                  id: "statistic-home-2",
                  providerOrder: 1,
                  providerType: "Shots on Goal",
                  providerValue: null,
                },
                {
                  id: "statistic-home-3",
                  providerOrder: 2,
                  providerType: "Unknown Metric",
                  providerValue: "1.59",
                },
                {
                  id: "statistic-home-4",
                  providerOrder: 3,
                  providerType: "expected_goals",
                  providerValue: 0.51,
                },
              ],
            },
            {
              id: "statistics-away",
              club: data.awayClub,
              scope: "full_match",
              items: [
                {
                  id: "statistic-away-1",
                  providerOrder: 0,
                  providerType: "Ball Possession",
                  providerValue: "49%",
                },
              ],
            },
          ],
        }}
      />,
    );

    expect(screen.getByRole("heading", { name: "Статистика матча" })).toBeTruthy();
    expect(screen.getAllByText("Удары в створ")).toHaveLength(2);
    expect(screen.getByText("Владение мячом")).toBeTruthy();
    expect(screen.getByText("Unknown Metric")).toBeTruthy();
    expect(screen.getByText("0")).toBeTruthy();
    expect(screen.getByText("—")).toBeTruthy();
    expect(screen.getByText("1.59")).toBeTruthy();
    expect(screen.getByText("0.51")).toBeTruthy();
    expect(screen.getByText("49%")).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/обновлено|минут назад/iu);
  });

  it("keeps a one-Team Statistics snapshot visible with a neutral missing side", () => {
    const data = matchPageFixture();

    render(
      <MatchPage
        data={{
          ...data,
          statistics: [
            {
              id: "statistics-home",
              club: data.homeClub,
              scope: "full_match",
              items: [
                {
                  id: "statistic-home-1",
                  providerOrder: 0,
                  providerType: "Fouls",
                  providerValue: 12,
                },
              ],
            },
          ],
        }}
      />,
    );

    expect(screen.getByRole("heading", { name: "Статистика матча" })).toBeTruthy();
    expect(screen.getByText("Фолы")).toBeTruthy();
    expect(screen.getAllByText("Данные отсутствуют.")).toHaveLength(1);
  });

  it("renders nullable Lineup facts without interpreting missing provider values", () => {
    const data = matchPageFixture();

    render(
      <MatchPage
        data={{
          ...data,
          lineups: [
            {
              id: "lineup-home",
              club: data.homeClub,
              formation: null,
              coachName: null,
              starters: [],
              substitutes: [],
            },
            {
              id: "lineup-away",
              club: data.awayClub,
              formation: "3-5-2",
              coachName: "Away Coach",
              starters: [],
              substitutes: [],
            },
          ],
        }}
      />,
    );

    expect(screen.getByText("Схема не указана")).toBeTruthy();
    expect(screen.getByText("Схема: 3-5-2 · Тренер: Away Coach")).toBeTruthy();
    expect(screen.getAllByText("Данные отсутствуют.")).toHaveLength(4);
  });
});
