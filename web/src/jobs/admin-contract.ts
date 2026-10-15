import {
  SERIE_A_FOUNDATION_JOB_TYPE, SERIE_A_MATCHES_JOB_TYPE, SERIE_A_STANDINGS_JOB_TYPE,
  SERIE_A_SQUADS_JOB_TYPE, SERIE_A_PLAYER_STATISTICS_JOB_TYPE,
  SERIE_A_MATCH_EVENTS_JOB_TYPE, SERIE_A_MATCH_LINEUPS_JOB_TYPE, SERIE_A_MATCH_STATISTICS_JOB_TYPE,
} from "../football/foundation";
import { getJobDefinition, productionJobRegistry } from "./registry";

export const ADMIN_JOB_TYPES = [
  SERIE_A_FOUNDATION_JOB_TYPE, SERIE_A_MATCHES_JOB_TYPE, SERIE_A_STANDINGS_JOB_TYPE,
  SERIE_A_SQUADS_JOB_TYPE, SERIE_A_PLAYER_STATISTICS_JOB_TYPE,
  SERIE_A_MATCH_EVENTS_JOB_TYPE, SERIE_A_MATCH_LINEUPS_JOB_TYPE, SERIE_A_MATCH_STATISTICS_JOB_TYPE,
] as const;
export type AdminJobType = typeof ADMIN_JOB_TYPES[number];
export const ADMIN_JOB_COOLDOWN_SECONDS = 300;
export const ADMIN_JOB_MIN_REQUEST_INTERVAL_MS = 500;
export const ADMIN_JOB_HISTORY_LIMIT = 50;
export const CANONICAL_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export class AdminJobRequestError extends Error {
  constructor(readonly code: string, readonly status: number, message: string) {
    super(message);
    this.name = "AdminJobRequestError";
  }
}

export type AdminJobScope = {
  jobType: AdminJobType;
  matchId: string | null;
  idempotencyKey: string;
};
export type AdminJobCommand = AdminJobScope & { requestKey: string };

export function adminJobArguments(scope: Pick<AdminJobScope, "matchId">): string[] {
  return scope.matchId === null ? [] : ["--match-id", scope.matchId];
}

export function parseAdminJobCommand(value: unknown): AdminJobCommand {
  const invalid = () => new AdminJobRequestError("VALIDATION_ERROR", 400, "Invalid Football Admin job request");
  if (!value || typeof value !== "object" || Array.isArray(value)) throw invalid();
  const body = value as Record<string, unknown>;
  if (Object.keys(body).some((key) => !["jobType", "matchId", "requestKey", "confirmed"].includes(key)) ||
      typeof body.jobType !== "string" || !ADMIN_JOB_TYPES.includes(body.jobType as AdminJobType) ||
      typeof body.requestKey !== "string" || !CANONICAL_UUID.test(body.requestKey)) throw invalid();
  if (body.confirmed !== true) {
    throw new AdminJobRequestError("CONFIRMATION_REQUIRED", 400, "Explicit synchronization confirmation is required");
  }
  const jobType = body.jobType as AdminJobType;
  const matchScoped = (ADMIN_JOB_TYPES.slice(5) as readonly string[]).includes(jobType);
  if (matchScoped ? typeof body.matchId !== "string" || !CANONICAL_UUID.test(body.matchId)
    : body.matchId !== undefined) throw invalid();
  const scope = { jobType, matchId: matchScoped ? body.matchId as string : null };
  const parsed = getJobDefinition(productionJobRegistry, jobType).parseArguments(adminJobArguments(scope));
  return { ...scope, requestKey: body.requestKey, idempotencyKey: parsed.idempotencyKey };
}
