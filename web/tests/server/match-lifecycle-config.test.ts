import { describe, expect, it } from "vitest";

import { getMatchLifecycleDispatcherConfig } from "@/src/jobs/match-lifecycle-config";
import { JobConfigError } from "@/src/jobs/types";

describe("Match lifecycle dispatcher configuration", () => {
  it("requires an explicit canonical UTC managed_from and applies bounded defaults", () => {
    const value = getMatchLifecycleDispatcherConfig({
      FOOTBALL_MATCH_DISPATCHER_MANAGED_FROM: "2026-10-05T19:00:00Z",
    });

    expect(value).toMatchObject({
      managedFrom: new Date("2026-10-05T19:00:00.000Z"),
      recoveryHorizonSeconds: 86_400,
      finalConfirmationDelaySeconds: 1_800,
      maxConcurrency: 2,
      lineupConfirmationLeadSeconds: 600,
      lineupLiveRecoverySeconds: 3_600,
      failureCooldownSeconds: 300,
    });
  });

  it.each([
    {},
    { FOOTBALL_MATCH_DISPATCHER_MANAGED_FROM: "" },
    { FOOTBALL_MATCH_DISPATCHER_MANAGED_FROM: "2026-10-05" },
    { FOOTBALL_MATCH_DISPATCHER_MANAGED_FROM: "2026-10-05T19:00:00+03:00" },
  ])("fails closed without a stable canonical activation boundary: %j", (env) => {
    expect(() => getMatchLifecycleDispatcherConfig(env)).toThrow(JobConfigError);
  });

  it("rejects concurrency above the approved limit", () => {
    expect(() =>
      getMatchLifecycleDispatcherConfig({
        FOOTBALL_MATCH_DISPATCHER_MANAGED_FROM: "2026-10-05T19:00:00Z",
        FOOTBALL_MATCH_DISPATCHER_MAX_CONCURRENCY: "3",
      }),
    ).toThrow("must not exceed 2");
  });
});
