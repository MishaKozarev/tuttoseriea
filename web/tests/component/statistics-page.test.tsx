// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { StatisticsPage } from "@/components/football/statistics-page";
import type {
  CurrentSerieAStatisticsPageData,
  RankedPlayerStatistic,
} from "@/src/football/statistics-page-repository";
import type { CurrentSerieAStanding } from "@/src/football/standings-repository";

afterEach(() => {
  cleanup();
});

const rankedPlayer: RankedPlayerStatistic = {
  player: {
    id: "player-1",
    providerPlayerId: 101,
    slug: "player-one-101",
    displayName: "Игрок Один",
  },
  clubs: [
    { id: "club-1", slug: "club-one-1", displayName: "Клуб Один" },
    { id: "club-2", slug: "club-two-2", displayName: "Club Two" },
  ],
  goals: 5,
  assists: 4,
  appearances: 8,
  minutes: 650,
  rank: 1,
  value: 5,
};

const standing: CurrentSerieAStanding = {
  id: "standing-1",
  clubId: "club-1",
  groupName: "Serie A",
  rank: 1,
  points: 10,
  goalsDiff: 4,
  form: "WWDW",
  providerStatus: "same",
  description: null,
  overall: { played: 4, wins: 3, draws: 1, losses: 0, goalsFor: 8, goalsAgainst: 4 },
  home: { played: 2, wins: 2, draws: 0, losses: 0, goalsFor: 5, goalsAgainst: 1 },
  away: { played: 2, wins: 1, draws: 1, losses: 0, goalsFor: 3, goalsAgainst: 3 },
  club: {
    slug: "club-one-1",
    displayName: "Клуб Один",
    code: "ONE",
    providerLogoUrl: null,
  },
};

const data: CurrentSerieAStatisticsPageData = {
  leaderboards: {
    goals: [rankedPlayer],
    assists: [{ ...rankedPlayer, value: 4 }],
    appearances: [{ ...rankedPlayer, value: 8 }],
    minutes: [{ ...rankedPlayer, value: 650 }],
  },
  standings: [standing],
};

describe("StatisticsPage", () => {
  it("renders player rankings with canonical Player and all contributing Club links", () => {
    render(<StatisticsPage data={data} />);

    expect(screen.getByRole("heading", { name: "Статистика Серии А" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Бомбардиры" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Ассисты" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Больше всего матчей" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Больше всего минут" })).toBeTruthy();

    expect(screen.getAllByRole("link", { name: "Игрок Один" })).toHaveLength(4);
    expect(
      screen
        .getAllByRole("link", { name: "Игрок Один" })
        .every((link) => link.getAttribute("href") === "/players/player-one-101"),
    ).toBe(true);
    expect(screen.getAllByRole("link", { name: "Клуб Один" })).toHaveLength(5);
    expect(screen.getAllByRole("link", { name: "Club Two" })).toHaveLength(4);
    expect(document.querySelector('a[href^="/matches/"]')).toBeNull();
    expect(screen.queryByText(/обновлено/i)).toBeNull();
    expect(screen.queryByText(/рейтинг/i)).toBeNull();
  });

  it("renders overall, home and away standings values", () => {
    render(<StatisticsPage data={data} />);

    expect(
      screen.getByRole("table", { name: "Статистика команд Серии А сезона 2026/27" }),
    ).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "Всего" })).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "Дома" })).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "В гостях" })).toBeTruthy();
    expect(screen.getByText("8:4")).toBeTruthy();
    expect(screen.getByText("5:1")).toBeTruthy();
    expect(screen.getByText("3:3")).toBeTruthy();
    expect(screen.getByText("+4")).toBeTruthy();
    expect(
      screen.getAllByRole("link", { name: "Клуб Один" })[4]?.getAttribute("href"),
    ).toBe("/clubs/club-one-1");
  });

  it("degrades every missing dataset independently", () => {
    render(
      <StatisticsPage
        data={{
          leaderboards: {
            goals: [],
            assists: [{ ...rankedPlayer, value: 4 }],
            appearances: [],
            minutes: [{ ...rankedPlayer, value: 650 }],
          },
          standings: [],
        }}
      />,
    );

    expect(screen.getByText("Данные о бомбардирах пока отсутствуют.")).toBeTruthy();
    expect(screen.getByText("Данные о сыгранных матчах пока отсутствуют.")).toBeTruthy();
    expect(screen.getByText("Статистика команд пока отсутствует.")).toBeTruthy();
    expect(screen.queryByText("Данные о голевых передачах пока отсутствуют.")).toBeNull();
    expect(screen.queryByText("Данные о сыгранных минутах пока отсутствуют.")).toBeNull();
  });
});
