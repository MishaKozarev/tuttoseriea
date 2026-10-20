// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { FootballCoaches } from "@/components/admin/football-coaches";
import type { FootballCoachesModel } from "@/src/admin/football-coaches-repository";
import { parseFootballCoachesQuery } from "@/src/admin/football-coaches";
import { localizationFixture } from "../fixtures/football-localization";
import { CoachPhoto } from "@/components/admin/coach-photo";

afterEach(cleanup);
function model(): FootballCoachesModel {
  const entity = { ...localizationFixture("coaches"), providerName: "Fixture Coach", displayName: "Fixture Coach" };
  return { checkedAt: new Date("2026-10-20T12:00:00Z"), page: { items: [{ ...entity, providerPhotoUrl: null }], total: 1, page: 1, pageSize: 20, totalPages: 1 },
    detail: { entity, providerPhotoUrl: null, providerCoachId: 2914, nameSourceMatchId: "source", photoSourceMatchId: null,
      observations: [{ clubId: "club", displayName: "Fixture Club", snapshots: 2,
        sources: [{ matchId: "scheduled-source", kickoffAt: "2026-10-22T12:00:00Z", lineupObservedAt: "2026-10-20T12:00:00Z", status: "scheduled" }],
        lastKnown: { kind: "unresolved", chronologyIncomplete: true, candidate: { provider: "api-football", providerCoachId: 999,
          coach: null, sources: [{ matchId: "finished-source", kickoffAt: "2026-10-19T12:00:00Z", lineupObservedAt: "2026-10-20T12:00:00Z", providerCoachName: null, providerCoachPhotoUrl: null }] } } }] } };
}
describe("Coaches read UI", () => {
  it("shows profile, nullable photo, source limitations and links to the single localization editor", () => {
    const data = model(); render(<FootballCoaches data={data} filter={parseFootballCoachesQuery({ id: data.detail!.entity.id })} />);
    expect(screen.getByRole("heading", { name: "Fixture Coach" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Редактировать русское имя в Локализации" }).getAttribute("href")).toContain("/admin/football/localization?kind=coaches&id=");
    expect(screen.queryByRole("textbox", { name: "Русское название (name_ru)" })).toBeNull();
    expect(screen.getByText(/не подтверждение действующего контракта/)).toBeTruthy();
    expect(screen.getByText(/более ранний тренер не подставляется/)).toBeTruthy();
    expect(screen.getByText(/Хронология неполна/)).toBeTruthy();
    expect(screen.getByText(/Источник: Match finished-source/)).toBeTruthy();
    expect(screen.getAllByText("Фото недоступно")).toHaveLength(2);
  });
  it("shows ambiguity without choosing a Coach and no-observation profiles without dismissal inference", () => {
    const data = model(); data.detail!.observations[0].lastKnown = { kind: "ambiguous", chronologyIncomplete: false, candidates: [] };
    const view = render(<FootballCoaches data={data} filter={parseFootballCoachesQuery({})} />);
    expect(screen.getByText(/один тренер не выбран/)).toBeTruthy();
    data.detail!.observations = []; view.rerender(<FootballCoaches data={data} filter={parseFootballCoachesQuery({})} />);
    expect(screen.getByText("Доступных наблюдений в сохранённых составах нет.")).toBeTruthy();
  });
  it("handles empty/out-of-range pages and a missing selected identity", () => {
    const data = model(); data.detail = null; data.page = { ...data.page, items: [], page: 3, total: 0, totalPages: 0 };
    render(<FootballCoaches data={data} filter={parseFootballCoachesQuery({ id: "unknown", page: "3" })} />);
    expect(screen.getByRole("alert").textContent).toContain("Тренер не найден");
    expect(screen.getByRole("link", { name: "К началу списка" })).toBeTruthy();
  });
  it("rejects unsafe images and falls back when a valid stored image cannot load", () => {
    const view = render(<CoachPhoto url="javascript:alert(1)" />); expect(screen.queryByRole("img")).toBeNull();
    view.rerender(<CoachPhoto url="https://fixture.invalid/coach.png" />);
    fireEvent.error(screen.getByRole("img")); expect(screen.getByText("Фото недоступно")).toBeTruthy();
  });
});
