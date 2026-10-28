// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { writerAdminFixture, writerProfileFixture } from "../fixtures/writers";

const mocks = vi.hoisted(() => ({ session: vi.fn(), list: vi.fn(), profile: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/src/identity/session", () => ({ getCurrentIdentityAccess: mocks.session }));
vi.mock("@/src/identity/writer-service", () => ({ listWriters: mocks.list, getOwnWriterProfile: mocks.profile }));
vi.mock("next/navigation", () => ({ redirect: (path: string) => { throw Error(`REDIRECT:${path}`); }, forbidden: () => { throw Error("FORBIDDEN"); } }));
import WritersPage from "@/app/admin/writers/page";
import WriterProfilePage from "@/app/admin/profile/page";

function current(roles: string[], mfaRequired = false) { return { authenticated: true, mfaRequired, identityAccess: { accountId: "actor", authUserId: "user", roles } }; }
beforeEach(() => { vi.resetAllMocks(); mocks.list.mockResolvedValue([writerAdminFixture()]); mocks.profile.mockResolvedValue(writerProfileFixture()); });
afterEach(cleanup);

describe("Writer server pages", () => {
  it("redirects anonymous users before any data read", async () => {
    mocks.session.mockResolvedValue({ authenticated: false, identityAccess: null });
    await expect(WritersPage()).rejects.toThrow("REDIRECT:/admin/login?returnTo=%2Fadmin%2Fwriters");
    await expect(WriterProfilePage()).rejects.toThrow("REDIRECT:/admin/login?returnTo=%2Fadmin%2Fprofile");
    expect(mocks.list).not.toHaveBeenCalled(); expect(mocks.profile).not.toHaveBeenCalled();
  });
  it.each([[], ["writer"], ["admin"], ["writer", "admin"]].map(roles => ({ roles })))("keeps Writer management restricted for $roles", async ({ roles }) => {
    mocks.session.mockResolvedValue(current(roles)); await expect(WritersPage()).rejects.toThrow("FORBIDDEN"); expect(mocks.list).not.toHaveBeenCalled();
  });
  it("requires full Super Admin MFA before protected management reads", async () => {
    mocks.session.mockResolvedValue(current(["super_admin"], true)); await expect(WritersPage()).rejects.toThrow("REDIRECT:/admin/login/two-factor"); expect(mocks.list).not.toHaveBeenCalled();
  });
  it.each([[], ["admin"], ["super_admin"]].map(roles => ({ roles })))("requires the actual Writer permission for own profile $roles", async ({ roles }) => {
    mocks.session.mockResolvedValue(current(roles)); await expect(WriterProfilePage()).rejects.toThrow("FORBIDDEN"); expect(mocks.profile).not.toHaveBeenCalled();
  });
  it("renders the management and own-profile surfaces for their authorized accounts", async () => {
    mocks.session.mockResolvedValue(current(["super_admin"])); render(await WritersPage()); expect(screen.getByRole("heading", { name: "Управление авторами" })).toBeTruthy(); cleanup();
    mocks.session.mockResolvedValue(current(["writer"])); render(await WriterProfilePage()); expect(screen.getByRole("heading", { name: "Кабинет автора" })).toBeTruthy();
  });
  it("shows a safe failure instead of an editing form if persistence is unavailable", async () => {
    mocks.session.mockResolvedValue(current(["writer"])); mocks.profile.mockRejectedValue(new Error("private SQL"));
    render(await WriterProfilePage()); expect(screen.getByRole("alert").textContent).toContain("Не удалось"); expect(document.body.textContent).not.toContain("private SQL"); expect(screen.queryByRole("button", { name: "Сохранить профиль" })).toBeNull();
  });
});
