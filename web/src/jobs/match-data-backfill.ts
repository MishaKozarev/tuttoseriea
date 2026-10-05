import {
  API_FOOTBALL_PROVIDER,
  SERIE_A_CURRENT_SEASON,
  SERIE_A_MATCH_EVENTS_JOB_TYPE,
  SERIE_A_MATCH_LINEUPS_JOB_TYPE,
  SERIE_A_MATCH_STATISTICS_JOB_TYPE,
  SERIE_A_PROVIDER_LEAGUE_ID,
} from "../football/foundation";
import type {
  MatchDataBackfillRepositoryContract,
  MatchDataBackfillSnapshot,
} from "./match-data-backfill-repository";
import type { RunJobResult } from "./runner";

export const MATCH_DATA_BACKFILL_MAX_CONCURRENCY = 2;

export const MATCH_DATA_BACKFILL_DATASETS = [
  "events",
  "lineups",
  "statistics",
] as const;

export type MatchDataBackfillDataset =
  (typeof MATCH_DATA_BACKFILL_DATASETS)[number];

export type MatchDataBackfillCandidate = {
  matchId: string;
  providerFixtureId: number;
  statusChangedAt: string | null;
  missingDatasets: MatchDataBackfillDataset[];
};

export type MatchDataBackfillOperation = {
  matchId: string;
  providerFixtureId: number;
  dataset: MatchDataBackfillDataset;
  jobType:
    | typeof SERIE_A_MATCH_EVENTS_JOB_TYPE
    | typeof SERIE_A_MATCH_LINEUPS_JOB_TYPE
    | typeof SERIE_A_MATCH_STATISTICS_JOB_TYPE;
};

export type MatchDataBackfillPlan = {
  scope: {
    provider: typeof API_FOOTBALL_PROVIDER;
    providerLeagueId: typeof SERIE_A_PROVIDER_LEAGUE_ID;
    providerSeason: typeof SERIE_A_CURRENT_SEASON;
    normalizedStatus: "finished";
  };
  totalFinishedMatches: number;
  candidateMatches: number;
  missingEvents: number;
  missingLineups: number;
  missingStatistics: number;
  alreadyComplete: number;
  datasetOperations: number;
  cleanPathEstimatedProviderRequests: number;
  candidates: MatchDataBackfillCandidate[];
  operations: MatchDataBackfillOperation[];
};

export type MatchDataBackfillJobRunner = (
  type: MatchDataBackfillOperation["jobType"],
  args: readonly string[],
) => Promise<RunJobResult>;

export type MatchDataBackfillOperationResult = MatchDataBackfillOperation & {
  jobOutcome:
    | RunJobResult["outcome"]["status"]
    | "runner_error";
  executionId: string | null;
  verifiedComplete: boolean;
};

export type MatchDataBackfillResult =
  | {
      status: "dry_run";
      plan: MatchDataBackfillPlan;
    }
  | {
      status: "no_op";
      reason: "lock_held";
    }
  | {
      status: "completed" | "completed_with_failures";
      plan: MatchDataBackfillPlan;
      verifiedPlan: MatchDataBackfillPlan;
      results: MatchDataBackfillOperationResult[];
    };

const datasetDefinitions = [
  {
    dataset: "events" as const,
    jobType: SERIE_A_MATCH_EVENTS_JOB_TYPE,
    isComplete: (match: MatchDataBackfillSnapshot) => match.eventsComplete,
  },
  {
    dataset: "lineups" as const,
    jobType: SERIE_A_MATCH_LINEUPS_JOB_TYPE,
    isComplete: (match: MatchDataBackfillSnapshot) => match.lineupsComplete,
  },
  {
    dataset: "statistics" as const,
    jobType: SERIE_A_MATCH_STATISTICS_JOB_TYPE,
    isComplete: (match: MatchDataBackfillSnapshot) => match.statisticsComplete,
  },
] as const;

function datasetIsComplete(
  match: MatchDataBackfillSnapshot | undefined,
  dataset: MatchDataBackfillDataset,
): boolean {
  if (!match) {
    return false;
  }

  return datasetDefinitions.find((definition) => definition.dataset === dataset)!
    .isComplete(match);
}

