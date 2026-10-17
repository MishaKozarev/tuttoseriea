// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCurrentIdentityAccess: vi.fn(),
  loadFootballOverview: vi.fn(),
  loadFootballData: vi.fn(),
  logError: vi.fn(),
  redirect: vi.fn((location: string): never => {
    throw new Error(`NEXT_REDIRECT:${location}`);
  }),
  forbidden: vi.fn((): never => {
    throw new Error("NEXT_FORBIDDEN");
  }),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/components/admin/staff-session-controls", () => ({ StaffSessionControls: () => null }));
vi.mock("@/src/identity/session", () => ({
  getCurrentIdentityAccess: mocks.getCurrentIdentityAccess,
}));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect, forbidden: mocks.forbidden }));
vi.mock("@/src/admin/football-overview-repository", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/src/admin/football-overview-repository")>(),
  loadFootballOverview: mocks.loadFootballOverview,
}));
vi.mock("@/src/logging/logger", () => ({ logger: { error: mocks.logError } }));
vi.mock("@/components/admin/football-synchronization", () => ({
  FootballSynchronization: ({ actorAccountId }: { actorAccountId: string }) => <div data-testid="synchronization-ui">{actorAccountId}</div>,
}));
vi.mock("@/components/admin/football-localization", () => ({ FootballLocalization: () => <div data-testid="localization-ui" /> }));
vi.mock("@/src/admin/football-data-repository", () => ({ loadFootballData: mocks.loadFootballData }));
vi.mock("@/components/admin/football-data", () => ({ FootballData: () => <div data-testid="data-ui" /> }));

import FootballAdminForbidden from "@/app/admin/football/forbidden";
import FootballAdminPage from "@/app/admin/football/page";
import FootballSynchronizationPage from "@/app/admin/football/synchronization/page";
import FootballLocalizationPage from "@/app/admin/football/localization/page";
import FootballDataPage from "@/app/admin/football/data/page";
import AdminPage from "@/app/admin/page";
import type { StaffRoleId } from "@/src/identity/rbac";
import { footballOverviewFixture } from "../fixtures/football-overview";

