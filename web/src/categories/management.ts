export const CATEGORY_KINDS = ["article", "news"] as const;
export type CategoryKind = typeof CATEGORY_KINDS[number];
export type Category = { id: string; name: string; revision: number; createdAt: string; updatedAt: string };
export type CategoryQuery = { query: string; page: number };
export type CategoryPage = { items: Category[]; total: number; page: number; totalPages: number };
export class CategoryError extends Error {
  constructor(readonly code: string, readonly status: number, message: string) { super(message); }
}
export function categoryKind(value: unknown): CategoryKind {
  if (value !== "article" && value !== "news") invalidCategory();
  return value;
}
export const categoryPath = (kind: CategoryKind) => `/admin/${categoryKind(kind) === "article" ? "articles" : "news"}/categories`;
export function invalidCategory(): never { throw new CategoryError("VALIDATION_ERROR", 400, "Invalid category input"); }
export function categoryId(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || value.length > 128 || /[\p{Cc}/\\]/u.test(value)) invalidCategory();
  return value;
}
export function parseCategoryQuery(params: URLSearchParams): CategoryQuery {
  if ([...params.keys()].some(k => !["query", "page"].includes(k) || params.getAll(k).length !== 1)) invalidCategory();
  const query = (params.get("query") ?? "").trim(), page = params.get("page") ?? "1";
  if (query.length > 100 || /\p{Cc}/u.test(query) || !/^[1-9][0-9]{0,5}$/.test(page)) invalidCategory();
  return { query, page: Number(page) };
}
export function parseCategoryWrite(value: unknown, action: "create" | "edit" | "delete") {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalidCategory();
  const body = value as Record<string, unknown>;
  const keys = action === "create" ? ["name"] : action === "edit" ? ["name", "expectedRevision"] : ["expectedRevision", "confirmed"];
  if (Object.keys(body).some(k => !keys.includes(k))) invalidCategory();
  let name = "";
  if (action !== "delete") {
    if (typeof body.name !== "string") invalidCategory();
    name = body.name.trim();
    if (!name || [...name].length > 200 || /[\p{Cc}\p{Cf}]/u.test(name)) invalidCategory();
  }
  if (action !== "create" && (!Number.isInteger(body.expectedRevision) || Number(body.expectedRevision) < 0 || Number(body.expectedRevision) > 2_147_483_647 ||
    action === "edit" && body.expectedRevision === 2_147_483_647)) invalidCategory();
  if (action === "delete" && body.confirmed !== true) throw new CategoryError("CONFIRMATION_REQUIRED", 400, "Explicit deletion confirmation required");
  return { name, expectedRevision: Number(body.expectedRevision) };
}
