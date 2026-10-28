import { ApplicationError } from "../api/errors";
import { normalizeIdentityEmail } from "./email";
import type { StaffRoleId } from "./rbac";

export type SocialLink = { label: string; url: string };
export type WriterProfileDTO = {
  accountId: string; nickname: string; socialLinks: SocialLink[];
  avatarMediaId: string | null; avatarUrl: string | null; revision: number;
  canPublishOwn: boolean; publicationRevision: number;
};
export type WriterAdminDTO = {
  accountId: string; email: string; roles: StaffRoleId[]; status: "active" | "disabled";
  profile: WriterProfileDTO; canPublishOwn: boolean; publicationRevision: number; isWriter: boolean;
};
export type MediaAssetInput = {
  id: string; storageKey: string; mimeType: "image/webp"; byteSize: number;
  width: number; height: number; sha256: string; uploaderAccountId: string;
};
export const WRITER_NICKNAME_MAX = 60;
export const WRITER_SOCIAL_LINKS_MAX = 10;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const control = /[\p{Cc}\p{Cf}]/u;
export function writerError(code: string, status = 400): never {
  throw new ApplicationError({ code, status, message: ({ WRITER_CONFLICT: "Данные изменились. Обновите страницу.", WRITER_ACCOUNT_EXISTS: "Аккаунт уже существует. Используйте назначение роли.", WRITER_NOT_FOUND: "Аккаунт не найден." } as Record<string, string>)[code] ?? "Не удалось выполнить операцию с профилем автора." });
}
export function writerRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) writerError("VALIDATION_ERROR");
  return value as Record<string, unknown>;
}
export function writerFields(value: Record<string, unknown>, fields: string[]) {
  if (Object.keys(value).some(key => !fields.includes(key))) writerError("VALIDATION_ERROR");
}
export function writerId(value: unknown): string {
  if (typeof value !== "string" || !uuid.test(value)) writerError("VALIDATION_ERROR");
  return value;
}
export function writerAccountId(value: unknown): string {
  // Earlier Identity IDs can be stable non-UUID text. Do not rewrite them.
  if (typeof value !== "string" || !value || value.length > 200 || control.test(value)) writerError("VALIDATION_ERROR");
  return value;
}
export function writerRevision(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value >= 2147483647) writerError("VALIDATION_ERROR");
  return value;
}
export function writerEmail(value: unknown): string {
  const email = normalizeIdentityEmail(value);
  if (!email || email.length > 254 || /\s/u.test(email) || control.test(email)) writerError("VALIDATION_ERROR");
  return email;
}
export function parseProfileEdit(value: unknown) {
  const input = writerRecord(value);
  writerFields(input, ["nickname", "socialLinks", "expectedRevision", "operationId"]);
  const nickname = typeof input.nickname === "string" ? input.nickname.trim() : "";
  if (!nickname || nickname.length > WRITER_NICKNAME_MAX || control.test(nickname)) writerError("VALIDATION_ERROR");
  if (!Array.isArray(input.socialLinks) || input.socialLinks.length > WRITER_SOCIAL_LINKS_MAX) writerError("VALIDATION_ERROR");
  const socialLinks = input.socialLinks.map(value => {
    const link = writerRecord(value); writerFields(link, ["label", "url"]);
    const label = typeof link.label === "string" ? link.label.trim() : "";
    if (!label || label.length > 60 || control.test(label) || typeof link.url !== "string" || link.url.length > 2048 || control.test(link.url)) writerError("VALIDATION_ERROR");
    let url: URL;
    try { url = new URL(link.url); } catch { writerError("VALIDATION_ERROR"); }
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || !url.hostname) writerError("VALIDATION_ERROR");
    return { label, url: url.href };
  });
  return { nickname, socialLinks, expectedRevision: writerRevision(input.expectedRevision), operationId: writerId(input.operationId) };
}
