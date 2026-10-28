import { beforeEach, describe, expect, it, vi } from "vitest";
import { writerAdminFixture, writerProfileFixture } from "../fixtures/writers";

const mocks = vi.hoisted(() => ({ actor: vi.fn(), identity: vi.fn(), list: vi.fn(), create: vi.fn(), attach: vi.fn(), publish: vi.fn(), profile: vi.fn(), update: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/src/auth/session", () => ({ getStaffMutationActor: mocks.actor }));
vi.mock("@/src/identity/repository", () => ({ getIdentityAccessByAuthUserId: mocks.identity }));
vi.mock("@/src/identity/writer-service", async importOriginal => ({
  ...await importOriginal<typeof import("@/src/identity/writer-service")>(),
  listWriters: mocks.list, createWriter: mocks.create, attachWriter: mocks.attach, setWriterPublishOwn: mocks.publish, getOwnWriterProfile: mocks.profile, updateOwnWriterProfile: mocks.update,
}));

import { GET as list, POST as create } from "@/app/api/admin/writers/route";
import { PATCH as publish } from "@/app/api/admin/writers/[accountId]/publication/route";
import { GET as profile, PATCH as update } from "@/app/api/admin/profile/route";
import { ApplicationError } from "@/src/api/errors";

const origin = "https://writer-fixture.invalid";
const operationId = "5e03d92b-cf69-4288-8e43-6a02e9340497";
const context = { params: Promise.resolve({ accountId: "writer-account" }) };
const req = (method: string, body: unknown, headers = {}) => new Request(`${origin}/api/admin/writers`, {
  method, headers: { origin, "Content-Type": "application/json", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body),
});
beforeEach(() => {
  vi.resetAllMocks(); vi.stubEnv("AUTH_URL", origin);
  mocks.actor.mockResolvedValue({ accountId: "actor", authUserId: "user", sessionToken: "synthetic" });
  mocks.identity.mockResolvedValue({ accountId: "actor", authUserId: "user", roles: ["super_admin"] });
  mocks.list.mockResolvedValue([writerAdminFixture()]); mocks.create.mockResolvedValue(writerAdminFixture()); mocks.attach.mockResolvedValue(writerAdminFixture());
  mocks.publish.mockResolvedValue(writerProfileFixture({ canPublishOwn: true, publicationRevision: 1 }));
  mocks.profile.mockResolvedValue(writerProfileFixture()); mocks.update.mockResolvedValue(writerProfileFixture({ revision: 2 }));
});

describe("Writer HTTP boundaries", () => {
  it.each([null, [], ["writer"], ["admin"], ["writer", "admin"]])("denies management before reading the body for %j", async roles => {
    if (roles === null) mocks.actor.mockResolvedValue(null);
    else mocks.identity.mockResolvedValue({ roles });
    const request = req("POST", "not JSON");
    const reader = vi.spyOn(request.body!, "getReader");
    for (const response of [await create(request), await list(new Request(`${origin}/api/admin/writers`)), await publish(req("PATCH", {}), context)]) {
      expect(response.status).toBe(roles === null ? 401 : 403);
      expect((await response.json()).error.requestId).toBeTruthy();
    }
    expect(reader).not.toHaveBeenCalled(); expect(mocks.create).not.toHaveBeenCalled(); expect(mocks.list).not.toHaveBeenCalled(); expect(mocks.publish).not.toHaveBeenCalled();
  });
  it("fails closed before body/operation when the full staff-session guard rejects MFA", async () => {
    mocks.actor.mockResolvedValue(null);
    const request = req("POST", {}), reader = vi.spyOn(request.body!, "getReader");
    expect((await create(request)).status).toBe(401); expect(reader).not.toHaveBeenCalled(); expect(mocks.create).not.toHaveBeenCalled();
  });
  it("rechecks the current server role for every request", async () => {
    expect((await list(new Request(`${origin}/api/admin/writers`))).status).toBe(200);
    mocks.identity.mockResolvedValue({ roles: ["writer"] });
    expect((await list(new Request(`${origin}/api/admin/writers`))).status).toBe(403); expect(mocks.list).toHaveBeenCalledTimes(1);
  });
  it("separates new credentials from explicit role attachment", async () => {
    expect((await create(req("POST", { action: "create", email: "new@example.invalid", password: "Synthetic fixture password", operationId }))).status).toBe(201);
    expect(mocks.create).toHaveBeenCalledWith({ email: "new@example.invalid", password: "Synthetic fixture password", operationId });
    expect((await create(req("POST", { action: "attach", accountId: "existing", operationId }))).status).toBe(200);
    expect(mocks.attach).toHaveBeenCalledWith({ accountId: "existing", operationId });
    expect((await create(req("POST", { action: "attach", accountId: "existing", password: "forged", operationId }))).status).toBe(400);
    expect(mocks.attach).toHaveBeenCalledTimes(1);
  });
  it.each([{ origin: "https://evil.invalid" }, { "sec-fetch-site": "cross-site" }, { "Content-Type": "text/plain" }])("rejects unsafe mutations %j", async headers => {
    expect((await create(req("POST", { action: "create", email: "new@example.invalid", password: "Synthetic fixture password", operationId }, headers))).status).toBe("Content-Type" in headers ? 415 : 403);
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it.each(["{", "x".repeat(4097), { action: "create", email: "new@example.invalid", password: "Synthetic fixture password", operationId, actorAccountId: "forged" }, { action: "attach", accountId: "existing", operationId, roles: ["super_admin"] }])("rejects malformed/overbroad management writes %#", async body => {
    expect((await create(req("POST", body))).status).toBe(typeof body === "string" && body.length > 4096 ? 413 : 400);
    expect(mocks.create).not.toHaveBeenCalled(); expect(mocks.attach).not.toHaveBeenCalled();
  });
  it("allows only bounded exact email lookup, with uncached responses", async () => {
    const response = await list(new Request(`${origin}/api/admin/writers?email=writer%40example.invalid`));
    expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("no-store"); expect(response.headers.get("x-request-id")).toBeTruthy();
    expect(mocks.list).toHaveBeenCalledWith("writer@example.invalid");
    for (const query of ["email=", "email=a&email=b", "roles=super_admin", `email=${"a".repeat(255)}`]) expect((await list(new Request(`${origin}/api/admin/writers?${query}`))).status).toBe(400);
  });
  it("binds publication target to the route and requires a boolean and CAS revision", async () => {
    const response = await publish(req("PATCH", { enabled: true, expectedRevision: 0, operationId }), context);
    expect(await response.json()).toMatchObject({ profile: { canPublishOwn: true } });
    expect(mocks.publish).toHaveBeenCalledWith({ accountId: "writer-account", enabled: true, expectedRevision: 0, operationId });
    for (const body of [{ enabled: "true", expectedRevision: 0, operationId }, { enabled: true, expectedRevision: -1, operationId }, { enabled: true, expectedRevision: 0, operationId, accountId: "forged" }]) expect((await publish(req("PATCH", body), context)).status).toBe(400);
    expect(mocks.publish).toHaveBeenCalledTimes(1);
  });
  it("exposes safe errors without database details or password reflection", async () => {
    mocks.create.mockRejectedValue(new Error("private SQL canary"));
    const response = await create(req("POST", { action: "create", email: "new@example.invalid", password: "Synthetic fixture password", operationId }));
    expect(response.status).toBe(500); expect(response.headers.get("cache-control")).toBe("no-store");
    const body = await response.text(); expect(body).not.toContain("private SQL canary"); expect(body).not.toContain("Synthetic fixture password");
    mocks.publish.mockRejectedValue(new ApplicationError({ code: "WRITER_CONFLICT", status: 409, message: "Refresh" }));
    expect((await publish(req("PATCH", { enabled: false, expectedRevision: 0, operationId }), context)).status).toBe(409);
  });
});

describe("Own Writer profile HTTP boundary", () => {
  it.each([null, [], ["admin"], ["super_admin"]])("rejects accounts without Writer permission %j", async roles => {
    if (roles === null) mocks.actor.mockResolvedValue(null); else mocks.identity.mockResolvedValue({ roles });
    const request = req("PATCH", "not JSON"), reader = vi.spyOn(request.body!, "getReader");
    expect((await update(request)).status).toBe(roles === null ? 401 : 403); expect(reader).not.toHaveBeenCalled(); expect(mocks.update).not.toHaveBeenCalled();
  });
  it("accepts only own public profile fields", async () => {
    mocks.identity.mockResolvedValue({ roles: ["writer"] });
    const body = { nickname: "Новый автор", socialLinks: [{ label: "Канал", url: "https://example.invalid/channel" }], expectedRevision: 1, operationId };
    expect((await profile(new Request(`${origin}/api/admin/profile`))).status).toBe(200);
    expect((await update(req("PATCH", body))).status).toBe(200); expect(mocks.update).toHaveBeenCalledWith(body);
    for (const field of ["accountId", "avatarMediaId", "roles", "canPublishOwn", "email"]) expect((await update(req("PATCH", { ...body, [field]: "forged" }))).status).toBe(400);
    expect(mocks.update).toHaveBeenCalledTimes(1);
  });
});
