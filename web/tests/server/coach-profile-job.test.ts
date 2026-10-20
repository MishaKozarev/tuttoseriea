import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PoolClient } from "pg";
import type { JobExecutionContext } from "@/src/jobs/types";
const mocks = vi.hoisted(() => ({ create: vi.fn(), sync: vi.fn(), end: vi.fn(async () => undefined) }));
vi.mock("pg", () => ({ Pool: class { end = mocks.end; } }));
vi.mock("@/src/football/api-football/node", () => ({ createApiFootballClient: mocks.create }));
vi.mock("@/src/football/serie-a-coaches-sync", () => ({ syncSerieACoaches: mocks.sync }));
import { syncSerieACoachesJob } from "@/src/jobs/football-sync";
import { productionJobRegistry } from "@/src/jobs/registry";
import { ADMIN_JOB_TYPES, parseAdminJobCommand } from "@/src/jobs/admin-contract";

beforeEach(() => {
  vi.resetAllMocks(); vi.stubEnv("DATABASE_URL", "postgresql://fixture.invalid/test"); vi.stubEnv("DATABASE_JOBS_SCHEMA", "jobs_fixture");
  mocks.create.mockReturnValue({ getRequestAttemptCount: () => 0 }); mocks.sync.mockResolvedValue({ status: "success" });
  vi.spyOn(console, "log").mockImplementation(() => undefined);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });
const context = () => ({ execution: { id: "execution", claimedBy: "worker", claimVersion: 7,
  payload: syncSerieACoachesJob.parseArguments([]).payload }, heartbeat: vi.fn(async () => undefined),
  beforeProviderRequestAttempt: vi.fn(async () => undefined) } as unknown as JobExecutionContext);
describe("Coach profile job uses the existing runner boundary", () => {
  it("has one fixed canonical scope and remains excluded from the eight Admin choices", () => {
    expect(productionJobRegistry.get(syncSerieACoachesJob.type)).toBe(syncSerieACoachesJob);
    expect(syncSerieACoachesJob.parseArguments([]).idempotencyKey).toBe("api-football:league:135:season:2026:coaches");
    expect(() => syncSerieACoachesJob.parseArguments(["--team-id", "496"])).toThrow();
    expect(ADMIN_JOB_TYPES).toHaveLength(8); expect(ADMIN_JOB_TYPES).not.toContain(syncSerieACoachesJob.type);
    expect(() => parseAdminJobCommand({ jobType: syncSerieACoachesJob.type, confirmed: true, requestKey: "11111111-1111-4111-8111-111111111111" })).toThrow();
  });
  it("forwards the provider gate/heartbeat and fences persistence using the execution's exact owner and version", async () => {
    const ctx = context(); expect(await syncSerieACoachesJob.handle(ctx)).toEqual({ status: "success" });
    expect(mocks.create).toHaveBeenCalledWith({ beforeRequestAttempt: ctx.beforeProviderRequestAttempt });
    const input = mocks.sync.mock.calls[0][0]; expect(input.heartbeat).toBe(ctx.heartbeat);
    const query = vi.fn(async () => ({ rows: [{ id: "execution" }] }));
    await input.fence({ query } as unknown as PoolClient);
    expect(query.mock.calls[0]).toEqual([expect.stringContaining('"jobs_fixture".executions'), ["execution", "worker", 7]]);
    query.mockResolvedValue({ rows: [] }); await expect(input.fence({ query })).rejects.toThrow("lease ownership");
    expect(mocks.end).toHaveBeenCalledTimes(1);
  });
  it("rejects a widened payload before opening a provider client", async () => {
    const ctx = context(); ctx.execution.payload.teamId = 496;
    expect((await syncSerieACoachesJob.handle(ctx)).status).toBe("failed"); expect(mocks.create).not.toHaveBeenCalled();
  });
});
