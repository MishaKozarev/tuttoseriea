import { describe, expect, it } from "vitest";
import {
  localizationId, localizationKind, normalizeLocalizationName, parseLocalizationEdit, parseLocalizationQuery,
} from "@/src/football/localization-management";

describe("Football localization commands", () => {
  it("trims names without changing internal text or requiring only Cyrillic", () => {
    expect(normalizeLocalizationName("  Интер  U23  ")).toBe("Интер  U23");
    expect(normalizeLocalizationName("A".repeat(200))).toHaveLength(200);
  });
  it.each(["", "   ", "\t\n", "\u00a0\u2003", "\u200b", "Иван\nИванов", "Иван\u0000", "Имя\u202e", "x".repeat(201), null, 12])("rejects invalid name %#", (value) => {
    expect(() => normalizeLocalizationName(value)).toThrow();
  });
  it("parses separate save and explicitly confirmed review commands", () => {
    expect(parseLocalizationEdit({ action: "save", nameRu: "  Милан  ", expectedRevision: 2 })).toEqual({ action: "save", nameRu: "Милан", expectedRevision: 2 });
    expect(parseLocalizationEdit({ action: "review", nameRu: "Милан", expectedRevision: 3, confirmed: true })).toMatchObject({ action: "review", confirmed: true });
  });
  it.each([
    {}, null, [], { action: "save", nameRu: "Имя" }, { action: "save", nameRu: "Имя", expectedRevision: -1 },
    { action: "save", nameRu: "Имя", expectedRevision: "1" }, { action: "save", nameRu: "Имя", expectedRevision: 0.1 },
    { action: "save", nameRu: "Имя", expectedRevision: 2 ** 32 },
    { action: ["save"], nameRu: "Имя", expectedRevision: 0 },
    { action: ["review"], nameRu: "Имя", expectedRevision: 0 },
    { action: "review", nameRu: "Имя", expectedRevision: 1 },
    { action: "review", nameRu: "Имя", expectedRevision: 1, confirmed: false },
    { action: "save", nameRu: "Имя", expectedRevision: 0, slug: "changed" },
    { action: "save", nameRu: "Имя", expectedRevision: 0, providerName: "changed" },
    { action: "save", nameRu: "Имя", expectedRevision: 0, nameRuReviewStatus: "reviewed" },
  ])("rejects invalid/overbroad commands %#", (body) => expect(() => parseLocalizationEdit(body)).toThrow());
});

describe("Football localization lookup", () => {
  it("accepts only three entity kinds and existing text IDs", () => {
    expect(["competitions", "clubs", "players"].map(localizationKind)).toHaveLength(3);
    expect(localizationId("legacy-football-id")).toBe("legacy-football-id");
    expect(() => localizationKind("seasons")).toThrow();
    expect(() => localizationId("../entity")).toThrow();
  });
  it("parses bounded search, status and pagination", () => {
    expect(parseLocalizationQuery(new URLSearchParams())).toEqual({ kind: "clubs", query: "", status: "all", page: 1 });
    expect(parseLocalizationQuery(new URLSearchParams("kind=players&query=+Игрок+&status=unreviewed&page=2"))).toEqual({ kind: "players", query: "Игрок", status: "unreviewed", page: 2 });
  });
  it.each(["page=0", "page=-1", "page=1.1", "page=1000000", "kind=matches", "kind=clubs&kind=players", "status=unknown", "page=1&page=2", "limit=1000", `query=${"x".repeat(101)}`])("rejects invalid search %s", (query) => {
    expect(() => parseLocalizationQuery(new URLSearchParams(query))).toThrow();
  });
});
