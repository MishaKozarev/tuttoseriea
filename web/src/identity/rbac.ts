export const STAFF_ROLE_IDS = ["writer", "admin", "super_admin"] as const;

export type StaffRoleId = (typeof STAFF_ROLE_IDS)[number];

export const PERMISSION_IDS = {
  adminAccess: "admin.access",
  footballAdmin: "football.admin",
  articleCategoriesManage: "article.categories.manage",
  newsCategoriesManage: "news.categories.manage",
  writerAccountsManage: "writer.accounts.manage",
  writerPublicationManage: "writer.publication.manage",
  writerProfileManage: "writer.profile.manage",
  articlePublishOwn: "article.publish.own",
  articleDraftsOwn: "article.drafts.own",
  articleDraftsManage: "article.drafts.manage",
  articlePublicationsManage: "article.publications.manage",
} as const;

export type PermissionId = (typeof PERMISSION_IDS)[keyof typeof PERMISSION_IDS];

const rolePermissions: Record<StaffRoleId, readonly PermissionId[]> = {
  admin: [PERMISSION_IDS.adminAccess],
  super_admin: [PERMISSION_IDS.adminAccess, PERMISSION_IDS.footballAdmin, PERMISSION_IDS.articleCategoriesManage, PERMISSION_IDS.newsCategoriesManage, PERMISSION_IDS.writerAccountsManage, PERMISSION_IDS.writerPublicationManage, PERMISSION_IDS.articleDraftsOwn, PERMISSION_IDS.articleDraftsManage, PERMISSION_IDS.articlePublicationsManage],
  writer: [PERMISSION_IDS.adminAccess, PERMISSION_IDS.writerProfileManage, PERMISSION_IDS.articleDraftsOwn],
};

const staffRoleSet = new Set<string>(STAFF_ROLE_IDS);

export function isStaffRoleId(value: string): value is StaffRoleId {
  return staffRoleSet.has(value);
}

export function assertStaffRoleId(value: string): StaffRoleId {
  if (!isStaffRoleId(value)) {
    throw new Error(`Unknown staff role: ${value}`);
  }

  return value;
}

export function getPermissionsForRoles(roleIds: readonly StaffRoleId[]): PermissionId[] {
  return [...new Set(roleIds.flatMap((roleId) => rolePermissions[roleId]))];
}

export function hasPermissionForRoles(
  roleIds: readonly StaffRoleId[],
  permissionId: PermissionId,
): boolean {
  return getPermissionsForRoles(roleIds).includes(permissionId);
}

export function hasIdentityPermission(identity: { roles: readonly StaffRoleId[]; permissions?: readonly PermissionId[]; status?: string }, permission: PermissionId): boolean {
  if (identity.status === "disabled") return false;
  if (hasPermissionForRoles(identity.roles, permission)) return true;
  return permission === PERMISSION_IDS.articlePublishOwn && identity.roles.includes("writer") && !!identity.permissions?.includes(permission);
}
