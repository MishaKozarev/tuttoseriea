import { describe, expect, it } from "vitest";
import { parseFootballCoachesQuery, footballCoachesHref } from "@/src/admin/football-coaches";
import { parseLocalizationPageParams } from "@/src/football/localization-management";

describe("Coach Admin query boundary", () => {
  it("fixes Coaches scope and reuses bounded localization search/status/pages", () => {
    const value = parseFootballCoachesQuery({ query: "  Иван  ", status: "unreviewed", page: "2", id: "coach-id" });
    expect(value).toEqual({ kind: "coaches", query: "Иван", status: "unreviewed", page: 2, id: "coach-id" });
    expect(footballCoachesHref(value, { page: 1, id: "" })).toBe("/admin/football/coaches?query=%D0%98%D0%B2%D0%B0%D0%BD&status=unreviewed");
  });
  it.each([{ kind: "players" }, { page: "0" }, { id: ["a", "b"] }, { query: ["a", "b"] }, { status: "active" }, { query: "x".repeat(101) }, { id: "../club" }, { extra: "bad" }])("rejects unbounded/invalid parameters %j", (params) => {
    expect(() => parseFootballCoachesQuery(params)).toThrow();
  });
  it("supports a direct link into the existing localization editor", () => {
    expect(parseLocalizationPageParams({ kind: "coaches", id: "coach-id" })).toEqual({
      filter: { kind: "coaches", query: "", status: "all", page: 1 }, initialId: "coach-id",
    });
    expect(() => parseLocalizationPageParams({ id: ["a", "b"] })).toThrow();
    expect(() => parseLocalizationPageParams({ kind: "coaches", provider: "bad" })).toThrow();
  });
});
