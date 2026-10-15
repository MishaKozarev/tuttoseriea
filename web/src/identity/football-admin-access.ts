import "server-only";

import { createForbiddenError, createUnauthorizedError } from "@/src/api/access";
import { decideAdminAccess, type AdminAccessDecision } from "@/src/identity/admin-access";
import { PERMISSION_IDS, hasPermissionForRoles } from "@/src/identity/rbac";
import type { IdentityAccess } from "@/src/identity/repository";
import { getCurrentIdentityAccess } from "@/src/identity/session";

export type FootballAdminAccessDecision =
  | Exclude<AdminAccessDecision, { type: "allowed" }>
  | { type: "allowed"; identityAccess: IdentityAccess };

export async function getFootballAdminAccess(
  returnTo: string = "/admin/football",
): Promise<FootballAdminAccessDecision> {
  const currentIdentityAccess = await getCurrentIdentityAccess();
  const adminDecision = decideAdminAccess(currentIdentityAccess, returnTo);

  if (adminDecision.type !== "allowed") {
    return adminDecision;
  }

  const identityAccess = currentIdentityAccess.identityAccess;

  if (
    !identityAccess ||
    !hasPermissionForRoles(identityAccess.roles, PERMISSION_IDS.footballAdmin)
  ) {
    return { type: "forbidden" };
  }

  return { type: "allowed", identityAccess };
}

export async function requireFootballAdminAccess(): Promise<IdentityAccess> {
  const decision = await getFootballAdminAccess();

  if (decision.type === "redirect") {
    throw createUnauthorizedError();
  }

  if (decision.type === "forbidden") {
    throw createForbiddenError();
  }

  return decision.identityAccess;
}
