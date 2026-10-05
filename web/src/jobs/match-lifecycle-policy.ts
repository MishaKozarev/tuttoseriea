import {
  SERIE_A_MATCH_EVENTS_JOB_TYPE,
  SERIE_A_MATCH_LINEUPS_JOB_TYPE,
  SERIE_A_MATCH_STATISTICS_JOB_TYPE,
} from "../football/foundation";
import type { NormalizedFixtureState } from "../football/api-football/fixture-status";
import type { MatchLifecycleDispatcherConfig } from "./match-lifecycle-config";
import type { JobExecutionStatus, JsonObject } from "./types";

const minute = 60_000;
const hour = 60 * minute;

export const MATCH_DISPATCHER_PHASES = [
  "lineup-poll",
  "lineup-confirmation",
  "active-poll",
  "paused-entry",
  "terminal-final",
  "terminal-confirmation",
] as const;

export type MatchDispatcherPhase = (typeof MATCH_DISPATCHER_PHASES)[number];

export type MatchLifecycleSnapshot = {
  id: string;
  status: NormalizedFixtureState;
  kickoffAt: Date | null;
  statusChangedAt: Date | null;
  lineupHomeObservedAt: Date | null;
  lineupAwayObservedAt: Date | null;
  statisticsHomeObservedAt: Date | null;
  statisticsAwayObservedAt: Date | null;
};

