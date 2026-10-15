import { FIXTURE_STATUS_LABELS_RU } from "../football/localization";
import { isMatchUuid } from "./football-synchronization-client";

export const FOOTBALL_DATA_VIEWS = { clubs: "Клубы", players: "Игроки", matches: "Матчи", standings: "Турнирная таблица" } as const;
export const FOOTBALL_DATA_PAGE_SIZE = 20;
export type FootballDataQuery = { view: keyof typeof FOOTBALL_DATA_VIEWS; query: string; page: number; status: string; club: string; id: string };
export class FootballDataInputError extends Error {}
export type DataPage<T> = { items: T[]; total: number; page: number; totalPages: number };
export function dataPage<T>(items: T[], page: number): DataPage<T> {
  return { items: items.slice((page - 1) * FOOTBALL_DATA_PAGE_SIZE, page * FOOTBALL_DATA_PAGE_SIZE), total: items.length, page, totalPages: Math.ceil(items.length / FOOTBALL_DATA_PAGE_SIZE) };
}
export function parseFootballDataQuery(params: Record<string, string | string[] | undefined>): FootballDataQuery {
  const allowed = ["view", "query", "page", "status", "club", "id"];
  if (Object.entries(params).some(([key, value]) => !allowed.includes(key) || (value !== undefined && typeof value !== "string"))) throw new FootballDataInputError();
  const text = (key: string) => (params[key] as string | undefined) ?? "";
  const view = text("view") || "clubs";
  const page = text("page") || "1";
  const query = text("query").trim();
  const status = text("status"); const club = text("club"); const id = text("id");
  if (!Object.hasOwn(FOOTBALL_DATA_VIEWS, view) || !/^[1-9][0-9]{0,5}$/.test(page) || query.length > 100 || /\p{Cc}/u.test(query) ||
      [club, id].some((value) => value.length > 128 || /[\p{Cc}/\\]/u.test(value)) ||
      (status && !Object.hasOwn(FIXTURE_STATUS_LABELS_RU, status)) ||
      (view !== "matches" && (status || club)) || (view === "matches" && id && !isMatchUuid(id)) ||
      (view === "standings" && (id || query || Number(page) !== 1))) throw new FootballDataInputError();
  return { view: view as FootballDataQuery["view"], query, page: Number(page), status, club, id };
}
export function footballDataHref(query: FootballDataQuery, patch: Partial<FootballDataQuery> = {}): string {
  const next = { ...query, ...patch };
  const params = new URLSearchParams({ view: next.view });
  for (const key of ["query", "status", "club", "id"] as const) if (next[key]) params.set(key, next[key]);
  if (next.page !== 1) params.set("page", String(next.page));
  return `/admin/football/data?${params}`;
}
export function includesDataQuery(query: string, values: (string | number | null | undefined)[]): boolean {
  const needle = query.toLocaleLowerCase("ru");
  return values.some((value) => value !== null && value !== undefined && String(value).toLocaleLowerCase("ru").includes(needle));
}
export type MatchDatasetEvidence = {
  eventRows: number; eventsSucceededAt: Date | null;
  lineups: { clubId: string; observedAt: string }[];
  statistics: { clubId: string; observedAt: string }[];
};
export function matchDatasetAvailability(evidence: MatchDatasetEvidence) {
  return {
    events: evidence.eventRows > 0 ? "snapshot" : evidence.eventsSucceededAt ? "confirmed-empty" : "missing",
    lineups: evidence.lineups.length === 2 ? "complete" : evidence.lineups.length === 1 ? "partial" : "missing",
    statistics: evidence.statistics.length === 2 ? "complete" : evidence.statistics.length === 1 ? "partial" : "missing",
  } as const;
}
