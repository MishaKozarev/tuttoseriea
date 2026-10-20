import type { Pool, PoolClient } from "pg";
import type { ApiFootballClient } from "./api-football/core-client";
import { CoachProfileValidationError, parseCoachProfile } from "./coach-profile";
import { getSerieACoachProfileIds, upsertCoachProfile } from "./coach-profile-repository";
import type { JobHandlerResult } from "../jobs/types";

export async function syncSerieACoaches(input: {
  pool: Pool; client: ApiFootballClient; heartbeat: () => Promise<void>;
  fence: (client: PoolClient) => Promise<void>;
}): Promise<JobHandlerResult> {
  const ids = await getSerieACoachProfileIds(input.pool);
  let stored = 0, missing = 0;
  for (const id of ids) {
    await input.heartbeat();
    // Request start, not completion/commit, orders concurrent observations. No Match dates
    // or provider career dates participate in profile freshness.
    const observedAt = (await input.pool.query<{ at: Date }>("select clock_timestamp() as at")).rows[0].at;
    const response = await input.client.get<unknown>("/coachs", { id });
    if (!response.ok) return { status: response.error.retryable ? "retry" : "failed",
      errorCode: `api_football_${response.error.code}`, message: response.error.message,
      ...(response.error.retryAfterSeconds === undefined ? {} : { retryDelaySeconds: response.error.retryAfterSeconds }) };
    if (!Array.isArray(response.data) || response.results !== response.data.length ||
        response.data.length > 1 || response.paging.current !== 1 || response.paging.total !== 1) {
      return { status: "failed", errorCode: "api_football_invalid_coach_profile", message: "Invalid Coach response cardinality or paging" };
    }
    if (response.data.length === 0) { missing++; continue; }
    let profile;
    try { profile = parseCoachProfile(response.data[0], id); }
    catch (error) {
      if (!(error instanceof CoachProfileValidationError)) throw error;
      return { status: "failed", errorCode: "api_football_invalid_coach_profile", message: "Invalid Coach profile fields or identity" };
    }
    await input.heartbeat();
    const connection = await input.pool.connect();
    try {
      await connection.query("begin");
      await input.fence(connection);
      if (await upsertCoachProfile(connection, profile, observedAt)) stored++;
      await input.fence(connection);
      await connection.query("commit");
    } catch (error) { await connection.query("rollback"); throw error; }
    finally { connection.release(); }
  }
  console.log(`coach_profiles_scope=${ids.length} stored=${stored} missing=${missing}`);
  return { status: "success" };
}
