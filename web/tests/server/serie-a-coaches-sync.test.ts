import type { Pool } from "pg";
import { afterEach, describe, expect, it, vi } from "vitest";
import { syncSerieACoaches } from "@/src/football/serie-a-coaches-sync";
import type { ApiFootballClient } from "@/src/football/api-football/core-client";
import type { ApiFootballResult } from "@/src/football/api-football/types";
import { coachProfileFixture } from "../fixtures/coach-profile";

afterEach(() => vi.restoreAllMocks());
function setup(ids = [2914, 25878]) {
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  const transaction = { query: vi.fn(async (sql: string, values?: unknown[]) => {
    void sql; void values; return { rows: [{}] };
  }), release: vi.fn() };
  const pool = { query: vi.fn(async (sql: string) => sql.includes("select distinct")
    ? { rows: ids.map(provider_coach_id => ({ provider_coach_id })) } : { rows: [{ at: new Date("2026-10-20T12:00:00Z") }] }),
    connect: vi.fn(async () => transaction) };
  const get = vi.fn(async (_path: string, params: { id: number }): Promise<ApiFootballResult<unknown>> => ({ ok: true, data: [coachProfileFixture(params.id)],
    results: 1, paging: { current: 1, total: 1 }, attempts: 1, operation: "coachs" }));
  const input = { pool: pool as unknown as Pool, client: { get, getRequestAttemptCount: () => get.mock.calls.length } as unknown as ApiFootballClient,
    heartbeat: vi.fn(async () => undefined), fence: vi.fn(async () => undefined) };
  return { input, get, pool, transaction };
}
describe("bounded Serie A Coach profile synchronization", () => {
  it("requests exact provider IDs, persists separately under a fence and never fetches Lineups or Teams", async () => {
    const { input, get, transaction } = setup(); expect(await syncSerieACoaches(input)).toEqual({ status: "success" });
    expect(get.mock.calls).toEqual([["/coachs", { id: 2914 }], ["/coachs", { id: 25878 }]]);
    expect(input.heartbeat).toHaveBeenCalledTimes(4); expect(input.fence).toHaveBeenCalledTimes(4);
    expect(transaction.query.mock.calls.filter(([sql]) => sql === "commit")).toHaveLength(2);
  });
  it("makes no request for an empty persisted scope", async () => {
    const { input, get } = setup([]); expect((await syncSerieACoaches(input)).status).toBe("success"); expect(get).not.toHaveBeenCalled();
  });
  it("retains persisted facts for an empty API response and does not call persistence", async () => {
    const { input, get, pool } = setup([2914]);
    get.mockResolvedValue({ ok: true, data: [], results: 0, paging: { current: 1, total: 1 }, attempts: 1, operation: "coachs" });
    expect((await syncSerieACoaches(input)).status).toBe("success"); expect(pool.connect).not.toHaveBeenCalled();
  });
  it.each(["identity", "multiple", "paging", "malformed", "incomplete", "incomplete-birth"])('rejects %s without a write', async mode => {
    const { input, get, pool } = setup([2914]);
    const data = mode === "multiple" ? [coachProfileFixture(), coachProfileFixture()] :
      [{ ...coachProfileFixture(mode === "identity" ? 25878 : 2914), ...(mode === "malformed" ? { name: " " } : {}),
        ...(mode === "incomplete" ? { age: undefined } : {}), ...(mode === "incomplete-birth" ? { birth: {} } : {}) }];
    get.mockResolvedValue({ ok: true, data, results: data.length, paging: { current: 1, total: mode === "paging" ? 2 : 1 }, attempts: 1, operation: "coachs" });
    expect((await syncSerieACoaches(input)).status).toBe("failed"); expect(pool.connect).not.toHaveBeenCalled();
  });
  it("propagates retry/quota classification and stops the remaining scope", async () => {
    const { input, get } = setup();
    get.mockResolvedValue({ ok: false, error: { code: "http_rate_limited", retryable: true, retryAfterSeconds: 30, message: "Rate limited", attempts: 1 } });
    expect(await syncSerieACoaches(input)).toMatchObject({ status: "retry", retryDelaySeconds: 30 }); expect(get).toHaveBeenCalledTimes(1);
  });
  it("stops before a provider call on lost heartbeat and rolls back on a lost persistence fence", async () => {
    const first = setup(); first.input.heartbeat.mockRejectedValue(new Error("Lost lease"));
    await expect(syncSerieACoaches(first.input)).rejects.toThrow("Lost lease"); expect(first.get).not.toHaveBeenCalled();
    const second = setup(); second.input.fence.mockRejectedValue(new Error("Lost fence"));
    await expect(syncSerieACoaches(second.input)).rejects.toThrow("Lost fence");
    expect(second.transaction.query).toHaveBeenCalledWith("rollback"); expect(second.transaction.query).not.toHaveBeenCalledWith("commit");
  });
});