function setStaffIdentity(roles: StaffRoleId[]) {
  mocks.getCurrentIdentityAccess.mockResolvedValue({
    authenticated: true,
    mfaRequired: false,
    identityAccess: {
      accountId: "account-id",
      authUserId: "auth-user-id",
      email: "staff@example.invalid",
      roles,
    },
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.loadFootballOverview.mockResolvedValue(footballOverviewFixture());
});
afterEach(cleanup);

describe("Football Admin route with the real access policy", () => {
  it("redirects unauthenticated users before rendering Football Admin", async () => {
    mocks.getCurrentIdentityAccess.mockResolvedValue({ authenticated: false, identityAccess: null });

    await expect(FootballAdminPage()).rejects.toThrow(
      "NEXT_REDIRECT:/admin/login?returnTo=%2Fadmin%2Ffootball",
    );
    expect(mocks.forbidden).not.toHaveBeenCalled();
    expect(mocks.loadFootballOverview).not.toHaveBeenCalled();
  });

  it.each<StaffRoleId[]>([[], ["writer"], ["admin"], ["writer", "admin"]])(
    "forbids roles %j before rendering Football Admin",
    async (...roles) => {
      setStaffIdentity(roles);

      await expect(FootballAdminPage()).rejects.toThrow("NEXT_FORBIDDEN");
      expect(mocks.redirect).not.toHaveBeenCalled();
      expect(mocks.loadFootballOverview).not.toHaveBeenCalled();
    },
  );

  it("forbids an authenticated user without Identity", async () => {
    mocks.getCurrentIdentityAccess.mockResolvedValue({ authenticated: true, identityAccess: null });

    await expect(FootballAdminPage()).rejects.toThrow("NEXT_FORBIDDEN");
    expect(mocks.loadFootballOverview).not.toHaveBeenCalled();
  });

  it("renders the existing AdminShell for super_admin", async () => {
    setStaffIdentity(["super_admin"]);

    render(await FootballAdminPage());

    expect(screen.getByRole("heading", { name: "Управление футболом" })).toBeTruthy();
    expect(screen.getByRole("banner").textContent).toContain("Администрирование");
    expect(screen.getByRole("link", { name: "Назад к администрированию" }).getAttribute("href")).toBe("/admin");
    expect(mocks.redirect).not.toHaveBeenCalled();
    expect(mocks.forbidden).not.toHaveBeenCalled();
    expect(mocks.loadFootballOverview).toHaveBeenCalledOnce();
    expect(screen.getByRole("heading", { name: "Обзор" })).toBeTruthy();
    expect(screen.getByText("История запусков пуста.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Синхронизация" }).getAttribute("href")).toBe("/admin/football/synchronization");
    expect(screen.getByRole("link", { name: "Локализация" }).getAttribute("href")).toBe("/admin/football/localization");
  });

  it("shows job status, safe error code and retry availability without raw provider details", async () => {
    setStaffIdentity(["super_admin"]);
    const data = footballOverviewFixture();
    data.recentExecutions = [{
      id: "execution-id", type: "football.sync-serie-a-match-events", match_id: "match-id",
      status: "pending", attempt_count: 1, max_attempts: 3, created_at: data.checkedAt,
      finished_at: null, available_at: new Date("2026-10-15T12:01:00Z"),
      last_error_code: "provider_unavailable", admin_requested: true,
      // Regression: extra internal fields must never be rendered accidentally.
      ...{ last_error_message: "PRIVATE PROVIDER DETAIL", payload: { secret: "PRIVATE PAYLOAD" } },
    }];
    mocks.loadFootballOverview.mockResolvedValue(data);
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    try {
      render(await FootballAdminPage());
      expect(screen.getByRole("table").textContent).toContain("Ожидает");
      expect(screen.getByRole("table").textContent).toContain("provider_unavailable");
      expect(screen.getByRole("table").textContent).toContain("Доступен с:");
      expect(screen.getByRole("table").textContent).toContain("Есть Admin request");
      expect(screen.getByRole("main").textContent).not.toContain("PRIVATE");
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally { fetchSpy.mockRestore(); }
  });

  it("reports unavailable data rather than a healthy empty database on a read failure", async () => {
    setStaffIdentity(["super_admin"]);
    mocks.loadFootballOverview.mockRejectedValue(new Error("PRIVATE SQL DETAIL"));
    render(await FootballAdminPage());
    expect(screen.getByRole("alert").textContent).toContain("Состояние данных и синхронизации неизвестно");
    expect(screen.getByRole("main").textContent).not.toContain("PRIVATE SQL DETAIL");
    expect(screen.queryByRole("heading", { name: "Требует внимания" })).toBeNull();
    expect(mocks.logError).toHaveBeenCalledOnce();
  });

  it("renders a Football-specific access-denied explanation", () => {
    render(<FootballAdminForbidden />);

    expect(screen.getByRole("heading", { name: "Доступ запрещён" })).toBeTruthy();
    expect(screen.getByRole("main").textContent).toContain(
      "У вашего аккаунта нет доступа к управлению футбольными данными.",
    );
    expect(screen.getByRole("main").textContent).not.toContain("admin.access");
  });
});

describe("Football synchronization server route", () => {
  it("uses the existing authentication flow with the exact returnTo", async () => {
    mocks.getCurrentIdentityAccess.mockResolvedValue({ authenticated: false, identityAccess: null });
    await expect(FootballSynchronizationPage()).rejects.toThrow(
      "NEXT_REDIRECT:/admin/login?returnTo=%2Fadmin%2Ffootball%2Fsynchronization",
    );
    expect(mocks.loadFootballOverview).not.toHaveBeenCalled();
  });
  it.each<StaffRoleId[]>([[], ["writer"], ["admin"], ["writer", "admin"]])("forbids roles %j", async (...roles) => {
    setStaffIdentity(roles);
    await expect(FootballSynchronizationPage()).rejects.toThrow("NEXT_FORBIDDEN");
    expect(mocks.loadFootballOverview).not.toHaveBeenCalled();
  });
  it("forbids an authenticated session without Identity", async () => {
    mocks.getCurrentIdentityAccess.mockResolvedValue({ authenticated: true, identityAccess: null });
    await expect(FootballSynchronizationPage()).rejects.toThrow("NEXT_FORBIDDEN");
  });
  it("renders AdminShell and passes the authorized actor to the UI for super_admin", async () => {
    setStaffIdentity(["super_admin"]);
    render(await FootballSynchronizationPage());
    expect(screen.getByRole("heading", { name: "Синхронизация" })).toBeTruthy();
    expect(screen.getByRole("banner").textContent).toContain("Администрирование");
    expect(screen.getByTestId("synchronization-ui").textContent).toBe("account-id");
    expect(mocks.loadFootballOverview).not.toHaveBeenCalled();
  });
});

describe("Football localization server route", () => {
  it("redirects to authentication with the localization returnTo", async () => {
    mocks.getCurrentIdentityAccess.mockResolvedValue({ authenticated: false, identityAccess: null });
    await expect(FootballLocalizationPage()).rejects.toThrow(
      "NEXT_REDIRECT:/admin/login?returnTo=%2Fadmin%2Ffootball%2Flocalization",
    );
  });
  it.each<StaffRoleId[]>([[], ["writer"], ["admin"], ["writer", "admin"]])("forbids roles %j", async (...roles) => {
    setStaffIdentity(roles);
    await expect(FootballLocalizationPage()).rejects.toThrow("NEXT_FORBIDDEN");
  });
  it("forbids an authenticated session without Identity", async () => {
    mocks.getCurrentIdentityAccess.mockResolvedValue({ authenticated: true, identityAccess: null });
    await expect(FootballLocalizationPage()).rejects.toThrow("NEXT_FORBIDDEN");
  });
  it("renders the existing AdminShell and localization UI for super_admin", async () => {
    setStaffIdentity(["super_admin"]);
    render(await FootballLocalizationPage());
    expect(screen.getByRole("heading", { name: "Локализация" })).toBeTruthy();
    expect(screen.getByRole("banner").textContent).toContain("Администрирование");
    expect(screen.getByTestId("localization-ui")).toBeTruthy();
    expect(mocks.loadFootballOverview).not.toHaveBeenCalled();
  });
});

describe("Football Data server route", () => {
  const page = (params: Record<string, string | string[]> = {}) => FootballDataPage({ searchParams: Promise.resolve(params) });
  it("redirects before reading any Football data", async () => {
    mocks.getCurrentIdentityAccess.mockResolvedValue({ authenticated: false, identityAccess: null });
    await expect(page()).rejects.toThrow("NEXT_REDIRECT:/admin/login?returnTo=%2Fadmin%2Ffootball%2Fdata");
    expect(mocks.loadFootballData).not.toHaveBeenCalled();
  });
  it.each<StaffRoleId[]>([[], ["writer"], ["admin"], ["writer", "admin"]])("forbids roles %j before repository access", async (...roles) => {
    setStaffIdentity(roles); await expect(page()).rejects.toThrow("NEXT_FORBIDDEN");
    expect(mocks.loadFootballData).not.toHaveBeenCalled();
  });
  it("forbids a session without Identity", async () => {
    mocks.getCurrentIdentityAccess.mockResolvedValue({ authenticated: true, identityAccess: null });
    await expect(page()).rejects.toThrow("NEXT_FORBIDDEN"); expect(mocks.loadFootballData).not.toHaveBeenCalled();
  });
  it("allows super_admin and passes validated GET filters", async () => {
    setStaffIdentity(["super_admin"]); render(await page({ view: "players", page: "2", query: "Игрок" }));
    expect(screen.getByTestId("data-ui")).toBeTruthy();
    expect(screen.getByRole("banner").textContent).toContain("Администрирование");
    expect(mocks.loadFootballData).toHaveBeenCalledWith({ view: "players", page: 2, query: "Игрок", status: "", club: "", id: "" });
  });
  it("rejects invalid filters without accessing PostgreSQL", async () => {
    setStaffIdentity(["super_admin"]); render(await page({ view: "matches", id: "12345" }));
    expect(screen.getByRole("alert").textContent).toContain("Некорректные параметры");
    expect(mocks.loadFootballData).not.toHaveBeenCalled();
  });
  it("reports unavailable data rather than healthy empty datasets", async () => {
    setStaffIdentity(["super_admin"]); mocks.loadFootballData.mockRejectedValue(new Error("PRIVATE SQL DETAIL"));
    render(await page()); expect(screen.getByRole("alert").textContent).toContain("состояние неизвестно");
    expect(screen.getByRole("main").textContent).not.toContain("PRIVATE"); expect(mocks.logError).toHaveBeenCalledOnce();
  });
});

describe("existing Admin route regression", () => {
  it.each<StaffRoleId>(["writer", "admin", "super_admin"])(
    "continues to allow %s through admin.access",
    async (role) => {
      setStaffIdentity([role]);

      render(await AdminPage());

      expect(screen.getByRole("heading", { name: "Admin foundation" })).toBeTruthy();
      expect(mocks.redirect).not.toHaveBeenCalled();
      expect(mocks.forbidden).not.toHaveBeenCalled();
    },
  );

  it("continues to redirect unauthenticated users to the existing login", async () => {
    mocks.getCurrentIdentityAccess.mockResolvedValue({ authenticated: false, identityAccess: null });

    await expect(AdminPage()).rejects.toThrow("NEXT_REDIRECT:/admin/login?returnTo=%2Fadmin");
  });

  it("continues to forbid ordinary Accounts", async () => {
    setStaffIdentity([]);

    await expect(AdminPage()).rejects.toThrow("NEXT_FORBIDDEN");
  });
});
