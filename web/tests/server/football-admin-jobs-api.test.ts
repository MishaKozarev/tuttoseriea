import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ session: vi.fn(), admit: vi.fn(), history: vi.fn(), get: vi.fn(), close: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/src/identity/session", () => ({ getCurrentIdentityAccess: mocks.session }));
vi.mock("@/src/jobs/config", () => ({ getJobRunnerConfig: () => ({ maxAttempts: 3 }) }));
vi.mock("@/src/jobs/admin-repository", () => ({ AdminJobRepository: class {
  admit = mocks.admit; history = mocks.history; get = mocks.get; close = mocks.close;
} }));

import { POST, GET } from "@/app/api/admin/football/jobs/route";
import { GET as GET_ONE } from "@/app/api/admin/football/jobs/[requestId]/route";
import { AdminJobRequestError, ADMIN_JOB_TYPES } from "@/src/jobs/admin-contract";

const id = "f9a06fb7-c340-471c-989f-089e5e875a23";
const url = "https://staging.example.invalid/api/admin/football/jobs";
const body = { jobType: ADMIN_JOB_TYPES[0], requestKey: id, confirmed: true };
function request(value: unknown = body, headers: Record<string, string> = {}) {
  return new Request(url, { method: "POST", headers: {
    origin: "https://staging.example.invalid", "content-type": "application/json", "X-Request-ID": "test-correlation", ...headers,
  }, body: typeof value === "string" ? value : JSON.stringify(value) });
}
function session(roles: string[] = ["super_admin"]) {
  return { authenticated: true, identityAccess: { accountId: "actual-actor", authUserId: "user", roles, email: null } };
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("AUTH_URL", "https://staging.example.invalid");
  mocks.session.mockResolvedValue(session());
  mocks.admit.mockResolvedValue({ requestId: id, executionId: "execution", deduplicated: false });
  mocks.history.mockResolvedValue([]);
  mocks.get.mockResolvedValue({ id, execution: { id: "execution", status: "pending" } });
});
afterEach(() => vi.unstubAllEnvs());

describe("Football Admin job API authorization", () => {
  it.each([
    [false, [], 401], [true, [], 403], [true, ["writer"], 403], [true, ["admin"], 403],
    [true, ["writer", "admin"], 403],
  ] as const)("denies all operations for authenticated=%s roles=%s", async (authenticated, roles, status) => {
    mocks.session.mockResolvedValue(authenticated ? session([...roles]) : { authenticated: false, identityAccess: null });
    const responses = await Promise.all([
      POST(request()), GET(new Request(url)), GET_ONE(new Request(`${url}/${id}`), { params: Promise.resolve({ requestId: id }) }),
    ]);
    for (const response of responses) {
      expect(response.status).toBe(status);
      expect((await response.json()).error).toMatchObject({ code: status === 401 ? "UNAUTHORIZED" : "FORBIDDEN", requestId: expect.any(String) });
      expect(response.headers.get("cache-control")).toBe("no-store");
    }
    expect(mocks.admit).not.toHaveBeenCalled();
    expect(mocks.history).not.toHaveBeenCalled();
    expect(mocks.get).not.toHaveBeenCalled();
  });
  it("uses the authorized Identity actor, returns 202 and retains correlation", async () => {
    const response = await POST(request());
    expect(response.status).toBe(202);
    expect(response.headers.get("X-Request-ID")).toBe("test-correlation");
    expect(mocks.admit).toHaveBeenCalledWith("actual-actor", expect.objectContaining({ jobType: body.jobType }), "test-correlation", 3);
    expect(mocks.close).toHaveBeenCalledOnce();
  });
  it("returns the original identity with 200 on deduplicated replay", async () => {
    mocks.admit.mockResolvedValue({ requestId: id, executionId: "original", deduplicated: true });
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ executionId: "original", deduplicated: true });
  });
  it.each([
    { origin: "https://evil.invalid" }, { origin: "null" }, { origin: "" },
    { "sec-fetch-site": "cross-site" }, { "content-type": "text/plain" },
  ] as Record<string, string>[])("rejects cookie mutation with unsafe headers %s", async (headers) => {
    expect((await POST(request(body, headers))).status).toBe(headers["content-type"] ? 415 : 403);
    expect(mocks.admit).not.toHaveBeenCalled();
  });
  it.each(["{", "x".repeat(4097), { ...body, confirmed: false }, { ...body, actorAccountId: "spoof" }, { ...body, payload: {} }])
    ("rejects malformed/unbounded/unconfirmed input %#", async (value) => {
      expect((await POST(request(value))).status).toBe(typeof value === "string" && value.length > 4096 ? 413 : 400);
      expect(mocks.admit).not.toHaveBeenCalled();
    });
  it("maps operational rejection to the standard error envelope", async () => {
    mocks.admit.mockRejectedValue(new AdminJobRequestError("ADMIN_JOB_COOLDOWN", 429, "Scope is cooling down"));
    const response = await POST(request());
    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({ error: { code: "ADMIN_JOB_COOLDOWN", message: "Scope is cooling down", requestId: "test-correlation" } });
  });
  it("returns 409 when admission encounters a running non-Admin execution", async () => {
    mocks.admit.mockRejectedValue(new AdminJobRequestError("FOOTBALL_JOB_ALREADY_RUNNING", 409, "Canonical job is already running outside Admin"));
    const response = await POST(request());
    expect(response.status).toBe(409);
    expect((await response.json()).error).toMatchObject({ code: "FOOTBALL_JOB_ALREADY_RUNNING", requestId: "test-correlation" });
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
  it("bounds history and returns only associated request lookup", async () => {
    expect((await GET(new Request(`${url}?limit=50`))).status).toBe(200);
    expect(mocks.history).toHaveBeenCalledWith(50);
    const response = await GET_ONE(new Request(`${url}/${id}`), { params: Promise.resolve({ requestId: id }) });
    expect(response.status).toBe(200);
    expect(mocks.get).toHaveBeenCalledWith(id);
  });
  it.each(["?limit=0", "?limit=999", "?limit=1&limit=2", "?executionId=x"])("rejects unsupported history input %s", async (query) => {
    // Repository performs the final numeric bound check; emulate that for this boundary test.
    mocks.history.mockImplementation(async (limit: number) => {
      if (limit > 50) throw new AdminJobRequestError("VALIDATION_ERROR", 400, "Invalid limit");
      return [];
    });
    expect((await GET(new Request(url + query))).status).toBe(400);
  });
  it("returns a controlled 404 for a missing request", async () => {
    mocks.get.mockResolvedValue(null);
    const response = await GET_ONE(new Request(`${url}/${id}`), { params: Promise.resolve({ requestId: id }) });
    expect(response.status).toBe(404);
  });
});
