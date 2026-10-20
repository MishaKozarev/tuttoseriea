// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ session: vi.fn(), load: vi.fn(), log: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/src/identity/session", () => ({ getCurrentIdentityAccess: mocks.session }));
vi.mock("@/src/admin/football-coaches-repository", () => ({ loadFootballCoaches: mocks.load }));
vi.mock("@/src/logging/logger", () => ({ logger: { error: mocks.log } }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`REDIRECT:${url}`); }, forbidden: () => { throw new Error("FORBIDDEN"); } }));
vi.mock("@/components/admin/football-coaches", () => ({ FootballCoaches: () => <p>Coaches read view</p> }));
import FootballCoachesPage from "@/app/admin/football/coaches/page";
const page = (params: Record<string, string | string[]> = {}) => FootballCoachesPage({ searchParams: Promise.resolve(params) });
beforeEach(() => { vi.resetAllMocks(); mocks.session.mockResolvedValue({ authenticated: true, mfaRequired: false, identityAccess: { accountId: "actor", roles: ["super_admin"] } }); });
afterEach(cleanup);
describe("Coaches page access", () => {
  it("redirects unauthenticated sessions before any DB read", async () => {
    mocks.session.mockResolvedValue({ authenticated: false, identityAccess: null });
    await expect(page()).rejects.toThrow("REDIRECT:/admin/login?returnTo=%2Fadmin%2Ffootball%2Fcoaches"); expect(mocks.load).not.toHaveBeenCalled();
  });
  it.each([[], ["writer"], ["admin"], ["admin", "writer"]])("forbids roles %j", async (...roles) => {
    mocks.session.mockResolvedValue({ authenticated: true, mfaRequired: false, identityAccess: { roles } });
    await expect(page()).rejects.toThrow("FORBIDDEN"); expect(mocks.load).not.toHaveBeenCalled();
  });
  it("does not grant full access before mandatory MFA", async () => {
    mocks.session.mockResolvedValue({ authenticated: true, mfaRequired: true, identityAccess: { roles: ["super_admin"] } });
    await expect(page()).rejects.toThrow("REDIRECT:"); expect(mocks.load).not.toHaveBeenCalled();
  });
  it("allows super_admin and validates search before reading", async () => {
    render(await page({ query: "Coach", page: "2" }));
    expect(screen.getByRole("heading", { name: "Тренеры" })).toBeTruthy();
    expect(mocks.load).toHaveBeenCalledWith({ kind: "coaches", query: "Coach", status: "all", page: 2, id: "" });
  });
  it("reports invalid filters and database errors without exposing SQL", async () => {
    render(await page({ kind: "clubs" })); expect(screen.getByRole("alert").textContent).toContain("Некорректные"); expect(mocks.load).not.toHaveBeenCalled(); cleanup();
    mocks.load.mockRejectedValue(new Error("PRIVATE SQL")); render(await page());
    expect(screen.getByRole("alert").textContent).toContain("состояние неизвестно"); expect(screen.getByRole("main").textContent).not.toContain("PRIVATE");
  });
});
