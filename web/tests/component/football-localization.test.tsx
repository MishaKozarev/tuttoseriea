// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FootballLocalization } from "@/components/admin/football-localization";
import { parseLocalizationEdit, type FootballLocalizationEntity } from "@/src/football/localization-management";
import { resolveFootballProperName } from "@/src/football/localization";
import { localizationFixture } from "../fixtures/football-localization";

let record: FootballLocalizationEntity;
const network = vi.fn<typeof fetch>();
const patches = () => network.mock.calls.filter(([, init]) => init?.method === "PATCH");
const find = () => screen.getByRole("button", { name: "Найти" });
const ready = async () => waitFor(() => expect(find().hasAttribute("disabled")).toBe(false));
const input = () => screen.getByRole("textbox", { name: "Русское название (name_ru)" });
const save = () => screen.getByRole("button", { name: "Сохранить как unreviewed" });
const review = () => screen.getByRole("button", { name: "Подтвердить как reviewed" });
const reload = () => screen.getByRole("button", { name: "Загрузить актуальную версию" });
const editor = () => screen.getByRole("region", { name: `Русское название: ${record.providerName}` });
function publicName() { record.displayName = resolveFootballProperName({ providerName: record.providerName, nameRu: record.nameRu, reviewStatus: record.nameRuReviewStatus }); }
function change(value: string) { fireEvent.change(input(), { target: { value } }); }
async function open() {
  render(<FootballLocalization />); await ready();
  fireEvent.click(screen.getByRole("button", { name: `Редактировать ${record.providerName}` }));
}
beforeEach(() => {
  record = localizationFixture(); network.mockReset(); vi.stubGlobal("fetch", network);
  network.mockImplementation(async (path, init) => {
    if (init?.method === "PATCH") {
      const edit = parseLocalizationEdit(JSON.parse(String(init.body)));
      record = { ...record, nameRu: edit.nameRu, nameRuReviewStatus: edit.action === "review" ? "reviewed" : "unreviewed", localizationRevision: record.localizationRevision + 1 };
      publicName(); return Response.json({ entity: record });
    }
    const url = new URL(String(path), "https://fixture.invalid");
    if (!url.search) return Response.json({ entity: record });
    const kind = url.searchParams.get("kind") as FootballLocalizationEntity["kind"];
    const page = Number(url.searchParams.get("page"));
    const items = kind === "players" ? Array.from({ length: 21 }, (_, i) => ({ ...record, kind, id: `player-${i + 1}`, providerName: `Player ${i + 1}` })) : [{ ...record, kind }];
    return Response.json({ items: items.slice((page - 1) * 20, page * 20), total: items.length, page, pageSize: 20, totalPages: Math.ceil(items.length / 20) });
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("Football Localization UI", () => {
  it("fails closed for a fabricated Coach slug returned by the server", async () => {
    network.mockResolvedValue(Response.json({ items: [{ ...localizationFixture("coaches"), slug: "fake-slug" }], total: 1, page: 1, pageSize: 20, totalPages: 1 }));
    render(<FootballLocalization filter={{ kind: "coaches", query: "", status: "all", page: 1 }} />); await ready();
    expect(screen.getByRole("alert").textContent).toContain("INVALID_RESPONSE"); expect(patches()).toHaveLength(0);
  });
  it("loads existing names without mutations and distinguishes missing localization", async () => {
    render(<FootballLocalization />); await ready();
    expect(screen.getByText(/name_ru_review_status:/).textContent).toContain("Отсутствует");
    expect(screen.getByText(/Публичное название:/).textContent).toContain(record.providerName);
    expect(patches()).toHaveLength(0);
  });
  it.each(["competitions", "clubs", "players"])("searches %s by original/Russian name using GET", async (kind) => {
    render(<FootballLocalization />); await ready();
    fireEvent.change(screen.getByLabelText("Тип entity"), { target: { value: kind } });
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "Игрок %_" } });
    fireEvent.change(screen.getByLabelText("Статус перевода"), { target: { value: "unreviewed" } });
    fireEvent.click(find()); await ready();
    const url = new URL(String(network.mock.calls.at(-1)![0]), "https://fixture.invalid");
    expect(Object.fromEntries(url.searchParams)).toEqual({ kind, query: "Игрок %_", status: "unreviewed", page: "1" });
    expect(patches()).toHaveLength(0);
  });
  it("paginates a large Player list with at most twenty entries", async () => {
    render(<FootballLocalization />); await ready();
    fireEvent.change(screen.getByLabelText("Тип entity"), { target: { value: "players" } });
    fireEvent.click(find()); await ready();
    expect(screen.getAllByRole("button", { name: /^Редактировать/ })).toHaveLength(20);
    fireEvent.click(screen.getByRole("button", { name: "Следующая страница" })); await ready();
    expect(screen.getAllByRole("button", { name: /^Редактировать/ })).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Редактировать Player 21" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Следующая страница" }).hasAttribute("disabled")).toBe(true);
    expect(patches()).toHaveLength(0);
  });
  it("saves a trimmed draft, then explicitly reviews that persisted value", async () => {
    await open();
    change("  Русское имя  ");
    expect(review().hasAttribute("disabled")).toBe(true);
    expect(patches()).toHaveLength(0);
    fireEvent.click(save()); await ready();
    expect(editor().textContent).toContain("Не подтверждено (unreviewed)");
    expect(editor().textContent).toContain("Публичное название: Fixture Club");
    expect(review().hasAttribute("disabled")).toBe(true);
    fireEvent.click(screen.getByRole("checkbox")); fireEvent.click(review()); await ready();
    expect(editor().textContent).toContain("Подтверждено (reviewed)");
    expect(editor().textContent).toContain("Публичное название: Русское имя");
    expect(JSON.parse(String(patches()[0][1]?.body))).toEqual({ action: "save", nameRu: "Русское имя", expectedRevision: 0 });
    expect(JSON.parse(String(patches()[1][1]?.body))).toEqual({ action: "review", nameRu: "Русское имя", expectedRevision: 1, confirmed: true });
    expect(record.id).toBe(localizationFixture().id); expect(record.slug).toBe(localizationFixture().slug);
  });
  it("makes a reviewed correction unreviewed and requires another explicit review", async () => {
    record = { ...record, nameRu: "Старое имя", nameRuReviewStatus: "reviewed", localizationRevision: 7 }; publicName();
    await open(); change("Новое имя");
    expect(editor().textContent).toContain("Исправление будет сохранено как unreviewed");
    fireEvent.click(save()); await ready();
    expect(record.nameRuReviewStatus).toBe("unreviewed");
    expect(record.displayName).toBe(record.providerName);
    expect(review().hasAttribute("disabled")).toBe(true);
    expect(JSON.parse(String(patches()[0][1]?.body)).expectedRevision).toBe(7);
  });
  it.each(["  ", "\u00a0", "\u200b", "Имя\u0007Фамилия"])("rejects invalid names without a write: %#", async (name) => {
    await open(); change(name);
    expect(save().hasAttribute("disabled")).toBe(true);
    fireEvent.click(save()); expect(patches()).toHaveLength(0);
  });
  it("resets review confirmation when the draft changes", async () => {
    record = { ...record, nameRu: "Имя", nameRuReviewStatus: "unreviewed" }; await open();
    fireEvent.click(screen.getByRole("checkbox")); change("Другое имя");
    expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(false);
    expect(review().hasAttribute("disabled")).toBe(true);
  });
  it("retains the draft after 409, blocks writes, and reloads the actual revision explicitly", async () => {
    await open(); change("Моё имя");
    const original = network.getMockImplementation()!;
    network.mockImplementation(async (url, init) => {
      if (init?.method !== "PATCH") return original(url, init);
      record = { ...record, nameRu: "Другое имя", nameRuReviewStatus: "unreviewed", localizationRevision: 1 };
      return Response.json({ error: { code: "LOCALIZATION_CONFLICT", message: "PRIVATE DETAIL", requestId: "conflict-id" } }, { status: 409 });
    });
    fireEvent.click(save()); await ready();
    expect((input() as HTMLInputElement).value).toBe("Моё имя");
    expect(save().hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("alert").textContent).toContain("LOCALIZATION_CONFLICT");
    expect(screen.getByRole("alert").textContent).not.toContain("PRIVATE");
    fireEvent.click(reload()); await ready();
    expect((input() as HTMLInputElement).value).toBe("Другое имя");
    expect(patches()).toHaveLength(1);
    network.mockImplementation(original); change("Согласованное имя"); fireEvent.click(save()); await ready();
    expect(JSON.parse(String(patches()[1][1]?.body)).expectedRevision).toBe(1);
  });
  it("reconciles a lost write response through GET without replaying the change", async () => {
    await open(); change("Новое имя");
    const original = network.getMockImplementation()!;
    network.mockImplementation(async (url, init) => {
      const response = await original(url, init);
      if (init?.method === "PATCH") throw new TypeError("lost response");
      return response;
    });
    fireEvent.click(save()); await ready();
    expect(screen.getByRole("alert").textContent).toContain("NETWORK_ERROR");
    expect(save().hasAttribute("disabled")).toBe(true);
    fireEvent.click(reload()); await ready();
    expect((input() as HTMLInputElement).value).toBe("Новое имя");
    expect(patches()).toHaveLength(1);
  });
  it("prevents double save while the first write is pending", async () => {
    await open(); change("Новое имя");
    let finish!: (response: Response) => void;
    const original = network.getMockImplementation()!;
    network.mockImplementation((url, init) => init?.method === "PATCH" ? new Promise((resolve) => { finish = resolve; }) : original(url, init));
    const button = save(); fireEvent.click(button); fireEvent.click(button);
    expect(patches()).toHaveLength(1);
    expect(input().hasAttribute("disabled")).toBe(true);
    await act(async () => finish(Response.json({ entity: { ...record, nameRu: "Новое имя", nameRuReviewStatus: "unreviewed", localizationRevision: 1 } })));
    await ready();
  });
  it.each([[401, "UNAUTHORIZED"], [403, "FORBIDDEN"], [500, "INTERNAL_SERVER_ERROR"]])("handles %s safely without mutating data", async (status, code) => {
    network.mockResolvedValue(Response.json({ error: { code, message: "PRIVATE", requestId: "read-id" } }, { status: Number(status) }));
    render(<FootballLocalization />); await ready();
    expect(screen.getByRole("alert").textContent).toContain(code);
    expect(screen.getByRole("alert").textContent).not.toContain("PRIVATE");
    expect(patches()).toHaveLength(0);
  });
});
