// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ session: vi.fn(), query: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/src/identity/session", () => ({ getCurrentIdentityAccess: mocks.session }));
vi.mock("@/src/db", () => ({ getDbPool: () => ({ query: mocks.query }) }));
vi.mock("next/navigation", () => ({ redirect: (path: string) => { throw Error(`REDIRECT:${path}`); }, forbidden: () => { throw Error("FORBIDDEN"); } }));
import FootballTagsPage from "@/app/admin/football/tags/page";
import { CategoriesPage } from "@/components/admin/categories-page";
const pages = [() => FootballTagsPage({ searchParams: Promise.resolve({}) }),
  () => CategoriesPage({ kind: "article", searchParams: Promise.resolve({}) }),
  () => CategoriesPage({ kind: "news", searchParams: Promise.resolve({}) })];
beforeEach(() => {
  vi.resetAllMocks(); mocks.session.mockResolvedValue({ authenticated: true, mfaRequired: false, identityAccess: { accountId: "actor", roles: ["super_admin"] } });
  mocks.query.mockResolvedValue({ rows: [{ total: 0, items: [] }] });
});
afterEach(cleanup);
describe("Catalog server page boundaries", () => {
  it.each([null, [], ["writer"], ["admin"]])("guards all pages before reading: %j", async roles => {
    mocks.session.mockResolvedValue(roles === null ? { authenticated: false, identityAccess: null } : { authenticated: true, mfaRequired: false, identityAccess: { roles } });
    for (const page of pages) await expect(page()).rejects.toThrow(roles === null ? "REDIRECT:" : "FORBIDDEN");
    expect(mocks.query).not.toHaveBeenCalled();
  });
  it("requires MFA on all three pages", async () => {
    mocks.session.mockResolvedValue({ authenticated: true, mfaRequired: true, identityAccess: { roles: ["super_admin"] } });
    for (const page of pages) await expect(page()).rejects.toThrow("REDIRECT:/admin/login/two-factor");
    expect(mocks.query).not.toHaveBeenCalled();
  });
  it("renders a read-only Tag view and separate category views", async () => {
    render(await pages[0]()); expect(screen.getByRole("heading", { name: "Football Tags" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Создать|Сохранить|Удалить/ })).toBeNull(); cleanup();
    render(await pages[1]()); expect(screen.getByRole("heading", { name: "Категории статей" })).toBeTruthy(); cleanup();
    render(await pages[2]()); expect(screen.getByRole("heading", { name: "Категории новостей" })).toBeTruthy();
  });
  it("reports database failure as unknown without exposing internal SQL", async () => {
    mocks.query.mockRejectedValue(new Error("private SQL"));
    render(await pages[0]()); expect(screen.getByRole("alert").textContent).toContain("неизвестно");
    expect(document.body.textContent).not.toContain("private SQL");
  });
});
