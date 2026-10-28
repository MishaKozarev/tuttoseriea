import "server-only";
import { getCurrentIdentityAccess } from "./session";
import { decideAdminAccess } from "./admin-access";
import { hasIdentityPermission, PERMISSION_IDS, type PermissionId } from "./rbac";

async function decide(permission: PermissionId, returnTo: string) {
  const current = await getCurrentIdentityAccess();
  const decision = decideAdminAccess(current, returnTo);
  if (decision.type !== "allowed") return decision;
  if (!current.identityAccess || !hasIdentityPermission(current.identityAccess, permission)) return { type: "forbidden" as const };
  return { type: "allowed" as const, identityAccess: current.identityAccess };
}
export function getWriterManagementAccess(returnTo = "/admin/writers") {
  return decide(PERMISSION_IDS.writerAccountsManage, returnTo);
}
export function getOwnWriterAccess(returnTo = "/admin/profile") {
  return decide(PERMISSION_IDS.writerProfileManage, returnTo);
}
