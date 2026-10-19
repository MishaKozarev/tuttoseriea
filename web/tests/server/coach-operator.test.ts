import { describe, expect, it } from "vitest";
import { parseCoachOperatorArguments, validateCoachOperatorConnection } from "@/src/football/coach-operator-command";
import { coachPlanHash, validateCoachManifest } from "@/src/football/coach-reconciliation-plan";

describe("Coach operator admission", () => {
  it("requires a declared bounded plan scope", () => {
    expect(parseCoachOperatorArguments(["--stage=local", "--action=plan", "--scope=current-serie-a"]).matchIds).toBeUndefined();
    expect(parseCoachOperatorArguments(["--stage=local", "--action=plan", "--match-id=11111111-1111-4111-8111-111111111111"]).matchIds).toHaveLength(1);
  });
  it.each([
    [], ["--stage=production", "--action=plan", "--scope=current-serie-a"],
    ["--stage=local", "--action=plan"], ["--stage=local", "--action=apply"],
    ["--stage=local", "--action=plan", "--scope=all"], ["--stage=local", "--stage=staging", "--action=verify"],
    ["--stage=local", "--action=verify", "--batch=1"],
  ].map((args) => ({ args })))("rejects unsafe/ambiguous invocation %#", ({ args }) => expect(() => parseCoachOperatorArguments(args)).toThrow());
  it("bounds write invocations and requires the actual hash", () => {
    const args = ["--stage=staging", "--action=apply", "--pass=profiles", `--confirm=${"a".repeat(64)}`];
    expect(parseCoachOperatorArguments([...args, "--batch=8"]).batch).toBe(8);
    expect(() => parseCoachOperatorArguments([...args, "--batch=9"])).toThrow();
    expect(() => parseCoachOperatorArguments([...args, "--batch=01"])).toThrow();
  });
  it("keeps exact LOCAL restrictions and explicit STAGING root/database/network target", () => {
    expect(validateCoachOperatorConnection("local", "postgresql://fixture@127.0.0.1:15432/tuttoseriea_local", undefined).database).toBe("tuttoseriea_local");
    expect(validateCoachOperatorConnection("staging", "postgresql://fixture@postgres:5432/tuttoseriea_staging", 0).database).toBe("tuttoseriea_staging");
    for (const [stage, connection, uid] of [
      ["local", "postgresql://fixture@postgres/tuttoseriea_local", 0],
      ["staging", "postgresql://fixture@postgres/tuttoseriea_staging", 1000],
      ["staging", "postgresql://fixture@postgres/tuttoseriea_production", 0],
      ["staging", "postgresql://fixture@external.invalid/tuttoseriea_staging", 0],
      ["staging", "postgresql://fixture@postgres/tuttoseriea_staging?options=x", 0],
    ] as const) expect(() => validateCoachOperatorConnection(stage, connection, uid)).toThrow();
  });
  it("hashes canonical JSON independent of object key order and rejects wrong environment", () => {
    expect(coachPlanHash({ b: [2, 1], a: "name" })).toBe(coachPlanHash({ a: "name", b: [2, 1] }));
    expect(coachPlanHash({ a: 1 })).not.toBe(coachPlanHash({ a: 2 }));
    expect(() => validateCoachManifest({}, { stage: "local", database: "tuttoseriea_local" })).toThrow();
  });
});
