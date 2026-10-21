import { describe, expect, it } from "vitest";

import {
  createAdminLoginPath,
  resolveAdminAuthRedirectUrl,
  resolveAdminReturnPath,
} from "@/src/identity/admin-return";
import { decideAdminAccess } from "@/src/identity/admin-access";
import {
  PERMISSION_IDS,
  getPermissionsForRoles,
  hasPermissionForRoles,
} from "@/src/identity/rbac";

describe("Identity RBAC foundation", () => {
  it("maps every approved staff role to admin.access", () => {
    expect(getPermissionsForRoles(["writer"])).toEqual([PERMISSION_IDS.adminAccess]);
    expect(getPermissionsForRoles(["admin"])).toEqual([PERMISSION_IDS.adminAccess]);
    expect(getPermissionsForRoles(["super_admin"])).toEqual([
      PERMISSION_IDS.adminAccess,
      PERMISSION_IDS.footballAdmin,
      PERMISSION_IDS.articleCategoriesManage,
      PERMISSION_IDS.newsCategoriesManage,
    ]);
  });

  it("grants football.admin exclusively to super_admin", () => {
    expect(hasPermissionForRoles([], PERMISSION_IDS.footballAdmin)).toBe(false);
    expect(hasPermissionForRoles(["writer"], PERMISSION_IDS.footballAdmin)).toBe(false);
    expect(hasPermissionForRoles(["admin"], PERMISSION_IDS.footballAdmin)).toBe(false);
    expect(
      hasPermissionForRoles(["writer", "admin"], PERMISSION_IDS.footballAdmin),
    ).toBe(false);
    expect(
      getPermissionsForRoles(["writer", "admin", "super_admin"]),
    ).toEqual([PERMISSION_IDS.adminAccess, PERMISSION_IDS.footballAdmin, PERMISSION_IDS.articleCategoriesManage, PERMISSION_IDS.newsCategoriesManage]);
  });

  it("deduplicates effective permissions across multiple roles", () => {
    expect(getPermissionsForRoles(["writer", "admin"])).toEqual([
      PERMISSION_IDS.adminAccess,
    ]);
  });

  it("keeps ordinary accounts without roles out of admin.access", () => {
    expect(hasPermissionForRoles([], PERMISSION_IDS.adminAccess)).toBe(false);
  });
});

describe("admin return path", () => {
  it("allows only relative paths inside the admin subtree", () => {
    expect(resolveAdminReturnPath("/admin")).toBe("/admin");
    expect(resolveAdminReturnPath("/admin/articles?draft=1")).toBe(
      "/admin/articles?draft=1",
    );
    expect(resolveAdminReturnPath("/")).toBe("/admin");
    expect(resolveAdminReturnPath("/administrator")).toBe("/admin");
    expect(resolveAdminReturnPath("https://example.com/admin")).toBe("/admin");
  });

  it("builds login URLs with a sanitized return path", () => {
    expect(createAdminLoginPath("/admin/articles")).toBe(
      "/admin/login?returnTo=%2Fadmin%2Farticles",
    );
    expect(createAdminLoginPath("https://example.com/admin")).toBe(
      "/admin/login?returnTo=%2Fadmin",
    );
  });

  it("keeps authentication callback redirects inside the admin subtree", () => {
    expect(resolveAdminAuthRedirectUrl("/admin", "https://tuttoseriea.test")).toBe(
      "https://tuttoseriea.test/admin",
    );
    expect(
      resolveAdminAuthRedirectUrl(
        "https://evil.example/admin",
        "https://tuttoseriea.test",
      ),
    ).toBe("https://tuttoseriea.test/admin");
  });
});

describe("admin access decision", () => {
  it("redirects unauthenticated users to admin login", () => {
    expect(
      decideAdminAccess(
        {
          authenticated: false,
          identityAccess: null,
        },
        "/admin/articles",
      ),
    ).toEqual({
      location: "/admin/login?returnTo=%2Fadmin%2Farticles",
      type: "redirect",
    });
  });

  it("forbids authenticated accounts without admin.access", () => {
    expect(
      decideAdminAccess({
        authenticated: true,
        mfaRequired: false,
        identityAccess: {
          accountId: "account-id",
          authUserId: "auth-user-id",
          email: "ordinary@example.invalid",
          roles: [],
        },
      }),
    ).toEqual({ type: "forbidden" });
  });

  it("allows authenticated accounts with admin.access", () => {
    expect(
      decideAdminAccess({
        authenticated: true,
        mfaRequired: false,
        identityAccess: {
          accountId: "account-id",
          authUserId: "auth-user-id",
          email: "writer@example.invalid",
          roles: ["writer"],
        },
      }),
    ).toEqual({ type: "allowed" });
  });
});

describe("MFA authorization boundary", () => {
  it("keeps an authenticated super admin outside protected operations until MFA", () => {
    expect(decideAdminAccess({ authenticated: true, mfaRequired: true,
      identityAccess: { accountId: "account", authUserId: "user", email: "staff@example.invalid", roles: ["super_admin"] } }, "/admin/football"))
      .toEqual({ type: "redirect", location: "/admin/login/two-factor?returnTo=%2Fadmin%2Ffootball" });
  });
});
