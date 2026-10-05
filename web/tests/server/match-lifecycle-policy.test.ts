import { describe, expect, it } from "vitest";

import {
  SERIE_A_MATCH_EVENTS_JOB_TYPE,
  SERIE_A_MATCH_LINEUPS_JOB_TYPE,
  SERIE_A_MATCH_STATISTICS_JOB_TYPE,
} from "@/src/football/foundation";
import type { MatchLifecycleDispatcherConfig } from "@/src/jobs/match-lifecycle-config";
import {
  getLifecycleFreshnessIntervalMs,
  isAutomaticallyAdmittedMatch,
  isLifecycleSnapshotFresh,
  selectDueDatasetTasks,
  type DispatcherExecution,
  type MatchLifecycleSnapshot,
} from "@/src/jobs/match-lifecycle-policy";

const now = new Date("2026-10-05T20:00:00.000Z");

function config(
  overrides: Partial<MatchLifecycleDispatcherConfig> = {},
): MatchLifecycleDispatcherConfig {
  return {
    managedFrom: new Date("2026-10-05T19:00:00.000Z"),
    recoveryHorizonSeconds: 86_400,
    finalConfirmationDelaySeconds: 1_800,
    maxConcurrency: 2,
    lineupConfirmationLeadSeconds: 600,
    lineupLiveRecoverySeconds: 3_600,
    failureCooldownSeconds: 300,
    ...overrides,
  };
}

function match(
  overrides: Partial<MatchLifecycleSnapshot> = {},
): MatchLifecycleSnapshot {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    status: "scheduled",
    kickoffAt: new Date("2026-10-05T21:00:00.000Z"),
    statusChangedAt: null,
    lineupHomeObservedAt: null,
    lineupAwayObservedAt: null,
    statisticsHomeObservedAt: null,
    statisticsAwayObservedAt: null,
    ...overrides,
  };
}

function execution(
  overrides: Partial<DispatcherExecution> = {},
): DispatcherExecution {
  return {
    id: crypto.randomUUID(),
    type: SERIE_A_MATCH_EVENTS_JOB_TYPE,
    matchId: "11111111-1111-4111-8111-111111111111",
    status: "succeeded",
    payload: {},
    availableAt: new Date("2026-10-05T19:00:00.000Z"),
    startedAt: new Date("2026-10-05T19:54:00.000Z"),
    finishedAt: new Date("2026-10-05T19:55:00.000Z"),
    createdAt: new Date("2026-10-05T19:54:00.000Z"),
    updatedAt: new Date("2026-10-05T19:55:00.000Z"),
    ...overrides,
  };
}