export function createMatchDataBackfillPlan(
  matches: readonly MatchDataBackfillSnapshot[],
): MatchDataBackfillPlan {
  const candidates: MatchDataBackfillCandidate[] = [];
  const operations: MatchDataBackfillOperation[] = [];

  for (const match of matches) {
    const missingDatasets = datasetDefinitions
      .filter((definition) => !definition.isComplete(match))
      .map((definition) => definition.dataset);

    if (missingDatasets.length === 0) {
      continue;
    }

    candidates.push({
      matchId: match.matchId,
      providerFixtureId: match.providerFixtureId,
      statusChangedAt: match.statusChangedAt?.toISOString() ?? null,
      missingDatasets,
    });

    for (const definition of datasetDefinitions) {
      if (missingDatasets.includes(definition.dataset)) {
        operations.push({
          matchId: match.matchId,
          providerFixtureId: match.providerFixtureId,
          dataset: definition.dataset,
          jobType: definition.jobType,
        });
      }
    }
  }

  const missingEvents = operations.filter(
    (operation) => operation.dataset === "events",
  ).length;
  const missingLineups = operations.filter(
    (operation) => operation.dataset === "lineups",
  ).length;
  const missingStatistics = operations.filter(
    (operation) => operation.dataset === "statistics",
  ).length;

  return {
    scope: {
      provider: API_FOOTBALL_PROVIDER,
      providerLeagueId: SERIE_A_PROVIDER_LEAGUE_ID,
      providerSeason: SERIE_A_CURRENT_SEASON,
      normalizedStatus: "finished",
    },
    totalFinishedMatches: matches.length,
    candidateMatches: candidates.length,
    missingEvents,
    missingLineups,
    missingStatistics,
    alreadyComplete: matches.length - candidates.length,
    datasetOperations: operations.length,
    cleanPathEstimatedProviderRequests: operations.length,
    candidates,
    operations,
  };
}

function executionId(result: RunJobResult): string {
  return result.outcome.status === "lease_lost"
    ? result.outcome.executionId
    : result.outcome.execution.id;
}

async function executeOperations(
  operations: readonly MatchDataBackfillOperation[],
  runJob: MatchDataBackfillJobRunner,
): Promise<Omit<MatchDataBackfillOperationResult, "verifiedComplete">[]> {
  let nextIndex = 0;
  const results: Array<
    Omit<MatchDataBackfillOperationResult, "verifiedComplete"> | undefined
  > = new Array(operations.length);

  const worker = async () => {
    while (nextIndex < operations.length) {
      const operationIndex = nextIndex;
      nextIndex += 1;
      const operation = operations[operationIndex];

      if (!operation) {
        continue;
      }

      try {
        const result = await runJob(operation.jobType, [
          "--match-id",
          operation.matchId,
        ]);

        results[operationIndex] = {
          ...operation,
          jobOutcome: result.outcome.status,
          executionId: executionId(result),
        };
      } catch {
        results[operationIndex] = {
          ...operation,
          jobOutcome: "runner_error",
          executionId: null,
        };
      }
    }
  };

  await Promise.all(
    Array.from(
      {
        length: Math.min(MATCH_DATA_BACKFILL_MAX_CONCURRENCY, operations.length),
      },
      () => worker(),
    ),
  );

  return results.filter(
    (
      result,
    ): result is Omit<MatchDataBackfillOperationResult, "verifiedComplete"> =>
      result !== undefined,
  );
}

export async function runMatchDataBackfill(input: {
  repository: MatchDataBackfillRepositoryContract;
  mode: "dry-run" | "run";
  runJob?: MatchDataBackfillJobRunner;
}): Promise<MatchDataBackfillResult> {
  if (input.mode === "dry-run") {
    return {
      status: "dry_run",
      plan: createMatchDataBackfillPlan(
        await input.repository.listFinishedMatches(),
      ),
    };
  }

  if (!input.runJob) {
    throw new Error("Match data backfill run mode requires a job runner");
  }

  const lock = await input.repository.tryAcquireRunLock();

  if (!lock) {
    return { status: "no_op", reason: "lock_held" };
  }

  try {
    const plan = createMatchDataBackfillPlan(
      await input.repository.listFinishedMatches(),
    );
    const jobResults = await executeOperations(plan.operations, input.runJob);
    const verifiedMatches = await input.repository.listFinishedMatches();
    const verifiedById = new Map(
      verifiedMatches.map((match) => [match.matchId, match]),
    );
    const results = jobResults.map((result) => ({
      ...result,
      verifiedComplete: datasetIsComplete(
        verifiedById.get(result.matchId),
        result.dataset,
      ),
    }));
    const completed = results.every(
      (result) => result.jobOutcome === "success" && result.verifiedComplete,
    );

    return {
      status: completed ? "completed" : "completed_with_failures",
      plan,
      verifiedPlan: createMatchDataBackfillPlan(verifiedMatches),
      results,
    };
  } finally {
    await lock.release();
  }
}
