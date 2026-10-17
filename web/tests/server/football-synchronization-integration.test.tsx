// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ session: vi.fn(), admit: vi.fn(), history: vi.fn(), get: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/src/identity/session", () => ({ getCurrentIdentityAccess: mocks.session }));
vi.mock("@/src/jobs/config", () => ({ getJobRunnerConfig: () => ({ maxAttempts: 3 }) }));
vi.mock("@/src/jobs/admin-repository", () => ({ AdminJobRepository: class {
  admit = mocks.admit; history = mocks.history; get = mocks.get; close = async () => {};
} }));

import { FootballSynchronization } from "@/components/admin/football-synchronization";
import { POST, GET } from "@/app/api/admin/football/jobs/route";
import { GET as GET_ONE } from "@/app/api/admin/football/jobs/[requestId]/route";
import { synchronizationFixture, synchronizationActorId as actor, synchronizationMatchId } from "../fixtures/football-synchronization";
import { SYNCHRONIZATION_JOBS } from "@/src/admin/football-synchronization-client";
import { AdminJobRequestError } from "@/src/jobs/admin-contract";
import { FootballData } from "@/components/admin/football-data";
import { parseFootballDataQuery } from "@/src/admin/football-data";
import { matchPageFixture } from "../fixtures/match-page";

const origin = "https://staging.example.invalid";
let record: ReturnType<typeof synchronizationFixture> | null;
let lostResponse = false;
const network = vi.fn<typeof fetch>();
const refresh = () => screen.getByRole("button", { name: "Обновить состояние" });
const ready = async () => waitFor(() => expect(refresh().hasAttribute("disabled")).toBe(false));