export type DispatcherExecution = {
  id: string;
  type: string;
  matchId: string | null;
  status: JobExecutionStatus;
  payload: JsonObject;
  availableAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type DispatcherTask = {
  matchId: string;
  type:
    | typeof SERIE_A_MATCH_EVENTS_JOB_TYPE
    | typeof SERIE_A_MATCH_LINEUPS_JOB_TYPE
    | typeof SERIE_A_MATCH_STATISTICS_JOB_TYPE;
  phase: MatchDispatcherPhase;
  statusChangedAt: string | null;
  priority: number;
};

type DispatcherMetadata = {
  phase: MatchDispatcherPhase;
  statusChangedAt: string | null;
};

const activeStatuses = new Set<NormalizedFixtureState>([
  "live",
  "paused",
  "suspended",
  "interrupted",
]);

function elapsed(now: Date, earlier: Date): number {
  return now.getTime() - earlier.getTime();
}

function isRecent(now: Date, timestamp: Date | null, intervalMs: number): boolean {
  return timestamp !== null && elapsed(now, timestamp) <= intervalMs;
}

function isTerminalRecoveryMatch(
  match: MatchLifecycleSnapshot,
  now: Date,
  config: MatchLifecycleDispatcherConfig,
): boolean {
  if (match.status !== "finished" && match.status !== "abandoned") {
    return false;
  }

  if (!match.statusChangedAt || match.statusChangedAt < config.managedFrom) {
    return false;
  }

  return elapsed(now, match.statusChangedAt) <= config.recoveryHorizonSeconds * 1_000;
}

export function isAutomaticallyAdmittedMatch(
  match: MatchLifecycleSnapshot,
  now: Date,
  config: MatchLifecycleDispatcherConfig,
): boolean {
  if (now < config.managedFrom) {
    return false;
  }

  if (match.status === "scheduled") {
    return match.kickoffAt !== null;
  }

  if (activeStatuses.has(match.status)) {
    return true;
  }

  return isTerminalRecoveryMatch(match, now, config);
}

function lifecycleIntervalForMatch(
  match: MatchLifecycleSnapshot,
  now: Date,
  config: MatchLifecycleDispatcherConfig,
): number | null {
  if (match.status === "live" || match.status === "paused") {
    return 2 * minute;
  }

  if (match.status === "suspended" || match.status === "interrupted") {
    return 10 * minute;
  }

  if (match.status === "postponed") {
    return hour;
  }

  if (match.status === "abandoned" && isTerminalRecoveryMatch(match, now, config)) {
    return 10 * minute;
  }

  if (match.status !== "scheduled" || !match.kickoffAt) {
    return null;
  }

  const untilKickoff = match.kickoffAt.getTime() - now.getTime();

  if (untilKickoff <= 30 * minute) {
    return 2 * minute;
  }

  if (untilKickoff <= 2 * hour) {
    return 10 * minute;
  }

  if (untilKickoff <= 24 * hour) {
    return 30 * minute;
  }

  return 6 * hour;
}

export function getLifecycleFreshnessIntervalMs(
  matches: readonly MatchLifecycleSnapshot[],
  now: Date,
  config: MatchLifecycleDispatcherConfig,
): number {
  const intervals = matches
    .map((match) => lifecycleIntervalForMatch(match, now, config))
    .filter((value): value is number => value !== null);

  return intervals.length === 0 ? 6 * hour : Math.min(...intervals);
}

export function isLifecycleSnapshotFresh(
  lastSuccessfulLifecycleAt: Date | null,
  matches: readonly MatchLifecycleSnapshot[],
  now: Date,
  config: MatchLifecycleDispatcherConfig,
): boolean {
  return (
    lastSuccessfulLifecycleAt !== null &&
    lastSuccessfulLifecycleAt >= config.managedFrom &&
    isRecent(
      now,
      lastSuccessfulLifecycleAt,
      getLifecycleFreshnessIntervalMs(matches, now, config),
    )
  );
}

function dispatcherMetadata(execution: DispatcherExecution): DispatcherMetadata | null {
  const value = execution.payload.dispatcher;

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const phase = (value as Record<string, unknown>).phase;
  const statusChangedAt = (value as Record<string, unknown>).statusChangedAt;

  if (
    typeof phase !== "string" ||
    !MATCH_DISPATCHER_PHASES.includes(phase as MatchDispatcherPhase) ||
    (statusChangedAt !== null && typeof statusChangedAt !== "string")
  ) {
    return null;
  }

  return {
    phase: phase as MatchDispatcherPhase,
    statusChangedAt,
  };
}

function executionsFor(
  executions: readonly DispatcherExecution[],
  matchId: string,
  type: string,
): DispatcherExecution[] {
  return executions.filter(
    (execution) => execution.matchId === matchId && execution.type === type,
  );
}

function latestExecution(executions: readonly DispatcherExecution[]): DispatcherExecution | null {
  return (
    [...executions].sort(
      (left, right) => right.createdAt.getTime() - left.createdAt.getTime(),
    )[0] ?? null
  );
}

function latestSuccess(executions: readonly DispatcherExecution[]): DispatcherExecution | null {
  return latestExecution(executions.filter((execution) => execution.status === "succeeded"));
}

function matchingSuccessfulPhase(
  executions: readonly DispatcherExecution[],
  phase: MatchDispatcherPhase,
  statusChangedAt: string | null,
): DispatcherExecution[] {
  return executions.filter((execution) => {
    if (execution.status !== "succeeded") {
      return false;
    }

    const metadata = dispatcherMetadata(execution);

    return (
      metadata?.phase === phase && metadata.statusChangedAt === statusChangedAt
    );
  });
}

function isBlockedByExecution(
  executions: readonly DispatcherExecution[],
  now: Date,
  config: MatchLifecycleDispatcherConfig,
): boolean {
  const latest = latestExecution(executions);

  if (!latest) {
    return false;
  }

  if (latest.status === "running") {
    return true;
  }

  if (latest.status === "pending") {
    return latest.availableAt > now;
  }

  return (
    latest.status === "failed" &&
    isRecent(now, latest.updatedAt, config.failureCooldownSeconds * 1_000)
  );
}

function isDue(
  executions: readonly DispatcherExecution[],
  now: Date,
  intervalMs: number,
  config: MatchLifecycleDispatcherConfig,
): boolean {
  if (isBlockedByExecution(executions, now, config)) {
    return false;
  }

  const latest = latestSuccess(executions);

  return !latest?.finishedAt || !isRecent(now, latest.finishedAt, intervalMs);
}

function task(
  match: MatchLifecycleSnapshot,
  type: DispatcherTask["type"],
  phase: MatchDispatcherPhase,
  priority: number,
  statusChangedAt = match.statusChangedAt?.toISOString() ?? null,
): DispatcherTask {
  return {
    matchId: match.id,
    type,
    phase,
    statusChangedAt,
    priority,
  };
}

function snapshotsWereReplacedBy(
  execution: DispatcherExecution,
  first: Date | null,
  second: Date | null,
  minimum: Date,
): boolean {
  if (!execution.startedAt || !execution.finishedAt || !first || !second) {
    return false;
  }

  return [first, second].every(
    (observedAt) =>
      observedAt >= minimum &&
      observedAt >= execution.startedAt! &&
      observedAt <= execution.finishedAt!,
  );
}

function snapshotWasReplacedByAny(
  executions: readonly DispatcherExecution[],
  observedAt: Date | null,
  minimum: Date,
): boolean {
  if (!observedAt || observedAt < minimum) {
    return false;
  }

  return executions.some(
    (execution) =>
      execution.startedAt !== null &&
      execution.finishedAt !== null &&
      observedAt >= execution.startedAt &&
      observedAt <= execution.finishedAt,
  );
}

function addLineupTask(
  tasks: DispatcherTask[],
  match: MatchLifecycleSnapshot,
  executions: readonly DispatcherExecution[],
  now: Date,
  config: MatchLifecycleDispatcherConfig,
): void {
  if (!match.kickoffAt) {
    return;
  }

  const pollingStartsAt = new Date(match.kickoffAt.getTime() - 90 * minute);
  const confirmationStartsAt = new Date(
    match.kickoffAt.getTime() - config.lineupConfirmationLeadSeconds * 1_000,
  );
  const recoveryEndsAt = new Date(
    match.kickoffAt.getTime() + config.lineupLiveRecoverySeconds * 1_000,
  );

  if (now < pollingStartsAt || now > recoveryEndsAt) {
    return;
  }

  const lineupExecutions = executionsFor(
    executions,
    match.id,
    SERIE_A_MATCH_LINEUPS_JOB_TYPE,
  );
  const bothSidesExist =
    match.lineupHomeObservedAt !== null && match.lineupAwayObservedAt !== null;

  if (now < confirmationStartsAt && bothSidesExist) {
    return;
  }

  if (now >= confirmationStartsAt) {
    const confirmationExecutions = matchingSuccessfulPhase(
      lineupExecutions,
      "lineup-confirmation",
      null,
    );
    const confirmed =
      snapshotWasReplacedByAny(
        confirmationExecutions,
        match.lineupHomeObservedAt,
        confirmationStartsAt,
      ) &&
      snapshotWasReplacedByAny(
        confirmationExecutions,
        match.lineupAwayObservedAt,
        confirmationStartsAt,
      );

    if (confirmed) {
      return;
    }
  }

  if (isDue(lineupExecutions, now, 10 * minute, config)) {
    tasks.push(
      task(
        match,
        SERIE_A_MATCH_LINEUPS_JOB_TYPE,
        now >= confirmationStartsAt ? "lineup-confirmation" : "lineup-poll",
        now >= confirmationStartsAt ? 30 : 60,
        null,
      ),
    );
  }
}

function addActiveTasks(
  tasks: DispatcherTask[],
  match: MatchLifecycleSnapshot,
  executions: readonly DispatcherExecution[],
  now: Date,
  config: MatchLifecycleDispatcherConfig,
): void {
  addLineupTask(tasks, match, executions, now, config);

  const eventExecutions = executionsFor(
    executions,
    match.id,
    SERIE_A_MATCH_EVENTS_JOB_TYPE,
  );
  const eventInterval =
    match.status === "live"
      ? 2 * minute
      : match.status === "paused"
        ? 5 * minute
        : 10 * minute;

  if (isDue(eventExecutions, now, eventInterval, config)) {
    tasks.push(task(match, SERIE_A_MATCH_EVENTS_JOB_TYPE, "active-poll", 40));
  }

  const statisticsExecutions = executionsFor(
    executions,
    match.id,
    SERIE_A_MATCH_STATISTICS_JOB_TYPE,
  );

  if (match.status === "paused") {
    const marker = match.statusChangedAt?.toISOString() ?? null;
    const alreadyPolled = matchingSuccessfulPhase(
      statisticsExecutions,
      "paused-entry",
      marker,
    ).length > 0;

    if (!alreadyPolled && !isBlockedByExecution(statisticsExecutions, now, config)) {
      tasks.push(task(match, SERIE_A_MATCH_STATISTICS_JOB_TYPE, "paused-entry", 45));
    }
    return;
  }

  const statisticsInterval = match.status === "live" ? 5 * minute : 10 * minute;

  if (isDue(statisticsExecutions, now, statisticsInterval, config)) {
    tasks.push(task(match, SERIE_A_MATCH_STATISTICS_JOB_TYPE, "active-poll", 50));
  }
}

function addTerminalTask(
  tasks: DispatcherTask[],
  match: MatchLifecycleSnapshot,
  executions: readonly DispatcherExecution[],
  now: Date,
  config: MatchLifecycleDispatcherConfig,
  type: typeof SERIE_A_MATCH_EVENTS_JOB_TYPE | typeof SERIE_A_MATCH_STATISTICS_JOB_TYPE,
): void {
  const statusChangedAt = match.statusChangedAt;

  if (!statusChangedAt) {
    return;
  }

  const marker = statusChangedAt.toISOString();
  const typeExecutions = executionsFor(executions, match.id, type);
  const finalExecutions = matchingSuccessfulPhase(
    typeExecutions,
    "terminal-final",
    marker,
  );
  const qualifies = (execution: DispatcherExecution) =>
    type === SERIE_A_MATCH_EVENTS_JOB_TYPE
      ? execution.finishedAt !== null && execution.finishedAt >= statusChangedAt
      : snapshotsWereReplacedBy(
          execution,
          match.statisticsHomeObservedAt,
          match.statisticsAwayObservedAt,
          statusChangedAt,
        );
  const finalExecution = [...finalExecutions]
    .filter(qualifies)
    .sort(
      (left, right) =>
        (right.finishedAt?.getTime() ?? 0) - (left.finishedAt?.getTime() ?? 0),
    )[0];

  if (!finalExecution?.finishedAt) {
    if (isDue(typeExecutions, now, 5 * minute, config)) {
      tasks.push(task(match, type, "terminal-final", 20));
    }
    return;
  }

  const confirmationDueAt = new Date(
    finalExecution.finishedAt.getTime() +
      config.finalConfirmationDelaySeconds * 1_000,
  );

  if (now < confirmationDueAt) {
    return;
  }

  const confirmed = matchingSuccessfulPhase(
    typeExecutions,
    "terminal-confirmation",
    marker,
  ).some(qualifies);

  if (!confirmed && isDue(typeExecutions, now, 5 * minute, config)) {
    tasks.push(task(match, type, "terminal-confirmation", 10));
  }
}

export function selectDueDatasetTasks(
  matches: readonly MatchLifecycleSnapshot[],
  executions: readonly DispatcherExecution[],
  now: Date,
  config: MatchLifecycleDispatcherConfig,
): DispatcherTask[] {
  const tasks: DispatcherTask[] = [];

  for (const match of matches) {
    if (!isAutomaticallyAdmittedMatch(match, now, config)) {
      continue;
    }

    if (match.status === "scheduled") {
      addLineupTask(tasks, match, executions, now, config);
      continue;
    }

    if (activeStatuses.has(match.status)) {
      addActiveTasks(tasks, match, executions, now, config);
      continue;
    }

    if (match.status === "finished" || match.status === "abandoned") {
      addTerminalTask(
        tasks,
        match,
        executions,
        now,
        config,
        SERIE_A_MATCH_EVENTS_JOB_TYPE,
      );
      addTerminalTask(
        tasks,
        match,
        executions,
        now,
        config,
        SERIE_A_MATCH_STATISTICS_JOB_TYPE,
      );
    }
  }

  return tasks.sort(
    (left, right) =>
      left.priority - right.priority ||
      left.matchId.localeCompare(right.matchId) ||
      left.type.localeCompare(right.type),
  );
}
