import "server-only";
import type { PoolClient } from "pg";
import { getStaffMutationActor } from "../auth/session";
import { AuthSecurityStore, fullStaffSession, type StaffSession } from "../auth/security-store";
import { getAuthConfig } from "../auth/config";
import { getDbPool } from "../db";
import { ApplicationError } from "../api/errors";
import { createForbiddenError, createUnauthorizedError } from "../api/access";
import { getCurrentIdentityAccess } from "../identity/session";
import { getIdentityAccessByAuthUserId } from "../identity/repository";
import { decideAdminAccess } from "../identity/admin-access";
import { createAdminLoginPath } from "../identity/admin-return";
import { hasIdentityPermission, hasPermissionForRoles, isStaffRoleId, PERMISSION_IDS } from "../identity/rbac";

export type ArticleActor = { sessionToken: string; accountId: string; authUserId: string; manageAll: boolean };

export function articleNotFound(): never {
  throw new ApplicationError({ code: "ARTICLE_NOT_FOUND", status: 404, message: "Черновик не найден." });
}

export async function requireArticleActor(): Promise<ArticleActor> {
  const actor = await getStaffMutationActor();
  if (!actor) throw createUnauthorizedError();
  const identity = await getIdentityAccessByAuthUserId(actor.authUserId);
  if (!identity || !hasIdentityPermission(identity, PERMISSION_IDS.articleDraftsOwn)) throw createForbiddenError();
  return { ...actor, manageAll: hasIdentityPermission(identity, PERMISSION_IDS.articleDraftsManage) };
}

export async function getArticlesAccess(returnTo = "/admin/articles") {
  const current = await getCurrentIdentityAccess();
  const decision = decideAdminAccess(current, returnTo);
  if (decision.type !== "allowed") return decision;
  if (!current.identityAccess || !hasIdentityPermission(current.identityAccess, PERMISSION_IDS.articleDraftsOwn)) return { type: "forbidden" as const };
  const actor = await getStaffMutationActor();
  if (!actor) return { type: "redirect" as const, location: createAdminLoginPath(returnTo) };
  return { type: "allowed" as const, actor: { ...actor, manageAll: hasIdentityPermission(current.identityAccess, PERMISSION_IDS.articleDraftsManage) } };
}

// Called before accepting an upload body. The write transaction independently
// rechecks the session, roles and object ownership after acquiring its locks.
export async function requireArticleDraftAccess(articleId: string): Promise<ArticleActor> {
  const actor = await requireArticleActor();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(articleId)) articleNotFound();
  const result = await getDbPool().query(`select a.id from article.articles a join article.drafts d on d.article_id=a.id
    where a.id=$1 and ($2::boolean or a.author_account_id=$3)`, [articleId, actor.manageAll, actor.accountId]);
  if (!result.rows.length) articleNotFound();
  return actor;
}

// Auth/operator/Writer capability mutations use the same canonical user lock.
// The fresh session read uses the wall clock after lock waiting, not transaction now().
export async function revalidateArticleActor(client: Pick<PoolClient, "query">, actor: ArticleActor): Promise<ArticleActor> {
  const store = new AuthSecurityStore(client, getAuthConfig().secret);
  await store.lock(actor.authUserId);
  const user = await store.user(actor.authUserId);
  const session = (await client.query<StaffSession>(`select id,user_id as "userId",security_revision as "securityRevision",
    mfa_verified_at as "mfaVerifiedAt",created_at as "createdAt" from auth.staff_sessions
    where token=$1 and expires_at>clock_timestamp()`, [actor.sessionToken])).rows[0] ?? null;
  if (!fullStaffSession(user, session) || user!.accountId !== actor.accountId) throw createUnauthorizedError();
  const roles = user!.roles.filter(isStaffRoleId);
  if (!hasPermissionForRoles(roles, PERMISSION_IDS.articleDraftsOwn)) throw createForbiddenError();
  return { ...actor, manageAll: hasPermissionForRoles(roles, PERMISSION_IDS.articleDraftsManage) };
}
