import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/src/identity/session", () => ({
  getCurrentIdentityAccess: async () => ({ authenticated: true, identityAccess: {
    accountId: process.env.FOOTBALL_ADMIN_TIMESTAMP_ACTOR, authUserId: "timestamp-check",
    roles: ["super_admin"], email: null,
  } }),
}));

import { GET } from "@/app/api/admin/football/jobs/route";
import { GET as GET_ONE } from "@/app/api/admin/football/jobs/[requestId]/route";
import { synchronizationTime } from "@/src/admin/football-synchronization-client";
import { AdminJobRepository } from "@/src/jobs/admin-repository";
import { getJobRunnerConfig } from "@/src/jobs/config";

// Invoked twice by db:admin-jobs:check with an isolated PostgreSQL schema.
// Ordinary unit runs do not require a database or modify the process timezone.
describe.skipIf(process.env.FOOTBALL_ADMIN_TIMESTAMP_CHECK !== "true")("Admin PostgreSQL UTC projection", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("retains UTC instants through the repository, real GET handlers and UI formatter", async () => {
    vi.stubGlobal("fetch", () => { throw new Error("Timestamp checks must not make provider requests"); });
    expect(["UTC", "Europe/Minsk"]).toContain(process.env.TZ);
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe(process.env.TZ);
    const requestId = process.env.FOOTBALL_ADMIN_TIMESTAMP_REQUEST_ID!;
    const repository = new AdminJobRepository(getJobRunnerConfig());
    try {
      const direct = await repository.get(requestId);
      expect(direct?.createdAt.toISOString()).toBe("2026-10-15T18:00:00.000Z");
      expect(direct?.execution.finishedAt?.toISOString()).toBe("2026-10-15T18:01:00.000Z");
    } finally { await repository.close(); }

    const url = "http://localhost/api/admin/football/jobs";
    const detail = await GET_ONE(new Request(`${url}/${requestId}`), { params: Promise.resolve({ requestId }) });
    expect(detail.status).toBe(200);
    const { request } = await detail.json();
    expect(request.createdAt).toBe("2026-10-15T18:00:00.000Z");
    expect(request.execution).toMatchObject({
      availableAt: "2026-10-15T18:00:01.000Z", startedAt: "2026-10-15T18:00:02.000Z",
      finishedAt: "2026-10-15T18:01:00.000Z", updatedAt: "2026-10-15T18:01:01.000Z",
    });
    const history = await GET(new Request(url));
    expect(history.status).toBe(200);
    expect((await history.json()).requests.find((row: { id: string }) => row.id === requestId)).toEqual(request);
    expect(synchronizationTime(request.createdAt)).toContain("18:00:00 UTC");
    expect(synchronizationTime(request.execution.finishedAt)).toContain("18:01:00 UTC");
  });
});