describe("Match lifecycle dispatcher policy", () => {
  it("uses the approved lifecycle cadence boundaries", () => {
    expect(
      getLifecycleFreshnessIntervalMs(
        [match({ kickoffAt: new Date("2026-10-07T20:00:01.000Z") })],
        now,
        config(),
      ),
    ).toBe(6 * 60 * 60 * 1_000);
    expect(
      getLifecycleFreshnessIntervalMs(
        [match({ kickoffAt: new Date("2026-10-06T18:00:00.000Z") })],
        now,
        config(),
      ),
    ).toBe(30 * 60 * 1_000);
    expect(
      getLifecycleFreshnessIntervalMs(
        [match({ kickoffAt: new Date("2026-10-05T21:30:00.000Z") })],
        now,
        config(),
      ),
    ).toBe(10 * 60 * 1_000);
    expect(
      getLifecycleFreshnessIntervalMs(
        [match({ kickoffAt: new Date("2026-10-05T20:20:00.000Z") })],
        now,
        config(),
      ),
    ).toBe(2 * 60 * 1_000);
    expect(
      getLifecycleFreshnessIntervalMs([match({ status: "live" })], now, config()),
    ).toBe(2 * 60 * 1_000);
    expect(
      getLifecycleFreshnessIntervalMs(
        [match({ status: "suspended" })],
        now,
        config(),
      ),
    ).toBe(10 * 60 * 1_000);
    expect(
      getLifecycleFreshnessIntervalMs(
        [match({ status: "postponed" })],
        now,
        config(),
      ),
    ).toBe(60 * 60 * 1_000);
    expect(
      getLifecycleFreshnessIntervalMs(
        [
          match({
            status: "abandoned",
            statusChangedAt: new Date("2026-10-05T19:30:00.000Z"),
          }),
        ],
        now,
        config(),
      ),
    ).toBe(10 * 60 * 1_000);
    expect(
      getLifecycleFreshnessIntervalMs(
        [
          match({
            status: "finished",
            statusChangedAt: new Date("2026-10-05T19:30:00.000Z"),
          }),
        ],
        now,
        config(),
      ),
    ).toBe(6 * 60 * 60 * 1_000);
  });

  it("requires a post-activation lifecycle success within the applicable cadence", () => {
    const live = match({ status: "live" });

    expect(
      isLifecycleSnapshotFresh(
        new Date("2026-10-05T19:59:00.000Z"),
        [live],
        now,
        config(),
      ),
    ).toBe(true);
    expect(
      isLifecycleSnapshotFresh(
        new Date("2026-10-05T18:59:59.000Z"),
        [live],
        now,
        config(),
      ),
    ).toBe(false);
    expect(
      isLifecycleSnapshotFresh(
        new Date("2026-10-05T19:57:59.000Z"),
        [live],
        now,
        config(),
      ),
    ).toBe(false);
  });

  it.each(["live", "paused", "suspended", "interrupted"] as const)(
    "admits a freshly gated rollout-active %s Match with a null historical marker",
    (status) => {
      expect(
        isAutomaticallyAdmittedMatch(
          match({ status, statusChangedAt: null }),
          now,
          config(),
        ),
      ).toBe(true);
    },
  );

  it("excludes active Matches before managed_from", () => {
    expect(
      isAutomaticallyAdmittedMatch(
        match({ status: "live", statusChangedAt: null }),
        now,
        config({ managedFrom: new Date("2026-10-05T20:00:01.000Z") }),
      ),
    ).toBe(false);
  });

  it.each(["finished", "abandoned"] as const)(
    "keeps a historical %s Match with a null marker outside automatic recovery",
    (status) => {
      expect(
        isAutomaticallyAdmittedMatch(
          match({ status, statusChangedAt: null }),
          now,
          config(),
        ),
      ).toBe(false);
      expect(selectDueDatasetTasks([match({ status })], [], now, config())).toEqual([]);
    },
  );

  it("never schedules datasets for cancelled, awarded, walkover or postponed Matches", () => {
    for (const status of ["cancelled", "awarded", "walkover", "postponed"] as const) {
      expect(
        selectDueDatasetTasks(
          [
            match({
              status,
              statusChangedAt: new Date("2026-10-05T19:55:00.000Z"),
            }),
          ],
          [],
          now,
          config(),
        ),
      ).toEqual([]);
    }
  });

  it("polls Lineups from T-90m and requires a fresh two-sided confirmation at T-10m", () => {
    const target = match({
      kickoffAt: new Date("2026-10-05T20:05:00.000Z"),
      lineupHomeObservedAt: new Date("2026-10-05T19:00:00.000Z"),
      lineupAwayObservedAt: new Date("2026-10-05T19:00:00.000Z"),
    });
    const tasks = selectDueDatasetTasks([target], [], now, config());

    expect(tasks).toContainEqual(
      expect.objectContaining({
        type: SERIE_A_MATCH_LINEUPS_JOB_TYPE,
        phase: "lineup-confirmation",
        statusChangedAt: null,
      }),
    );

    const confirmed = execution({
      type: SERIE_A_MATCH_LINEUPS_JOB_TYPE,
      payload: {
        dispatcher: {
          version: 1,
          phase: "lineup-confirmation",
          statusChangedAt: null,
        },
      },
      startedAt: new Date("2026-10-05T19:58:00.000Z"),
      finishedAt: new Date("2026-10-05T19:59:00.000Z"),
    });

    expect(
      selectDueDatasetTasks(
        [
          {
            ...target,
            lineupHomeObservedAt: new Date("2026-10-05T19:58:30.000Z"),
            lineupAwayObservedAt: new Date("2026-10-05T19:58:31.000Z"),
          },
        ],
        [confirmed],
        now,
        config(),
      ).some((item) => item.type === SERIE_A_MATCH_LINEUPS_JOB_TYPE),
    ).toBe(false);
  });

  it("does not treat a partial Lineups replacement as confirmation", () => {
    const lineupExecution = execution({
      type: SERIE_A_MATCH_LINEUPS_JOB_TYPE,
      payload: {
        dispatcher: {
          version: 1,
          phase: "lineup-confirmation",
          statusChangedAt: null,
        },
      },
    });
    const tasks = selectDueDatasetTasks(
      [
        match({
          kickoffAt: new Date("2026-10-05T20:05:00.000Z"),
          lineupHomeObservedAt: new Date("2026-10-05T19:54:30.000Z"),
          lineupAwayObservedAt: new Date("2026-10-05T18:00:00.000Z"),
        }),
      ],
      [lineupExecution],
      new Date("2026-10-05T20:05:01.000Z"),
      config(),
    );

    expect(tasks).toContainEqual(
      expect.objectContaining({ type: SERIE_A_MATCH_LINEUPS_JOB_TYPE }),
    );
  });

  it("polls Statistics once per paused transition", () => {
    const paused = match({ status: "paused", statusChangedAt: null, kickoffAt: null });
    const first = selectDueDatasetTasks([paused], [], now, config());

    expect(first).toContainEqual(
      expect.objectContaining({
        type: SERIE_A_MATCH_STATISTICS_JOB_TYPE,
        phase: "paused-entry",
      }),
    );

    const completed = execution({
      type: SERIE_A_MATCH_STATISTICS_JOB_TYPE,
      payload: {
        dispatcher: { version: 1, phase: "paused-entry", statusChangedAt: null },
      },
    });

    expect(
      selectDueDatasetTasks([paused], [completed], now, config()).some(
        (item) => item.type === SERIE_A_MATCH_STATISTICS_JOB_TYPE,
      ),
    ).toBe(false);
  });

  it("respects active retry availability and failed-execution cooldown", () => {
    const live = match({ status: "live", kickoffAt: null });
    const pendingFuture = execution({
      status: "pending",
      finishedAt: null,
      availableAt: new Date("2026-10-05T20:01:00.000Z"),
    });
    expect(
      selectDueDatasetTasks([live], [pendingFuture], now, config()).some(
        (item) => item.type === SERIE_A_MATCH_EVENTS_JOB_TYPE,
      ),
    ).toBe(false);

    const pendingDue = {
      ...pendingFuture,
      availableAt: new Date("2026-10-05T19:59:00.000Z"),
    };
    expect(
      selectDueDatasetTasks([live], [pendingDue], now, config()).some(
        (item) => item.type === SERIE_A_MATCH_EVENTS_JOB_TYPE,
      ),
    ).toBe(true);

    const recentFailure = execution({
      status: "failed",
      finishedAt: new Date("2026-10-05T19:59:00.000Z"),
      updatedAt: new Date("2026-10-05T19:59:00.000Z"),
    });
    expect(
      selectDueDatasetTasks([live], [recentFailure], now, config()).some(
        (item) => item.type === SERIE_A_MATCH_EVENTS_JOB_TYPE,
      ),
    ).toBe(false);
  });

  it("requires tagged final and delayed confirmation executions after a terminal transition", () => {
    const transition = new Date("2026-10-05T19:00:00.000Z");
    const finished = match({
      status: "finished",
      statusChangedAt: transition,
      kickoffAt: new Date("2026-10-05T17:00:00.000Z"),
    });
    const initial = selectDueDatasetTasks([finished], [], now, config());

    expect(initial.map((item) => [item.type, item.phase])).toEqual([
      [SERIE_A_MATCH_EVENTS_JOB_TYPE, "terminal-final"],
      [SERIE_A_MATCH_STATISTICS_JOB_TYPE, "terminal-final"],
    ]);

    const eventFinal = execution({
      type: SERIE_A_MATCH_EVENTS_JOB_TYPE,
      payload: {
        dispatcher: {
          version: 1,
          phase: "terminal-final",
          statusChangedAt: transition.toISOString(),
        },
      },
      startedAt: new Date("2026-10-05T19:10:00.000Z"),
      finishedAt: new Date("2026-10-05T19:11:00.000Z"),
    });
    const statisticsFinal = execution({
      type: SERIE_A_MATCH_STATISTICS_JOB_TYPE,
      payload: {
        dispatcher: {
          version: 1,
          phase: "terminal-final",
          statusChangedAt: transition.toISOString(),
        },
      },
      startedAt: new Date("2026-10-05T19:12:00.000Z"),
      finishedAt: new Date("2026-10-05T19:13:00.000Z"),
    });
    const afterFinal = {
      ...finished,
      statisticsHomeObservedAt: new Date("2026-10-05T19:12:30.000Z"),
      statisticsAwayObservedAt: new Date("2026-10-05T19:12:31.000Z"),
    };
    const confirmations = selectDueDatasetTasks(
      [afterFinal],
      [eventFinal, statisticsFinal],
      now,
      config(),
    );

    expect(confirmations.map((item) => [item.type, item.phase])).toEqual([
      [SERIE_A_MATCH_EVENTS_JOB_TYPE, "terminal-confirmation"],
      [SERIE_A_MATCH_STATISTICS_JOB_TYPE, "terminal-confirmation"],
    ]);
  });

  it("moves a rollout-admitted active Match into the normal terminal path after a marked transition", () => {
    const rolloutActive = match({ status: "live", statusChangedAt: null, kickoffAt: null });
    expect(
      selectDueDatasetTasks([rolloutActive], [], now, config()).map(
        (item) => item.phase,
      ),
    ).toEqual(["active-poll", "active-poll"]);

    const transitioned = {
      ...rolloutActive,
      status: "finished" as const,
      statusChangedAt: new Date("2026-10-05T19:58:00.000Z"),
    };
    expect(
      selectDueDatasetTasks([transitioned], [], now, config()).map(
        (item) => item.phase,
      ),
    ).toEqual(["terminal-final", "terminal-final"]);
  });

  it("does not qualify an empty or partial terminal Statistics success", () => {
    const transition = new Date("2026-10-05T19:00:00.000Z");
    const statisticsExecution = execution({
      type: SERIE_A_MATCH_STATISTICS_JOB_TYPE,
      payload: {
        dispatcher: {
          version: 1,
          phase: "terminal-final",
          statusChangedAt: transition.toISOString(),
        },
      },
    });
    const tasks = selectDueDatasetTasks(
      [
        match({
          status: "finished",
          statusChangedAt: transition,
          kickoffAt: new Date("2026-10-05T17:00:00.000Z"),
          statisticsHomeObservedAt: new Date("2026-10-05T19:54:30.000Z"),
          statisticsAwayObservedAt: new Date("2026-10-05T18:00:00.000Z"),
        }),
      ],
      [statisticsExecution],
      new Date("2026-10-05T20:05:01.000Z"),
      config(),
    );

    expect(tasks).toContainEqual(
      expect.objectContaining({
        type: SERIE_A_MATCH_STATISTICS_JOB_TYPE,
        phase: "terminal-final",
      }),
    );
  });
});
