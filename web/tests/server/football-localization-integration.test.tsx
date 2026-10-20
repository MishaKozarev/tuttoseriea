// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ session: vi.fn(), list: vi.fn(), get: vi.fn(), edit: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/src/identity/session", () => ({ getCurrentIdentityAccess: mocks.session }));
vi.mock("@/src/db", () => ({ getDbPool: () => ({}) }));
vi.mock("@/src/logging/logger", () => ({ logger: { info: vi.fn(), error: vi.fn() } }));
vi.mock("@/src/football/localization-repository", () => ({ FootballLocalizationRepository: class {
  list = mocks.list; get = mocks.get; edit = mocks.edit;
} }));

import { FootballLocalization } from "@/components/admin/football-localization";
import { GET as LIST } from "@/app/api/admin/football/localization/route";
import { GET, PATCH } from "@/app/api/admin/football/localization/[kind]/[id]/route";
import { FootballLocalizationError, type FootballLocalizationEdit, type FootballLocalizationEntity } from "@/src/football/localization-management";
import { resolveFootballProperName } from "@/src/football/localization";
import { localizationFixture } from "../fixtures/football-localization";

const origin = "https://localization.example.invalid";
let record: FootballLocalizationEntity;
const ready = async () => waitFor(() => expect(screen.getByRole("button", { name: "Найти" }).hasAttribute("disabled")).toBe(false));
const name = () => screen.getByRole("textbox", { name: "Русское название (name_ru)" });
const save = () => screen.getByRole("button", { name: "Сохранить как unreviewed" });
async function open() {
  render(<FootballLocalization />); await ready();
  fireEvent.click(screen.getByRole("button", { name: "Редактировать Fixture Club" }));
}

beforeEach(() => {
  vi.resetAllMocks(); vi.stubEnv("AUTH_URL", origin); record = localizationFixture();
  mocks.session.mockResolvedValue({ authenticated: true, mfaRequired: false, identityAccess: { accountId: "actor", authUserId: "user", roles: ["super_admin"], email: null } });
  mocks.list.mockImplementation(async () => ({ items: [record], total: 1, page: 1, pageSize: 20, totalPages: 1 }));
  mocks.get.mockImplementation(async () => record);
  mocks.edit.mockImplementation(async (_kind: unknown, _id: unknown, edit: FootballLocalizationEdit) => {
    if (edit.expectedRevision !== record.localizationRevision) throw new FootballLocalizationError("LOCALIZATION_CONFLICT", 409, "Reload localization");
    record = { ...record, nameRu: edit.nameRu, nameRuReviewStatus: edit.action === "review" ? "reviewed" : "unreviewed", localizationRevision: record.localizationRevision + 1 };
    record.displayName = resolveFootballProperName({ providerName: record.providerName, nameRu: record.nameRu, reviewStatus: record.nameRuReviewStatus });
    return record;
  });
  vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (path, init) => {
    // Bridge the real browser client to the actual Route Handlers, with the browser Origin.
    const request = new Request(new URL(String(path), origin), { ...init, headers: { ...init?.headers, origin } });
    const context = { params: Promise.resolve({ kind: record.kind, id: record.id }) };
    return request.method === "PATCH" ? PATCH(request, context) : new URL(request.url).search ? LIST(request) : GET(request, context);
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("Localization UI through the actual Admin HTTP boundary", () => {
  it("opens a Coach deep link without a slug and uses the same save/review HTTP workflow", async () => {
    record = localizationFixture("coaches");
    render(<FootballLocalization filter={{ kind: "coaches", query: "", status: "all", page: 1 }} initialId={record.id} />);
    await ready();
    expect(screen.queryByText("Slug:")).toBeNull();
    expect(mocks.get).toHaveBeenCalledWith("coaches", record.id);
    fireEvent.change(name(), { target: { value: "Тестовый тренер" } }); fireEvent.click(save()); await ready();
    expect(mocks.edit).toHaveBeenLastCalledWith("coaches", record.id, { action: "save", nameRu: "Тестовый тренер", expectedRevision: 0 });
    expect(record.displayName).toBe(record.providerName);
    fireEvent.click(screen.getByRole("checkbox")); fireEvent.click(screen.getByRole("button", { name: "Подтвердить как reviewed" })); await ready();
    expect(record.displayName).toBe("Тестовый тренер"); expect(record.slug).toBeNull();
  });
  it("saves a draft and reviews that exact persisted revision with explicit confirmation", async () => {
    await open(); fireEvent.change(name(), { target: { value: "  Русское имя  " } });
    fireEvent.click(save()); await ready();
    expect(mocks.edit).toHaveBeenLastCalledWith("clubs", record.id, { action: "save", nameRu: "Русское имя", expectedRevision: 0 });
    expect(record.displayName).toBe("Fixture Club");
    fireEvent.click(screen.getByRole("checkbox")); fireEvent.click(screen.getByRole("button", { name: "Подтвердить как reviewed" })); await ready();
    expect(mocks.edit).toHaveBeenLastCalledWith("clubs", record.id, { action: "review", nameRu: "Русское имя", expectedRevision: 1, confirmed: true });
    expect(record.displayName).toBe("Русское имя");
  });
  it.each([null, ["writer"], ["admin"]])("rechecks authorization on a write after the page opened: %s", async (roles) => {
    await open();
    mocks.session.mockResolvedValue(roles === null ? { authenticated: false, identityAccess: null } : { authenticated: true, mfaRequired: false, identityAccess: { accountId: "actor", roles } });
    fireEvent.change(name(), { target: { value: "Имя" } }); fireEvent.click(save()); await ready();
    expect(screen.getByRole("alert").textContent).toContain(roles === null ? "UNAUTHORIZED" : "FORBIDDEN");
    expect(mocks.edit).not.toHaveBeenCalled(); expect(record.nameRu).toBeNull();
  });
  it("keeps a stale draft on 409 and reconciles the revision through GET before editing again", async () => {
    await open(); fireEvent.change(name(), { target: { value: "Моё имя" } });
    record = { ...record, nameRu: "Другое имя", nameRuReviewStatus: "unreviewed", localizationRevision: 1 };
    fireEvent.click(save()); await ready();
    expect(screen.getByRole("alert").textContent).toContain("LOCALIZATION_CONFLICT");
    expect((name() as HTMLInputElement).value).toBe("Моё имя"); expect(save().hasAttribute("disabled")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Загрузить актуальную версию" })); await ready();
    expect((name() as HTMLInputElement).value).toBe("Другое имя"); expect(mocks.edit).toHaveBeenCalledOnce();
    fireEvent.change(name(), { target: { value: "Согласованное имя" } }); fireEvent.click(save()); await ready();
    expect(mocks.edit).toHaveBeenLastCalledWith("clubs", record.id, { action: "save", nameRu: "Согласованное имя", expectedRevision: 1 });
  });
});
