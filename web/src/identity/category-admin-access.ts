import "server-only";
import { createForbiddenError, createUnauthorizedError } from "../api/access";
import { decideAdminAccess } from "./admin-access";
import { getCurrentIdentityAccess } from "./session";
import { hasPermissionForRoles, PERMISSION_IDS } from "./rbac";
import { categoryKind, categoryPath, type CategoryKind } from "../categories/management";

export async function getCategoryAdminAccess(kind: CategoryKind) {
  kind = categoryKind(kind);
  const current = await getCurrentIdentityAccess();
  const decision = decideAdminAccess(current, categoryPath(kind));
  if (decision.type !== "allowed") return decision;
  const identity = current.identityAccess;
  const permission = kind === "article" ? PERMISSION_IDS.articleCategoriesManage : PERMISSION_IDS.newsCategoriesManage;
  if (!identity || !hasPermissionForRoles(identity.roles, permission)) return { type: "forbidden" as const };
  return { type: "allowed" as const, identityAccess: identity };
}
export async function requireCategoryAdminAccess(kind: CategoryKind) {
  const decision = await getCategoryAdminAccess(kind);
  if (decision.type === "redirect") throw createUnauthorizedError();
  if (decision.type === "forbidden") throw createForbiddenError();
  return decision.identityAccess;
}
