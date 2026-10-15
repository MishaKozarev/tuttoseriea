import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getCurrentIdentityAccess: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("@/src/identity/session", () => ({
  getCurrentIdentityAccess: mocks.getCurrentIdentityAccess,
}));

import { ApplicationError, serializeApiError } from "@/src/api/errors";
import {
  getFootballAdminAccess,
  requireFootballAdminAccess,
} from "@/src/identity/football-admin-access";
import type { StaffRoleId } from "@/src/identity/rbac";
import type { CurrentIdentityAccess } from "@/src/identity/session";

function authenticatedIdentity(roles: StaffRoleId[]): CurrentIdentityAccess {
  return {
    authenticated: true,
    identityAccess: {
      accountId: "account-id",
      authUserId: "auth-user-id",
      email: "staff@example.invalid",
      roles,
    },
  };
}

const accessCases: { label: string; roles: StaffRoleId[]; allowed: boolean }[] = [
  { label: "ordinary Account", roles: [], allowed: false },
  { label: "writer", roles: ["writer"], allowed: false },
  { label: "admin", roles: ["admin"], allowed: false },
  { label: "writer and admin", roles: ["writer", "admin"], allowed: false },
  { label: "super_admin", roles: ["super_admin"], allowed: true },
  { label: "writer and super_admin", roles: ["writer", "super_admin"], allowed: true },
  { label: "admin and super_admin", roles: ["admin", "super_admin"], allowed: true },
  { label: "all staff roles", roles: ["writer", "admin", "super_admin"], allowed: true },
];

beforeEach(() => vi.resetAllMocks());

describe("server-side Football Admin access", () => {
  it("uses staff login with the Football return path for unauthenticated users", async () => {
    mocks.getCurrentIdentityAccess.mockResolvedValue({
      authenticated: false,
      identityAccess: null,
    });

    await expect(getFootballAdminAccess()).resolves.toEqual({
      type: "redirect",
      location: "/admin/login?returnTo=%2Fadmin%2Ffootball",
    });
    await expect(getFootballAdminAccess("/admin/football/clubs?review=1")).resolves.toEqual({
      type: "redirect",
      location: "/admin/login?returnTo=%2Fadmin%2Ffootball%2Fclubs%3Freview%3D1",
    });
    await expect(getFootballAdminAccess("https://example.invalid/admin")).resolves.toEqual({
      type: "redirect",
      location: "/admin/login?returnTo=%2Fadmin",
    });
  });

  it("forbids an authenticated session without a domain Identity", async () => {
    mocks.getCurrentIdentityAccess.mockResolvedValue({
      authenticated: true,
      identityAccess: null,
    });

    await expect(getFootballAdminAccess()).resolves.toEqual({ type: "forbidden" });
  });

  it.each(accessCases)("enforces football.admin for $label", async ({ roles, allowed }) => {
    const currentIdentity = authenticatedIdentity(roles);
    mocks.getCurrentIdentityAccess.mockResolvedValue(currentIdentity);

    await expect(getFootballAdminAccess()).resolves.toEqual(
      allowed
        ? { type: "allowed", identityAccess: currentIdentity.identityAccess }
        : { type: "forbidden" },
    );
    expect(mocks.getCurrentIdentityAccess).toHaveBeenCalledOnce();
  });
});

describe("Football Admin server-operation guard", () => {
  it.each(accessCases)("authorizes operations for $label", async ({ roles, allowed }) => {
    const currentIdentity = authenticatedIdentity(roles);
    mocks.getCurrentIdentityAccess.mockResolvedValue(currentIdentity);

    if (allowed) {
      await expect(requireFootballAdminAccess()).resolves.toBe(currentIdentity.identityAccess);
    } else {
      await expect(requireFootballAdminAccess()).rejects.toMatchObject({
        code: "FORBIDDEN",
        status: 403,
      });
    }
  });

  it.each([
    { authenticated: false, code: "UNAUTHORIZED", status: 401 },
    { authenticated: true, code: "FORBIDDEN", status: 403 },
  ])("preserves the $status application error contract", async ({ authenticated, code, status }) => {
    mocks.getCurrentIdentityAccess.mockResolvedValue({ authenticated, identityAccess: null });

    const error = await requireFootballAdminAccess().catch((failure: unknown) => failure);

    expect(error).toBeInstanceOf(ApplicationError);
    expect(serializeApiError(error, "football-admin-test")).toEqual({
      status,
      body: {
        error: {
          code,
          message: status === 401 ? "Authentication required" : "Access denied",
          requestId: "football-admin-test",
        },
      },
    });
  });

  it("rechecks current roles and denies access after super_admin is removed", async () => {
    const superAdminIdentity = authenticatedIdentity(["super_admin"]);
    mocks.getCurrentIdentityAccess
      .mockResolvedValueOnce(superAdminIdentity)
      .mockResolvedValueOnce(authenticatedIdentity(["admin"]));

    await expect(requireFootballAdminAccess()).resolves.toBe(superAdminIdentity.identityAccess);
    await expect(requireFootballAdminAccess()).rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });
    expect(mocks.getCurrentIdentityAccess).toHaveBeenCalledTimes(2);
  });

  it("fails closed when current Identity lookup fails", async () => {
    const failure = new Error("Identity lookup unavailable");
    mocks.getCurrentIdentityAccess.mockRejectedValue(failure);

    await expect(getFootballAdminAccess()).rejects.toBe(failure);
    await expect(requireFootballAdminAccess()).rejects.toBe(failure);
  });
});
