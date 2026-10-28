// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Writers } from "@/components/admin/writers";
import { WriterProfileEditor } from "@/components/admin/writer-profile";
import { writerAdminFixture, writerProfileFixture } from "../fixtures/writers";

const fetchMock = vi.fn();
beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal("fetch", fetchMock); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const disabled = (name: string | RegExp) => (screen.getByRole("button", { name }) as HTMLButtonElement).disabled;

describe("Writer management UI", () => {
  it("sends credentials only for explicit new-account creation and clears the password field", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ writer: writerAdminFixture() }, { status: 201 }));
    render(<Writers initial={[]} />);
    fireEvent.change(screen.getByLabelText("Email нового автора"), { target: { value: "new@example.invalid" } });
    fireEvent.change(screen.getByLabelText("Пароль нового автора"), { target: { value: "Synthetic fixture password" } });
    fireEvent.submit(screen.getByRole("button", { name: "Создать Writer" }).closest("form")!);
    await screen.findByText(/Автор создан/);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body).toEqual({ action: "create", email: "new@example.invalid", password: "Synthetic fixture password", operationId: expect.any(String) });
    expect((screen.getByLabelText("Пароль нового автора") as HTMLInputElement).value).toBe("");
    expect(document.body.textContent).not.toContain("Synthetic fixture password");
  });
  it("adds Writer to an explicitly selected existing account without credential fields", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ writer: writerAdminFixture({ roles: ["writer", "admin"] }) }));
    render(<Writers initial={[writerAdminFixture({ isWriter: false, roles: ["admin"] })]} />);
    fireEvent.click(screen.getByRole("button", { name: "Назначить Writer: writer@example.invalid" }));
    await screen.findByText("Существующему аккаунту назначена роль Writer.");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ action: "attach", accountId: "writer-account", operationId: expect.any(String) });
  });
  it("uses publication revision and updates only after the confirmed response", async () => {
    let complete!: (response: Response) => void;
    fetchMock.mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
    render(<Writers initial={[writerAdminFixture({ publicationRevision: 3 })]} />);
    fireEvent.click(screen.getByRole("button", { name: /Разрешить публикацию:/ }));
    expect(disabled(/Разрешить публикацию:/)).toBe(true); expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ enabled: true, expectedRevision: 3, operationId: expect.any(String) });
    complete(Response.json({ profile: writerProfileFixture({ canPublishOwn: true, publicationRevision: 4 }) }));
    await screen.findByRole("button", { name: /Отозвать право публикации:/ });
    expect(screen.getByText(/Самостоятельная публикация собственных статей: разрешена/)).toBeTruthy();
  });
  it("requires an explicit GET after a conflict or uncertain server write and never automatically retries", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ error: { code: "WRITER_CONFLICT", requestId: "safe-correlation", message: "internal ignored" } }, { status: 409 }));
    render(<Writers initial={[writerAdminFixture()]} />);
    fireEvent.click(screen.getByRole("button", { name: /Разрешить публикацию:/ }));
    await screen.findByText(/safe-correlation/); expect(disabled(/Разрешить публикацию:/)).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1); expect(screen.queryByText("internal ignored")).toBeNull();
    fetchMock.mockResolvedValueOnce(Response.json({ writers: [writerAdminFixture()] }));
    fireEvent.click(screen.getByRole("button", { name: "Обновить список" }));
    await screen.findByText("Список обновлён."); expect(disabled(/Разрешить публикацию:/)).toBe(false);
    expect(fetchMock.mock.calls[1]).toEqual(["/api/admin/writers", { cache: "no-store" }]);
  });
  it("treats a server failure after a write as uncertain until GET reconciliation", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ error: { code: "INTERNAL_SERVER_ERROR", requestId: "uncertain-write" } }, { status: 500 }));
    render(<Writers initial={[writerAdminFixture()]} />);
    fireEvent.click(screen.getByRole("button", { name: /Разрешить публикацию:/ }));
    await screen.findByText(/uncertain-write/);
    expect(disabled(/Разрешить публикацию:/)).toBe(true); expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("alert").textContent).toContain("Обновите список");
  });
});

describe("Writer profile UI", () => {
  it("edits only public profile data with current revision, independently of login", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ profile: writerProfileFixture({ nickname: "Новый никнейм", revision: 2 }) }));
    render(<WriterProfileEditor initial={writerProfileFixture()} />);
    fireEvent.change(screen.getByLabelText("Публичный никнейм"), { target: { value: "Новый никнейм" } });
    fireEvent.click(screen.getByRole("button", { name: "Добавить ссылку" }));
    fireEvent.change(screen.getByLabelText("Название ссылки 1"), { target: { value: "Канал" } });
    fireEvent.change(screen.getByLabelText("Адрес ссылки 1"), { target: { value: "https://example.invalid/channel" } });
    fireEvent.submit(screen.getByRole("button", { name: "Сохранить профиль" }).closest("form")!);
    await screen.findByText("Профиль сохранён.");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ nickname: "Новый никнейм", socialLinks: [{ label: "Канал", url: "https://example.invalid/channel" }], expectedRevision: 1, operationId: expect.any(String) });
    expect(screen.queryByLabelText(/Email/)).toBeNull();
  });
  it("uploads the actual File with CAS headers and renders the new Media URL directly", async () => {
    const avatarId = "07937509-8348-48f4-b3d7-92f6af65ea6e";
    const avatarUrl = `/media/public/${avatarId}.webp`;
    fetchMock.mockResolvedValueOnce(Response.json({ profile: writerProfileFixture({ avatarMediaId: avatarId, avatarUrl, revision: 2 }) }));
    render(<WriterProfileEditor initial={writerProfileFixture()} />);
    const file = new File(["synthetic bytes"], "fixture.png", { type: "image/png" });
    fireEvent.change(screen.getByLabelText("Новый аватар"), { target: { files: [file] } });
    fireEvent.submit(screen.getByRole("button", { name: "Сохранить аватар" }).closest("form")!);
    await screen.findByText("Аватар сохранён.");
    expect(fetchMock.mock.calls[0][0]).toBe("/api/admin/profile/avatar");
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: "POST", body: file, headers: { "Content-Type": "image/png", "X-Profile-Revision": "1", "X-Operation-ID": expect.any(String) } });
    expect(screen.getByRole("img").getAttribute("src")).toBe(avatarUrl);
  });
  it("keeps the local draft and file after conflict until explicit profile refresh", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ error: { code: "WRITER_CONFLICT", requestId: "profile-conflict" } }, { status: 409 }));
    render(<WriterProfileEditor initial={writerProfileFixture()} />);
    fireEvent.change(screen.getByLabelText("Публичный никнейм"), { target: { value: "Несохранённый ник" } });
    fireEvent.submit(screen.getByRole("button", { name: "Сохранить профиль" }).closest("form")!);
    await screen.findByText(/profile-conflict/); expect(disabled("Сохранить профиль")).toBe(true);
    expect((screen.getByLabelText("Публичный никнейм") as HTMLInputElement).value).toBe("Несохранённый ник");
    fetchMock.mockResolvedValueOnce(Response.json({ profile: writerProfileFixture({ nickname: "Актуальный ник", revision: 2 }) }));
    fireEvent.click(screen.getByRole("button", { name: "Обновить профиль" }));
    await waitFor(() => expect((screen.getByLabelText("Публичный никнейм") as HTMLInputElement).value).toBe("Актуальный ник"));
    expect(fetchMock).toHaveBeenCalledTimes(2); expect(disabled("Сохранить профиль")).toBe(false);
  });
});
