import "server-only";
import { createHmac } from "node:crypto";
import { hashPassword } from "better-auth/crypto";
import type { PoolClient, QueryResultRow } from "pg";
import { getDbPool } from "../db";
import { getAuthConfig, validStaffPassword } from "../auth/config";
import { getStaffMutationActor } from "../auth/session";
import { createForbiddenError, createUnauthorizedError } from "../api/access";
import { getIdentityAccessByAuthUserId } from "./repository";
import { hasIdentityPermission, isStaffRoleId, PERMISSION_IDS, type PermissionId } from "./rbac";
import { parseProfileEdit, writerAccountId, writerEmail, writerError, writerFields, writerId, writerRecord, writerRevision, type MediaAssetInput, type WriterAdminDTO, type WriterProfileDTO } from "./writer-contract";

export type { WriterAdminDTO, WriterProfileDTO, MediaAssetInput } from "./writer-contract";
export type WriterActor = { sessionToken: string; accountId: string; authUserId: string };
async function requireActor(permission: PermissionId): Promise<WriterActor> {
  const actor = await getStaffMutationActor();
  if (!actor) throw createUnauthorizedError();
  const identity = await getIdentityAccessByAuthUserId(actor.authUserId);
  if (!identity || !hasIdentityPermission(identity, permission)) throw createForbiddenError();
  return actor;
}
export function requireWriterManagementAccess() { return requireActor(PERMISSION_IDS.writerAccountsManage); }
export function requireWriterPublicationAccess() { return requireActor(PERMISSION_IDS.writerPublicationManage); }
export function requireOwnWriterAccess() { return requireActor(PERMISSION_IDS.writerProfileManage); }

type ProfileRow = QueryResultRow & {
  accountId: string; nickname: string | null; socialLinks: WriterProfileDTO["socialLinks"] | null;
  avatarMediaId: string | null; revision: number | null; canPublishOwn: boolean; publicationRevision: number;
};
const profileSql = `select a.id as "accountId",p.nickname,p.social_links as "socialLinks",p.avatar_media_id as "avatarMediaId",p.revision,
  coalesce(g.granted,false) and exists(select 1 from identity.account_roles wr where wr.account_id=a.id and wr.role_id='writer') as "canPublishOwn",
  coalesce(g.revision,0) as "publicationRevision" from identity.accounts a
  left join identity.writer_profiles p on p.account_id=a.id
  left join identity.account_permission_assignments g on g.account_id=a.id and g.permission_id='article.publish.own'`;
function profileDto(row: ProfileRow): WriterProfileDTO {
  return { accountId: row.accountId, nickname: row.nickname ?? "", socialLinks: row.socialLinks ?? [], avatarMediaId: row.avatarMediaId,
    avatarUrl: row.avatarMediaId ? `/media/public/${row.avatarMediaId}.webp` : null, revision: row.revision ?? 0,
    canPublishOwn: row.canPublishOwn, publicationRevision: row.publicationRevision };
}
async function readProfile(accountId: string, client: Pick<PoolClient, "query"> = getDbPool()) {
  const result = await client.query<ProfileRow>(`${profileSql} where a.id=$1`, [accountId]);
  if (!result.rows[0]) writerError("WRITER_NOT_FOUND", 404);
  return profileDto(result.rows[0]);
}
export async function getOwnWriterProfile(): Promise<WriterProfileDTO> {
  const actor = await requireOwnWriterAccess();
  return readProfile(actor.accountId);
}
export async function listWriters(email?: string): Promise<WriterAdminDTO[]> {
  await requireWriterManagementAccess();
  const filterEmail = email === undefined ? null : writerEmail(email);
  const rows = (await getDbPool().query(`${profileSql} ${filterEmail ? "where a.auth_user_id=(select id from auth.users where email=$1)" : "where exists(select 1 from identity.account_roles wr where wr.account_id=a.id and wr.role_id='writer')"}
    order by a.created_at desc,a.id limit 50`, filterEmail ? [filterEmail] : [])).rows as ProfileRow[];
  if (!rows.length) return [];
  const accounts = (await getDbPool().query<{ accountId: string; email: string; status: "active" | "disabled"; roles: string[] }>(`select a.id as "accountId",u.email,a.status,
    coalesce(array_agg(r.role_id) filter(where r.role_id is not null),'{}') as roles from identity.accounts a join auth.users u on u.id=a.auth_user_id
    left join identity.account_roles r on r.account_id=a.id where a.id=any($1::text[]) group by a.id,u.email`, [rows.map(row => row.accountId)])).rows;
  return rows.map(row => {
    const account = accounts.find(account => account.accountId === row.accountId)!;
    const profile = profileDto(row);
    return { ...account, roles: account.roles.filter(isStaffRoleId), profile, canPublishOwn: profile.canPublishOwn, publicationRevision: profile.publicationRevision, isWriter: account.roles.includes("writer") };
  });
}

