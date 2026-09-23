import {
  DEFAULT_ADMIN_RETURN_PATH,
  createAdminLoginPath,
} from "@/src/identity/admin-return";
import type { CurrentIdentityAccess } from "@/src/identity/session";
import { PERMISSION_IDS, hasPermissionForRoles } from "@/src/identity/rbac";

export type AdminAccessDecision =
  | {
      type: "allowed";
    }
  | {
      type: "forbidden";
    }
  | {
      type: "redirect";
      location: string;
    };

export function decideAdminAccess(
  currentIdentityAccess: CurrentIdentityAccess,
  returnTo: string = DEFAULT_ADMIN_RETURN_PATH,
): AdminAccessDecision {
  if (!currentIdentityAccess.authenticated) {
    return {
      type: "redirect",
      location: createAdminLoginPath(returnTo),
    };
  }

  if (
    !currentIdentityAccess.identityAccess ||
    !hasPermissionForRoles(
      currentIdentityAccess.identityAccess.roles,
      PERMISSION_IDS.adminAccess,
    )
  ) {
    return {
      type: "forbidden",
    };
  }

  return {
    type: "allowed",
  };
}
