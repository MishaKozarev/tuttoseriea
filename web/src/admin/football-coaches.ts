import { localizationId, parseLocalizationQuery, type FootballLocalizationQuery } from "../football/localization-management";

export type FootballCoachesQuery = FootballLocalizationQuery & { id: string };
export class FootballCoachesInputError extends Error {}
export function parseFootballCoachesQuery(params: Record<string, string | string[] | undefined>): FootballCoachesQuery {
  const search = new URLSearchParams({ kind: "coaches" });
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue;
    if (!["query", "status", "page", "id"].includes(key) || typeof value !== "string") throw new FootballCoachesInputError("Invalid Coach search parameters");
    if (key !== "id") search.set(key, value);
  }
  return { ...parseLocalizationQuery(search), id: params.id ? localizationId(params.id) : "" };
}
export function footballCoachesHref(filter: FootballCoachesQuery, patch: Partial<FootballCoachesQuery> = {}) {
  const next = { ...filter, ...patch };
  const params = new URLSearchParams();
  for (const key of ["query", "status", "id"] as const) if (next[key] && !(key === "status" && next[key] === "all")) params.set(key, next[key]);
  if (next.page !== 1) params.set("page", String(next.page));
  return `/admin/football/coaches${params.size ? `?${params}` : ""}`;
}
