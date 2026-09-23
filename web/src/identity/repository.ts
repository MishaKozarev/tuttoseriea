import "server-only";

import { eq, sql } from "drizzle-orm";

import { getDb } from "@/src/db";
import {
  identityAccountRoles,
  identityAccounts,
  users,
} from "@/src/db/schema";
import { normalizeIdentityEmail } from "@/src/identity/email";
import {
  isStaffRoleId,
  type PermissionId,
  type StaffRoleId,
  hasPermissionForRoles,
} from "@/src/identity/rbac";

export type IdentityAccess = {
  accountId: string;
  authUserId: string;
  email: string | null;
  roles: StaffRoleId[];
};

type IdentityAccessRow = {
  accountId: string;
  authUserId: string;
  email: string | null;
  roleId: string | null;
};

function identityAccessFromRows(rows: IdentityAccessRow[]): IdentityAccess | null {
  const firstRow = rows[0];

  if (!firstRow) {
    return null;
  }

  return {
    accountId: firstRow.accountId,
    authUserId: firstRow.authUserId,
    email: firstRow.email,
    roles: [
      ...new Set(
        rows
          .map((row) => row.roleId)
          .filter((roleId): roleId is StaffRoleId => roleId != null && isStaffRoleId(roleId)),
      ),
    ],
  };
}

export async function getIdentityAccessByAuthUserId(
  authUserId: string,
): Promise<IdentityAccess | null> {
  const rows = await getDb()
    .select({
      accountId: identityAccounts.id,
      authUserId: identityAccounts.authUserId,
      email: users.email,
      roleId: identityAccountRoles.roleId,
    })
    .from(identityAccounts)
    .innerJoin(users, eq(users.id, identityAccounts.authUserId))
    .leftJoin(identityAccountRoles, eq(identityAccountRoles.accountId, identityAccounts.id))
    .where(eq(identityAccounts.authUserId, authUserId));

  return identityAccessFromRows(rows);
}

export async function getIdentityAccessByEmail(
  email: string,
): Promise<IdentityAccess | null> {
  const normalizedEmail = normalizeIdentityEmail(email);

  if (!normalizedEmail) {
    return null;
  }

  const rows = await getDb()
    .select({
      accountId: identityAccounts.id,
      authUserId: identityAccounts.authUserId,
      email: users.email,
      roleId: identityAccountRoles.roleId,
    })
    .from(users)
    .innerJoin(identityAccounts, eq(identityAccounts.authUserId, users.id))
    .leftJoin(identityAccountRoles, eq(identityAccountRoles.accountId, identityAccounts.id))
    .where(sql`lower(${users.email}) = ${normalizedEmail}`);

  return identityAccessFromRows(rows);
}

export async function emailHasPermission(
  email: string,
  permissionId: PermissionId,
): Promise<boolean> {
  const identityAccess = await getIdentityAccessByEmail(email);

  return identityAccess
    ? hasPermissionForRoles(identityAccess.roles, permissionId)
    : false;
}