function fingerprint(action: string, input: unknown): string {
  return createHmac("sha256", getAuthConfig().secret).update(JSON.stringify([action, input])).digest("hex");
}
function mapDbError(error: unknown): never {
  const message = error && typeof error === "object" && "message" in error ? String(error.message) : "";
  const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
  if (["WRITER_CONFLICT", "WRITER_ACCOUNT_EXISTS", "WRITER_OPERATION_CONFLICT"].includes(message)) writerError(message, 409);
  if (message === "WRITER_NOT_FOUND") writerError(message, 404);
  if (message === "WRITER_FORBIDDEN") throw createForbiddenError();
  if (message === "WRITER_UNAUTHORIZED") throw createUnauthorizedError();
  if (message === "WRITER_VALIDATION_ERROR" || code === "23514") writerError("VALIDATION_ERROR");
  throw error;
}
async function command(actor: WriterActor, action: string, target: string | null, payload: unknown, operationId: string, digest: string, client: Pick<PoolClient, "query"> = getDbPool()) {
  try {
    return (await client.query<{ result: { accountId: string; revision?: number } }>(`select identity.writer_command($1,$2,$3,$4::jsonb,$5,$6) as result`,
      [actor.sessionToken, action, target, JSON.stringify(payload), operationId, digest])).rows[0].result;
  } catch (error) { mapDbError(error); }
}
export async function createWriter(value: unknown): Promise<WriterAdminDTO> {
  const actor = await requireWriterManagementAccess();
  const input = writerRecord(value); writerFields(input, ["email", "password", "operationId"]);
  const email = writerEmail(input.email), operationId = writerId(input.operationId);
  if (!validStaffPassword(input.password)) writerError("VALIDATION_ERROR");
  const digest = fingerprint("create_writer", { email, password: input.password });
  const passwordHash = await hashPassword(input.password);
  await command(actor, "create_writer", null, { email, passwordHash }, operationId, digest);
  return (await listWriters(email))[0];
}
export async function attachWriter(value: unknown): Promise<WriterAdminDTO> {
  const actor = await requireWriterManagementAccess();
  const input = writerRecord(value); writerFields(input, ["accountId", "operationId"]);
  const accountId = writerAccountId(input.accountId), operationId = writerId(input.operationId);
  await command(actor, "attach_writer", accountId, {}, operationId, fingerprint("attach_writer", { accountId }));
  const profile = await readProfile(accountId);
  const email = (await getDbPool().query<{ email: string }>(`select u.email from identity.accounts a join auth.users u on u.id=a.auth_user_id where a.id=$1`, [accountId])).rows[0].email;
  return { ...(await listWriters(email))[0], profile };
}
export async function setWriterPublishOwn(value: unknown): Promise<WriterProfileDTO> {
  const actor = await requireWriterPublicationAccess();
  const input = writerRecord(value); writerFields(input, ["accountId", "enabled", "expectedRevision", "operationId"]);
  const accountId = writerAccountId(input.accountId), operationId = writerId(input.operationId), expectedRevision = writerRevision(input.expectedRevision);
  if (typeof input.enabled !== "boolean") writerError("VALIDATION_ERROR");
  const payload = { enabled: input.enabled, expectedRevision };
  await command(actor, "publish_own", accountId, payload, operationId, fingerprint("publish_own", { accountId, ...payload }));
  return readProfile(accountId);
}
export async function updateOwnWriterProfile(value: unknown): Promise<WriterProfileDTO> {
  const actor = await requireOwnWriterAccess();
  const input = parseProfileEdit(value);
  await command(actor, "profile", actor.accountId, { nickname: input.nickname, socialLinks: input.socialLinks, expectedRevision: input.expectedRevision }, input.operationId, fingerprint("profile", input));
  return readProfile(actor.accountId);
}
export async function attachOwnAvatar(input: { actor: WriterActor; asset: MediaAssetInput; expectedRevision: number; operationId: string }): Promise<WriterProfileDTO> {
  const { actor, asset } = input;
  writerId(asset.id); writerId(input.operationId); writerRevision(input.expectedRevision);
  if (asset.uploaderAccountId !== actor.accountId) throw createForbiddenError();
  const client = await getDbPool().connect();
  try {
    await client.query("begin");
    await client.query(`insert into media.assets(id,storage_key,mime_type,byte_size,width,height,sha256,uploader_account_id)
      values($1,$2,$3,$4,$5,$6,$7,$8)`, [asset.id, asset.storageKey, asset.mimeType, asset.byteSize, asset.width, asset.height, asset.sha256, actor.accountId]);
    await command(actor, "avatar", actor.accountId, { mediaId: asset.id, expectedRevision: input.expectedRevision }, input.operationId,
      fingerprint("avatar", { id: asset.id, sha256: asset.sha256, expectedRevision: input.expectedRevision }), client);
    const profile = await readProfile(actor.accountId, client);
    await client.query("commit"); return profile;
  } catch (error) { await client.query("rollback"); mapDbError(error); }
  finally { client.release(); }
}
