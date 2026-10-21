import { FOOTBALL_TAG_SOURCES, type FootballTagKind } from "../football/tagged-upsert";
export type { FootballTagKind };
export type FootballTag = { id: string; kind: FootballTagKind; sourceEntityId: string; provider: string; providerId: number;
  displayName: string; providerName: string | null; imageUrl: string | null; profileAvailable: boolean };
export type TagQuery = { kind: "all" | FootballTagKind; query: string; page: number };
export type TagPage = { items: FootballTag[]; total: number; page: number; totalPages: number };
export class FootballTagError extends Error {
  constructor(readonly code: string, readonly status: number, message: string) { super(message); }
}
export function parseTagQuery(params: URLSearchParams): TagQuery {
  const kind = params.get("kind") ?? "all", query = (params.get("query") ?? "").trim(), page = params.get("page") ?? "1";
  if ([...params.keys()].some(k => !["kind", "query", "page"].includes(k) || params.getAll(k).length !== 1) ||
    kind !== "all" && !Object.hasOwn(FOOTBALL_TAG_SOURCES, kind) || query.length > 100 || /\p{Cc}/u.test(query) || !/^[1-9][0-9]{0,5}$/.test(page)) {
    throw new FootballTagError("VALIDATION_ERROR", 400, "Invalid Football tag query");
  }
  return { kind: kind as TagQuery["kind"], query, page: Number(page) };
}
