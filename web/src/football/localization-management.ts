import type { FootballNameReviewStatus } from "./localization";

export const LOCALIZATION_KINDS = ["competitions", "clubs", "players"] as const;
export type LocalizationKind = typeof LOCALIZATION_KINDS[number];
export type LocalizationFilterStatus = "all" | "missing" | FootballNameReviewStatus;
export const LOCALIZATION_PAGE_SIZE = 20;
export const LOCALIZATION_NAME_LIMIT = 200;

export type FootballLocalizationEntity = {
  kind: LocalizationKind; id: string; slug: string; provider: string; providerName: string;
  nameRu: string | null; nameRuReviewStatus: FootballNameReviewStatus | null;
  localizationRevision: number; displayName: string;
};
export type FootballLocalizationQuery = {
  kind: LocalizationKind; query: string; status: LocalizationFilterStatus; page: number;
};
export type FootballLocalizationPage = {
  items: FootballLocalizationEntity[]; total: number; page: number; pageSize: number; totalPages: number;
};
export type FootballLocalizationEdit = { action: "save"; nameRu: string; expectedRevision: number } |
  { action: "review"; nameRu: string; expectedRevision: number; confirmed: true };
export class FootballLocalizationError extends Error {
  constructor(readonly code: string, readonly status: number, message: string) { super(message); }
}
function invalid(): never { throw new FootballLocalizationError("VALIDATION_ERROR", 400, "Invalid Football localization input"); }
export function localizationKind(value: unknown): LocalizationKind {
  if (typeof value !== "string" || !LOCALIZATION_KINDS.includes(value as LocalizationKind)) invalid();
  return value as LocalizationKind;
}
export function localizationId(value: unknown): string {
  // Identities are existing text IDs; no new UUID-only identity contract is imposed.
  if (typeof value !== "string" || !value.trim() || value.length > 128 || /[\p{Cc}/\\]/u.test(value)) invalid();
  return value;
}
export function normalizeLocalizationName(value: unknown): string {
  if (typeof value !== "string") invalid();
  const name = value.trim();
  if (!name || name.length > LOCALIZATION_NAME_LIMIT || /[\p{Cc}\p{Cf}]/u.test(name)) invalid();
  return name;
}
export function parseLocalizationQuery(params: URLSearchParams): FootballLocalizationQuery {
  const keys = ["kind", "query", "status", "page"];
  if ([...params.keys()].some((key) => !keys.includes(key) || params.getAll(key).length !== 1)) invalid();
  const kind = localizationKind(params.get("kind") ?? "clubs");
  const query = (params.get("query") ?? "").trim();
  const status = params.get("status") ?? "all";
  const page = params.get("page") ?? "1";
  if (query.length > 100 || /[\p{Cc}]/u.test(query) || !["all", "missing", "unreviewed", "reviewed"].includes(status) ||
      !/^[1-9][0-9]{0,5}$/.test(page)) invalid();
  return { kind, query, status: status as LocalizationFilterStatus, page: Number(page) };
}
export function parseLocalizationEdit(value: unknown): FootballLocalizationEdit {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid();
  const body = value as Record<string, unknown>;
  const allowed = body.action === "review" ? ["action", "nameRu", "expectedRevision", "confirmed"] : ["action", "nameRu", "expectedRevision"];
  if (Object.keys(body).some((key) => !allowed.includes(key)) || (body.action !== "save" && body.action !== "review") ||
      !Number.isInteger(body.expectedRevision) || Number(body.expectedRevision) < 0 || Number(body.expectedRevision) > 2_147_483_647) invalid();
  if (body.action === "review" && body.confirmed !== true) {
    throw new FootballLocalizationError("CONFIRMATION_REQUIRED", 400, "Explicit localization review confirmation required");
  }
  const fields = { nameRu: normalizeLocalizationName(body.nameRu), expectedRevision: body.expectedRevision as number };
  return body.action === "review" ? { action: "review", ...fields, confirmed: true } : { action: "save", ...fields };
}
