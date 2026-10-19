import { describe, expect, it } from "vitest";
import { mayReplaceCoachField, usableCoachName, usableCoachPhoto } from "@/src/football/coaches";
import { parseCoachReconciliationArguments } from "@/src/football/lineup-coaches-reconciliation";
import { normalizeApiFootballFixtureStatus } from "@/src/football/api-football/fixture-status";

describe("Coach profile evidence", () => {
  const old = new Date("2026-01-01Z"), recent = new Date("2026-02-01Z");
  it("rejects empty names without manufacturing an identity", () => {
    expect(usableCoachName(null)).toBeNull(); expect(usableCoachName(" \t ")).toBeNull(); expect(usableCoachName(" A. Coach ")).toBe("A. Coach");
  });
  it("keeps photos optional and rejects executable/credential URLs", () => {
    for (const value of [null, " ", "invalid", "javascript:alert(1)", "https://user:password@fixture.invalid/a"]) expect(usableCoachPhoto(value)).toBeNull();
    expect(usableCoachPhoto("https://fixture.invalid/a.png")).toBe("https://fixture.invalid/a.png");
  });
  it.each([
    ["b", old, "a", recent, false, "keep"], ["b", recent, "a", old, false, "replace"],
    ["a", old, "a", recent, false, "replace"], ["b", null, "a", old, false, "keep"],
    ["b", old, "a", null, false, "replace"], ["b", old, "a", old, false, "conflict"],
    ["b", null, "a", null, false, "conflict"], ["b", old, "a", old, true, "keep"],
  ] as const)("guards source chronology %#", (id, at, previousId, previousAt, same, expected) => {
    expect(mayReplaceCoachField(id, at, previousId, previousAt, same)).toBe(expected);
  });
  it("uses the existing FT/AET/PEN finished contract", () => {
    for (const code of ["FT", "AET", "PEN"]) expect(normalizeApiFootballFixtureStatus(code).state).toBe("finished");
    for (const code of ["AWD", "WO", "CANC", "NS", "1H", "HT", "PST", "ABD"]) expect(normalizeApiFootballFixtureStatus(code).state).not.toBe("finished");
  });
});
describe("bounded Coach reconciliation command", () => {
  const id = "11111111-1111-4111-8111-111111111111";
  it("defaults to read-only dry-run and requires explicit apply", () => {
    expect(parseCoachReconciliationArguments(["--match-id", id])).toEqual({ matchIds: [id], apply: false });
    expect(parseCoachReconciliationArguments(["--match-id", id, "--apply"]).apply).toBe(true);
  });
  it.each([[], ["--apply"], ["--all"], ["--match-id", "invalid"], ["--match-id", id, "--match-id", id],
    ["--match-id", id, "--apply", "--apply"]].map((args) => ({ args })))("rejects missing, duplicate or arbitrary scope %#", ({ args }) => {
    expect(() => parseCoachReconciliationArguments(args)).toThrow();
  });
  it("rejects more than fifty targets", () => {
    const args = Array.from({ length: 51 }, (_, i) => ["--match-id", `${String(i).padStart(8, "0")}-1111-4111-8111-111111111111`]).flat();
    expect(() => parseCoachReconciliationArguments(args)).toThrow();
  });
});
