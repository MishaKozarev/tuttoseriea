import type { SynchronizationRequest } from "@/src/admin/football-synchronization-client";
import { SERIE_A_FOUNDATION_IDEMPOTENCY_KEY, SERIE_A_FOUNDATION_JOB_TYPE } from "@/src/football/foundation";

export const synchronizationRequestId = "26e020a6-ab42-4715-bb56-c289b0bbd1b0";
export const synchronizationExecutionId = "9d523a7d-bb8f-48d3-8baf-218beb9297e6";
export const synchronizationMatchId = "711a2b14-488b-476a-9d27-e64987e3a764";
export const synchronizationActorId = "fixture-actor";

export function synchronizationFixture(): SynchronizationRequest {
  return {
    id: synchronizationRequestId, actorAccountId: synchronizationActorId,
    requestKey: "7b393975-4b7a-4258-99fa-fd649d5a1c14", jobType: SERIE_A_FOUNDATION_JOB_TYPE,
    idempotencyKey: SERIE_A_FOUNDATION_IDEMPOTENCY_KEY, matchId: null,
    correlationId: "fixture-correlation", createdAt: "2026-10-15T12:00:00.000Z",
    execution: { id: synchronizationExecutionId, status: "pending", attemptCount: 0, maxAttempts: 3,
      availableAt: "2026-10-15T12:00:00.000Z", startedAt: null, finishedAt: null,
      updatedAt: "2026-10-15T12:00:00.000Z", lastErrorCode: null },
  };
}
