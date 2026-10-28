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
  hasIdentityPermission,
} from "@/src/identity/rbac";

export type IdentityAccess = {
  accountId: string;
  authUserId: string;
  email: string | null;
  roles: StaffRoleId[];
  status?: string;
  permissions?: PermissionId[];
};

type IdentityAccessRow = {
  accountId: string;
  authUserId: string;
  email: string | null;
  roleId: string | null;
  status: string;
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
    status: firstRow.status,
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
      status: identityAccounts.status,
    })
    .from(identityAccounts)
    .innerJoin(users, eq(users.id, identityAccounts.authUserId))
    .leftJoin(identityAccountRoles, eq(identityAccountRoles.accountId, identityAccounts.id))
    .where(eq(identityAccounts.authUserId, authUserId));

  const identity = identityAccessFromRows(rows);
  if (identity) {
    const result = await getDb().execute(sql`select permission_id from identity.account_permission_assignments where account_id=${identity.accountId} and granted=true`);
    identity.permissions = identity.roles.includes("writer") && result.rows.some(row => row.permission_id === "article.publish.own") ? ["article.publish.own"] : [];
  }
  return identity;
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
      status: identityAccounts.status,
    })
    .from(users)
    .innerJoin(identityAccounts, eq(identityAccounts.authUserId, users.id))
    .leftJoin(identityAccountRoles, eq(identityAccountRoles.accountId, identityAccounts.id))
    .where(sql`lower(${users.email}) = ${normalizedEmail}`);

  const identity = identityAccessFromRows(rows);
  return identity ? getIdentityAccessByAuthUserId(identity.authUserId) : null;
}

export async function emailHasPermission(
  email: string,
  permissionId: PermissionId,
): Promise<boolean> {
  const identityAccess = await getIdentityAccessByEmail(email);

  return identityAccess
    ? hasIdentityPermission(identityAccess, permissionId)
    : false;
}
