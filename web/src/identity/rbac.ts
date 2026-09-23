export const STAFF_ROLE_IDS = ["writer", "admin", "super_admin"] as const;

export type StaffRoleId = (typeof STAFF_ROLE_IDS)[number];

export const PERMISSION_IDS = {
  adminAccess: "admin.access",
} as const;

export type PermissionId = (typeof PERMISSION_IDS)[keyof typeof PERMISSION_IDS];

const rolePermissions: Record<StaffRoleId, readonly PermissionId[]> = {
  admin: [PERMISSION_IDS.adminAccess],
  super_admin: [PERMISSION_IDS.adminAccess],
  writer: [PERMISSION_IDS.adminAccess],
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
