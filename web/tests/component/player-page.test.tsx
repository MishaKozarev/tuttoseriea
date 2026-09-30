// @vitest-environment jsdom

import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { PlayerPage } from "@/components/football/player-page";
import { playerPageFixture } from "@/tests/fixtures/player-page";

afterEach(() => {
  cleanup();
});

describe("PlayerPage", () => {
  it("renders localized profile data, every current membership and Club links", () => {
    render(<PlayerPage data={playerPageFixture()} />);

    expect(screen.getByRole("heading", { level: 1, name: "Рафаэл Леау" })).toBeTruthy();
    expect(screen.getByText("Serie A · 2026/27")).toBeTruthy();
    expect(screen.getByText("Portugal")).toBeTruthy();
    expect(screen.getByText("Нападающий")).toBeTruthy();
    expect(screen.getByText("Provider Position")).toBeTruthy();
    expect(screen.getAllByRole("link", { name: "Милан" })[0]?.getAttribute("href")).toBe(
      "/clubs/ac-milan-489",
    );
    expect(screen.getAllByRole("link", { name: "Inter" })[0]?.getAttribute("href")).toBe(
      "/clubs/inter-505",
    );
    expect(screen.queryByRole("link", { name: "Рафаэл Леау" })).toBeNull();
    expect(document.querySelector('a[href^="/matches/"]')).toBeNull();
    expect(document.querySelector('a[href^="/players/"]')).toBeNull();
  });

  it("keeps club-specific statistics separate without aggregate totals", () => {
    render(<PlayerPage data={playerPageFixture()} />);

    const sections = screen.getAllByRole("article");
    expect(sections).toHaveLength(2);
    expect(within(sections[0]).getByText("25")).toBeTruthy();
    expect(within(sections[0]).getByText("7.20")).toBeTruthy();
    expect(within(sections[1]).getAllByText("0").length).toBeGreaterThan(0);
    expect(within(sections[1]).getAllByText("—").length).toBeGreaterThan(0);
    expect(screen.queryByText(/итого/iu)).toBeNull();
  });

  it("shows independent empty states for current membership and statistics", () => {
    const data = playerPageFixture();

    render(<PlayerPage data={{ ...data, memberships: [], statistics: [] }} />);

    expect(
      screen.getByText("Текущий клуб игрока в составе Серии A не указан."),
    ).toBeTruthy();
    expect(
      screen.getByText("Статистика игрока за текущий сезон пока отсутствует."),
    ).toBeTruthy();
  });
});
