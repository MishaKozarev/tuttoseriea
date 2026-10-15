// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("@/components/admin/football-synchronization", () => ({ FootballSynchronization: ({ actorAccountId, matchScope }: { actorAccountId: string; matchScope: { id: string } }) => <div data-testid="match-jobs">{actorAccountId}:{matchScope.id}</div> }));
import { FootballData, MatchDatasets } from "@/components/admin/football-data";
import { parseFootballDataQuery } from "@/src/admin/football-data";
import { clubPageFixture } from "../fixtures/club-page";
import { matchPageFixture } from "../fixtures/match-page";
import { synchronizationMatchId } from "../fixtures/football-synchronization";
afterEach(cleanup);
const checkedAt = new Date("2026-10-15T12:00:00Z");
const evidence = { eventRows: 0, eventsSucceededAt: null, lineups: [], statistics: [] };

describe("Football Data views", () => {
  it("keeps absence distinct from a confirmed zero-row Events snapshot", () => {
    const props = { home: { id: "home", displayName: "Милан" }, away: { id: "away", displayName: "Интер" } };
    const view = render(<MatchDatasets {...props} evidence={evidence} />);
    expect(screen.getByText("Данные отсутствуют; подтверждения пустого snapshot нет.")).toBeTruthy();
    view.rerender(<MatchDatasets {...props} evidence={{ ...evidence, eventsSucceededAt: checkedAt }} />);
    expect(screen.getByText(/Подтверждённый zero-row snapshot/)).toBeTruthy();
    expect(screen.getByText(/Время наблюдения Events не хранится/).textContent).toContain("UTC");
    expect(screen.getByText(/Доступность у provider и свежесть относительно provider неизвестны/)).toBeTruthy();
  });
  it("shows one-sided and two-sided Team snapshots with separate observation times", () => {
    render(<MatchDatasets home={{ id: "home", displayName: "Милан" }} away={{ id: "away", displayName: "Интер" }} evidence={{ ...evidence,
      lineups: [{ clubId: "home", observedAt: "2026-10-15T12:00:00Z" }], statistics: [{ clubId: "home", observedAt: "2026-10-15T12:00:00Z" }, { clubId: "away", observedAt: "2026-10-14T12:00:00Z" }] }} />);
    expect(screen.getByText(/Частичные данные: 1 из 2/)).toBeTruthy(); expect(screen.getByText(/Подтверждено наличие обеих/)).toBeTruthy();
    expect(screen.getByText("Интер: Нет сведений")).toBeTruthy(); expect(screen.getByText(/Интер:.*UTC/)).toBeTruthy();
  });
  it("reuses club data and links existing public routes without provider images or mutations", () => {
    const detail = clubPageFixture();
    const fetch = vi.spyOn(globalThis, "fetch");
    render(<FootballData actorAccountId="actor" filter={parseFootballDataQuery({ id: detail.club.id })} data={{ view: "clubs", checkedAt,
      page: { items: [{ ...detail.club, nameRu: null }], total: 1, page: 1, totalPages: 1 }, detail }} />);
    expect(screen.getByRole("link", { name: "Публичная страница клуба" }).getAttribute("href")).toBe(`/clubs/${detail.club.slug}`);
    expect(screen.getByRole("region", { name: "Данные клуба" }).textContent).toContain("1899");
    expect(screen.queryByRole("img")).toBeNull(); expect(fetch).not.toHaveBeenCalled(); fetch.mockRestore();
  });
  it("shows Match facts, snapshot caveats and the immutable canonical UUID to existing job UI", () => {
    const detail = matchPageFixture(); detail.match.id = synchronizationMatchId;
    render(<FootballData actorAccountId="actor" filter={parseFootballDataQuery({ view: "matches", id: synchronizationMatchId })}
      data={{ view: "matches", checkedAt, clubs: [], page: { items: [], total: 0, page: 1, totalPages: 0 }, detail, evidence }} />);
    expect(screen.getByTestId("match-jobs").textContent).toBe(`actor:${synchronizationMatchId}`);
    expect(screen.getByRole("combobox", { name: "Статус" })).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "Клуб" })).toBeTruthy();
    expect(screen.getByText(/Успешный execution не гарантирует полноту dataset/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Обновить данные из PostgreSQL" }).getAttribute("href")).toContain(synchronizationMatchId);
  });
  it("offers GET pagination and a reset for out-of-range player pages", () => {
    render(<FootballData actorAccountId="actor" filter={parseFootballDataQuery({ view: "players", page: "3", query: "Игрок" })}
      data={{ view: "players", checkedAt, page: { items: [], total: 21, page: 3, totalPages: 2 }, detail: null }} />);
    expect(screen.getByRole("link", { name: "Предыдущая страница" }).getAttribute("href")).toContain("page=2");
    expect(screen.getByRole("link", { name: "К началу списка" }).getAttribute("href")).not.toContain("page=");
    expect(screen.queryByRole("link", { name: "Следующая страница" })).toBeNull();
    expect(screen.getByRole("searchbox").closest("form")?.getAttribute("method")).toBe("get");
  });
  it("shows an ineligible player's stored club and season statistics without inventing zeros or a public link", () => {
    const player = { id: "player-one", slug: "player-one-1", provider: "api-football", provider_player_id: 1, provider_name: "Original Player", displayName: "Игрок",
      age: null, firstname: null, lastname: null, birth_date: null, birth_place: null, birth_country: null, nationality: null, height: null, weight: null, injured: null, publicEligible: false };
    render(<FootballData actorAccountId="actor" filter={parseFootballDataQuery({ view: "players", id: player.id })} data={{ view: "players", checkedAt,
      page: { items: [player], total: 1, page: 1, totalPages: 1 }, detail: { player,
        memberships: [{ clubId: "old-club", slug: "old-club", displayName: "Другой клуб", position: "Forward", shirtNumber: null, currentSerieA: false }],
        statistics: [{ id: "stat", season: "2025/26", competition: "Serie A", club: "Другой клуб", appearances: 0, lineups: null, minutes: 0, goals: 0, assists: null, rating: null, shots: null, passes: null, tackles: null, yellow: 0, red: 0 }] } }} />);
    expect(screen.getByText(/вне текущей Serie A/)).toBeTruthy();
    expect(screen.getByText(/Матчи: 0 · В старте: Нет сведений/)).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Публичная страница игрока" })).toBeNull();
  });
  it("renders absent standings as missing data", () => {
    render(<FootballData actorAccountId="actor" filter={parseFootballDataQuery({ view: "standings" })} data={{ view: "standings", checkedAt, standings: [] }} />);
    expect(screen.getByText("Сохранённая таблица текущей Serie A отсутствует.")).toBeTruthy();
  });
});
