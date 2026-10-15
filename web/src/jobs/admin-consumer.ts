import { randomUUID } from "node:crypto";
import { ADMIN_JOB_MIN_REQUEST_INTERVAL_MS, adminJobArguments, parseAdminJobCommand } from "./admin-contract";
import type { AdminConsumerLock, AdminJobRepository } from "./admin-repository";
import type { JobRunnerConfig } from "./config";
import { productionJobRegistry } from "./registry";
import { runJobOnce, type RunJobResult } from "./runner";
import { JobLeaseLostError, type JobRegistry } from "./types";

type GateOptions = { now?: () => number; sleep?: (ms: number) => Promise<void> };
const sleep = (ms: number) => new Promise<void>((resolve) => { setTimeout(resolve, ms); });

export function createAdminProviderGate(options: GateOptions = {}) {
  const now = options.now ?? (() => performance.now());
  const wait = options.sleep ?? sleep;
  // A fresh consumer waits a full interval, also covering ordinary process restart.
  let nextAt = now() + ADMIN_JOB_MIN_REQUEST_INTERVAL_MS;
  let queue = Promise.resolve();
  return (verify: () => Promise<void> = async () => {}) => {
    const turn = queue.then(async () => {
      while (nextAt > now()) await wait(Math.ceil(nextAt - now()));
      await verify();
      // Stamp after asynchronous lease/lock verification, immediately before the caller's attempt.
      nextAt = now() + ADMIN_JOB_MIN_REQUEST_INTERVAL_MS;
    });
    queue = turn.catch(() => undefined);
    return turn;
  };
}

export async function consumeAdminJob(input: {
  repository: AdminJobRepository; config: JobRunnerConfig; lock: AdminConsumerLock;
  providerGate: (verify: () => Promise<void>) => Promise<void>; registry?: JobRegistry;
}): Promise<RunJobResult | null> {
  await input.lock.assertHeld();
  const selected = await input.repository.nextDue();
  if (!selected) return null;
  const command = parseAdminJobCommand({
    jobType: selected.jobType, ...(selected.matchId === null ? {} : { matchId: selected.matchId }),
    requestKey: randomUUID(), confirmed: true,
  });
  if (command.idempotencyKey !== selected.idempotencyKey) throw new Error("Invalid persisted Admin scope");
  await input.repository.assertCurrentScope(command);
  const runnerId = `football-admin:${process.pid}:${randomUUID()}`;
  return runJobOnce({
    type: command.jobType, args: adminJobArguments(command), executionId: selected.executionId,
    adminRequestId: selected.requestId,
    config: input.config, registry: input.registry ?? productionJobRegistry,
    repository: input.repository.jobs, runnerId,
    beforeProviderRequestAttempt: async () => {
      await input.providerGate(async () => {
        await input.lock.assertHeld();
        const execution = await input.repository.jobs.getExecution(selected.executionId);
        if (!execution || execution.status !== "running" || execution.claimedBy !== runnerId ||
            !await input.repository.jobs.heartbeat({
              id: execution.id, runnerId, claimVersion: execution.claimVersion,
            }, input.config.leaseSeconds)) throw new JobLeaseLostError();
      });
    },
  });
}

export async function runAdminConsumer(input: {
  repository: AdminJobRepository; config: JobRunnerConfig; once?: boolean;
  signal?: AbortSignal; registry?: JobRegistry; onResult?: (result: RunJobResult) => void;
}): Promise<"stopped" | "already_running"> {
  const lock = await input.repository.tryAcquireConsumerLock();
  if (!lock) return "already_running";
  const providerGate = createAdminProviderGate();
  try {
    do {
      if (input.signal?.aborted) break;
      const result = await consumeAdminJob({ ...input, lock, providerGate });
      if (result) input.onResult?.(result);
      // Detect lock loss even when a job reports lease_lost, before another selection.
      await lock.assertHeld();
      if (input.once || input.signal?.aborted) break;
      await sleep(1000);
    } while (!input.signal?.aborted);
    return "stopped";
  } finally {
    await lock.release();
  }
}
