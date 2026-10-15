import { describe, expect, it } from "vitest";
import { parseFootballDataQuery, footballDataHref, dataPage, includesDataQuery, matchDatasetAvailability } from "@/src/admin/football-data";
import { synchronizationMatchId } from "../fixtures/football-synchronization";

describe("Football Data filters and read evidence", () => {
  it("defaults to current clubs and bounds large list pagination", () => {
    expect(parseFootballDataQuery({})).toEqual({ view: "clubs", query: "", page: 1, status: "", club: "", id: "" });
    const filter = parseFootballDataQuery({ view: "matches", query: " Интер ", page: "2", status: "finished", club: "club-one", id: synchronizationMatchId });
    expect(filter.query).toBe("Интер");
    expect(footballDataHref(filter, { page: 3, id: "" })).toContain("page=3");
    expect(footballDataHref(filter, { id: "" })).not.toContain("id=");
  });
  it.each([
    { view: "unknown" }, { view: ["players", "clubs"] }, { page: "0" }, { page: "-1" }, { page: "1.1" }, { page: "1000000" },
    { query: "x".repeat(101) }, { query: "bad\u0000query" }, { status: "finished" }, { view: "matches", status: "FT" },
    { view: "matches", id: "12345" }, { view: "matches", id: synchronizationMatchId.toUpperCase() }, { id: "../entity" },
    { view: "standings", query: "club" }, { view: "standings", page: "2" }, { view: "standings", id: "club" }, { limit: "1000" },
  ])("rejects ambiguous, unsupported or unsafe filters %#", (params) => expect(() => parseFootballDataQuery(params)).toThrow());
  it("treats search as a literal case-insensitive substring and paginates without overlaps", () => {
    expect(includesDataQuery("мИлАн", ["AC Milan", "Милан"])).toBe(true);
    expect(includesDataQuery("%_", ["regular text"])).toBe(false);
    const items = Array.from({ length: 25 }, (_, i) => i);
    expect(dataPage(items, 1).items).toHaveLength(20); expect(dataPage(items, 2).items).toEqual([20, 21, 22, 23, 24]);
    expect(dataPage(items, 99)).toMatchObject({ items: [], total: 25, totalPages: 2 });
  });
  it("does not confuse absence, confirmed empty Events, partial teams and complete snapshots", () => {
    const evidence = { eventRows: 0, eventsSucceededAt: null, lineups: [], statistics: [] };
    expect(matchDatasetAvailability(evidence)).toEqual({ events: "missing", lineups: "missing", statistics: "missing" });
    const home = { clubId: "home", observedAt: "2026-10-15T11:00:00Z" }; const away = { clubId: "away", observedAt: "2026-10-14T11:00:00Z" };
    expect(matchDatasetAvailability({ ...evidence, eventsSucceededAt: new Date(), lineups: [home], statistics: [home, away] })).toEqual({ events: "confirmed-empty", lineups: "partial", statistics: "complete" });
    expect(matchDatasetAvailability({ ...evidence, eventRows: 1, lineups: [home, away] })).toEqual({ events: "snapshot", lineups: "complete", statistics: "missing" });
  });
});