beforeEach(() => {
  vi.resetAllMocks(); sessionStorage.clear(); record = null; lostResponse = false;
  vi.stubEnv("AUTH_URL", origin);
  mocks.session.mockResolvedValue({ authenticated: true, mfaRequired: false, identityAccess: { accountId: actor, authUserId: "user", roles: ["super_admin"], email: null } });
  mocks.history.mockImplementation(async () => record ? [record] : []);
  mocks.get.mockImplementation(async () => record);
  mocks.admit.mockImplementation(async (actorId, command, correlationId) => {
    const deduplicated = record !== null;
    if (!record) record = { ...synchronizationFixture(), actorAccountId: actorId, requestKey: command.requestKey, correlationId, jobType: command.jobType, matchId: command.matchId ?? null };
    return { requestId: record.id, executionId: record.execution.id, deduplicated };
  });
  network.mockImplementation(async (path, init) => {
    // Browser supplies Origin automatically; bridge the real UI fetch to actual Route Handlers.
    const request = new Request(new URL(String(path), origin), { ...init, headers: {
      ...init?.headers, Origin: origin, "X-Request-ID": "integration-correlation",
    } });
    if (init?.method === "POST") {
      const response = await POST(request);
      if (lostResponse) { lostResponse = false; throw new TypeError("transport failed after commit"); }
      return response;
    }
    const id = new URL(request.url).pathname.split("/").at(-1)!;
    return id === "jobs" ? GET(request) : GET_ONE(request, { params: Promise.resolve({ requestId: id }) });
  });
  vi.stubGlobal("fetch", network);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("Synchronization UI through the real Admin HTTP boundary", () => {
  it("Data mode replays the same confirmed Match request after a lost response with the original execution ID", async () => {
    lostResponse = true;
    render(<FootballSynchronization actorAccountId={actor} matchScope={{ id: synchronizationMatchId, label: "Selected fixture" }} />); await ready();
    fireEvent.click(screen.getByRole("checkbox")); fireEvent.click(screen.getByRole("button", { name: "Отправить запрос на запуск" })); await ready();
    const executionId = record!.execution.id;
    expect(screen.getByRole("alert").textContent).toContain("NETWORK_ERROR");
    fireEvent.click(screen.getByRole("button", { name: "Повторить тот же запрос" })); await ready();
    expect(mocks.admit).toHaveBeenCalledTimes(2);
    expect(mocks.admit.mock.calls[0]).toEqual(mocks.admit.mock.calls[1]);
    expect(screen.getByRole("region", { name: "Состояние execution" }).textContent).toContain(executionId);
    expect(screen.getByRole("status").textContent).toContain("исходный execution");
    fireEvent.click(refresh()); await ready(); expect(mocks.admit).toHaveBeenCalledTimes(2);
  });
  it("does not convert succeeded Match execution into complete persisted datasets", async () => {
    const detail = matchPageFixture(); detail.match.id = synchronizationMatchId;
    render(<FootballData actorAccountId={actor} filter={parseFootballDataQuery({ view: "matches", id: synchronizationMatchId })}
      data={{ view: "matches", checkedAt: new Date("2026-10-15T12:00:00Z"), clubs: [], page: { items: [], total: 0, page: 1, totalPages: 0 }, detail,
        evidence: { eventRows: 0, eventsSucceededAt: null, lineups: [], statistics: [] } }} />); await ready();
    fireEvent.click(screen.getByRole("checkbox")); fireEvent.click(screen.getByRole("button", { name: "Отправить запрос на запуск" })); await ready();
    record = { ...record!, execution: { ...record!.execution, status: "succeeded", finishedAt: "2026-10-15T12:01:00Z" } };
    fireEvent.click(refresh()); await ready();
    expect(screen.getByRole("region", { name: "Состояние execution" }).textContent).toContain("(succeeded)");
    expect(screen.getByRole("region", { name: "Доступность Match datasets" }).textContent).toContain("Данные отсутствуют; подтверждения пустого snapshot нет.");
    expect(mocks.admit).toHaveBeenCalledOnce();
  });
  it.each(SYNCHRONIZATION_JOBS.slice(5))("Data mode admits $type through the existing API with exact Match scope", async (job) => {
    render(<FootballSynchronization actorAccountId={actor} matchScope={{ id: synchronizationMatchId, label: "Selected fixture" }} />); await ready();
    fireEvent.click(screen.getByRole("radio", { name: new RegExp(job.label) }));
    expect(mocks.admit).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("checkbox")); fireEvent.click(screen.getByRole("button", { name: "Отправить запрос на запуск" })); await ready();
    expect(mocks.admit).toHaveBeenCalledWith(actor, expect.objectContaining({ jobType: job.type, matchId: synchronizationMatchId }), "integration-correlation", 3);
    expect(screen.getByRole("region", { name: "Состояние execution" }).textContent).toContain("(pending)");
  });
  it.each([["ADMIN_JOB_COOLDOWN", 429], ["ADMIN_JOB_BUSY", 409], ["FOOTBALL_JOB_ALREADY_RUNNING", 409]])("Data mode displays %s without a second admission", async (code, status) => {
    mocks.admit.mockRejectedValue(new AdminJobRequestError(String(code), Number(status), "PRIVATE DETAIL"));
    render(<FootballSynchronization actorAccountId={actor} matchScope={{ id: synchronizationMatchId, label: "Selected fixture" }} />); await ready();
    fireEvent.click(screen.getByRole("checkbox")); fireEvent.click(screen.getByRole("button", { name: "Отправить запрос на запуск" })); await ready();
    expect(screen.getByRole("alert").textContent).toContain(code); expect(screen.getByRole("alert").textContent).not.toContain("PRIVATE");
    expect(mocks.admit).toHaveBeenCalledOnce();
  });
  it("requires confirmation, attributes to Identity, and refreshes pending → succeeded with GET only", async () => {
    render(<FootballSynchronization actorAccountId={actor} />); await ready();
    expect(mocks.admit).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Отправить запрос на запуск" }));
    await ready();
    expect(mocks.admit).toHaveBeenCalledWith(actor, expect.objectContaining({ jobType: "football.sync-serie-a-foundation" }), "integration-correlation", 3);
    expect(screen.getByRole("region", { name: "Состояние execution" }).textContent).toContain("(pending)");
    record = { ...record!, execution: { ...record!.execution, status: "succeeded", attemptCount: 1, finishedAt: "2026-10-15T12:01:00.000Z" } };
    fireEvent.click(refresh()); await ready();
    expect(screen.getByRole("region", { name: "Состояние execution" }).textContent).toContain("(succeeded)");
    expect(mocks.admit).toHaveBeenCalledOnce();
  });

  it("reconciles a lost response without another admission", async () => {
    lostResponse = true;
    render(<FootballSynchronization actorAccountId={actor} />); await ready();
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Отправить запрос на запуск" }));
    await ready();
    expect(screen.getByRole("alert").textContent).toContain("NETWORK_ERROR");
    fireEvent.click(refresh()); await ready();
    expect(screen.queryByRole("heading", { name: "Сохранённый запрос" })).toBeNull();
    expect(mocks.admit).toHaveBeenCalledOnce();
    expect(screen.getByRole("region", { name: "Состояние execution" }).textContent).toContain(record!.execution.id);
  });

  it.each([null, ["writer"], ["admin"]])("revalidates authorization on POST after the page has opened: %s", async (roles) => {
    render(<FootballSynchronization actorAccountId={actor} />); await ready();
    mocks.session.mockResolvedValue(roles === null ? { authenticated: false, identityAccess: null }
      : { authenticated: true, mfaRequired: false, identityAccess: { accountId: actor, roles, authUserId: "user", email: null } });
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Отправить запрос на запуск" }));
    await ready();
    expect(screen.getByRole("alert").textContent).toContain(roles === null ? "UNAUTHORIZED" : "FORBIDDEN");
    expect(mocks.admit).not.toHaveBeenCalled();
  });
});
