// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Categories } from "@/components/admin/categories";
import { FootballTagImage } from "@/components/admin/football-tag-image";
const category = { id: "one", name: "Fixture", revision: 3, createdAt: "2026-10-21T00:00:00Z", updatedAt: "2026-10-21T00:00:00Z" };
const initial = { items: [category], total: 1, page: 1, totalPages: 1 };
const filter = { query: "", page: 1 };
const fetchMock = vi.fn();
beforeEach(() => { vi.stubGlobal("fetch", fetchMock); fetchMock.mockReset(); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
describe("Category management UI", () => {
  it("requires explicit deletion confirmation and sends the selected revision", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ items: [], total: 0, page: 1, totalPages: 0 }) });
    render(<Categories kind="article" initial={initial} filter={filter} />);
    fireEvent.click(screen.getByRole("button", { name: "Редактировать Fixture" }));
    const remove = screen.getByRole("button", { name: "Удалить категорию" }) as HTMLButtonElement;
    expect(remove.disabled).toBe(true);
    fireEvent.click(screen.getByRole("checkbox")); fireEvent.click(remove);
    await screen.findByText("Категория удалена.");
    expect(fetchMock.mock.calls[0][0]).toBe("/api/admin/articles/categories/one");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ expectedRevision: 3, confirmed: true });
  });
  it("uses the independent News API and prevents repeat submission while pending", async () => {
    let complete!: (value: unknown) => void;
    fetchMock.mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
    render(<Categories kind="news" initial={{ ...initial, items: [] }} filter={filter} />);
    fireEvent.change(screen.getByRole("textbox", { name: "Название категории" }), { target: { value: "News category" } });
    fireEvent.click(screen.getByRole("button", { name: "Сохранить категорию" }));
    expect((screen.getByRole("button", { name: "Подождите…" }) as HTMLButtonElement).disabled).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1); expect(fetchMock.mock.calls[0][0]).toBe("/api/admin/news/categories");
    complete({ ok: false, json: async () => ({ error: { code: "CATEGORY_NAME_CONFLICT", requestId: "fixture" } }) });
    await screen.findByText(/Такое название уже существует/);
  });
  it("shows stable API errors without claiming a rejected deletion succeeded", async () => {
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({ error: { code: "CATEGORY_IN_USE", requestId: "correlation" } }) });
    render(<Categories kind="article" initial={initial} filter={filter} />);
    fireEvent.click(screen.getByRole("button", { name: "Редактировать Fixture" })); fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Удалить категорию" }));
    await screen.findByText(/Категория используется контентом/); expect(screen.queryByText("Категория удалена.")).toBeNull();
    expect(screen.getByText(/correlation/)).toBeTruthy();
  });
  it("handles a missing/failed image without an executable URL", async () => {
    const view = render(<FootballTagImage url="javascript:alert(1)" name="Fixture" />); expect(screen.queryByRole("img")).toBeNull();
    view.rerender(<FootballTagImage url="https://fixture.invalid/photo" name="Fixture" />);
    fireEvent.error(screen.getByRole("img")); await waitFor(() => expect(screen.queryByRole("img")).toBeNull());
  });
  it("requires a successful GET refresh after an unknown write outcome", async () => {
    fetchMock.mockRejectedValueOnce(new Error("network lost"));
    render(<Categories kind="article" initial={initial} filter={filter} />);
    fireEvent.change(screen.getByRole("textbox", { name: "Название категории" }), { target: { value: "Uncertain" } });
    fireEvent.click(screen.getByRole("button", { name: "Сохранить категорию" }));
    await screen.findByText(/Результат операции не подтверждён/);
    expect((screen.getByRole("button", { name: "Сохранить категорию" }) as HTMLButtonElement).disabled).toBe(true);
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => initial });
    fireEvent.click(screen.getByRole("button", { name: "Обновить список" }));
    await waitFor(() => expect(screen.getByRole("textbox", { name: "Название категории" }).getAttribute("value")).toBe(""));
    expect(fetchMock.mock.calls[1][1]).toEqual({ cache: "no-store" });
  });
});
