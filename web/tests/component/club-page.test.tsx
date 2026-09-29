// @vitest-environment jsdom

import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { ClubPage } from "@/components/football/club-page";
import { clubPageFixture } from "@/tests/fixtures/club-page";

afterEach(() => {
  cleanup();
});

describe("ClubPage", () => {
  it("renders the club profile, localized summaries, matches and current squad", () => {
    render(<ClubPage data={clubPageFixture()} />);

    expect(screen.getByRole("heading", { level: 1, name: "Милан" })).toBeTruthy();
    expect(screen.getByText("Serie A · 2026/27")).toBeTruthy();
    expect(screen.getByText("Италия")).toBeTruthy();
    expect(screen.getByText("Лига чемпионов")).toBeTruthy();
    expect(screen.getByText("ВВНПВ")).toBeTruthy();
    expect(screen.getByText(/28-й тур · Завершён/u)).toBeTruthy();
    expect(screen.getByText(/29-й тур · Не начался/u)).toBeTruthy();
    expect(screen.getByText("Полузащитник")).toBeTruthy();

    const playerRow = screen.getByRole("row", { name: /Игрок Один/u });
    expect(within(playerRow).getByText("25")).toBeTruthy();
    expect(within(playerRow).getByText("1940")).toBeTruthy();
    expect(within(playerRow).getByText("7.20")).toBeTruthy();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("renders every optional section independently when data is absent", () => {
    const data = clubPageFixture();

    render(
      <ClubPage
        data={{
          ...data,
          standing: null,
          recentMatches: [],
          upcomingMatches: [],
          squad: [],
        }}
      />,
    );

    expect(screen.getByText("Данные турнирной таблицы для клуба пока отсутствуют.")).toBeTruthy();
    expect(screen.getAllByText("Матчей в этой секции пока нет.")).toHaveLength(2);
    expect(screen.getByText("Текущий состав клуба пока не загружен.")).toBeTruthy();
  });

  it("keeps a current squad player visible when season statistics are absent", () => {
    render(<ClubPage data={clubPageFixture()} />);

    const playerRow = screen.getByRole("row", { name: /Player Two/u });
    expect(within(playerRow).getByText("Защитник")).toBeTruthy();
    expect(within(playerRow).getAllByText("—")).toHaveLength(7);
  });
});
