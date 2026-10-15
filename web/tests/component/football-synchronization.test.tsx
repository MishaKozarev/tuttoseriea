// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FootballSynchronization } from "@/components/admin/football-synchronization";
import { SYNCHRONIZATION_JOBS, type SynchronizationCommand } from "@/src/admin/football-synchronization-client";
import { ADMIN_JOB_TYPES, parseAdminJobCommand } from "@/src/jobs/admin-contract";
import { synchronizationActorId as actor, synchronizationFixture, synchronizationMatchId as matchId } from "../fixtures/football-synchronization";

const fetchMock = vi.fn<typeof fetch>();
let record = synchronizationFixture();
let admitted = false;
const posts = () => fetchMock.mock.calls.filter(([, init]) => init?.method === "POST");
const confirmation = () => screen.getByRole("checkbox", { name: "Подтверждаю синхронизацию указанной задачи и scope" });
const launch = () => screen.getByRole("button", { name: "Отправить запрос на запуск" });
const details = () => screen.getByRole("region", { name: "Состояние execution" });
const refresh = () => screen.getByRole("button", { name: "Обновить состояние" });

async function ready() {
  await waitFor(() => expect(refresh().hasAttribute("disabled")).toBe(false));
}
function confirmAndSubmit() {
  fireEvent.click(confirmation());
  fireEvent.click(launch());
}
function reply(value: unknown, status = 200) { return Response.json(value, { status }); }
beforeEach(() => {
  sessionStorage.clear();
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
  record = synchronizationFixture(); admitted = false;
  fetchMock.mockImplementation(async (url, init) => {
    if (init?.method === "POST") {
      const command = JSON.parse(String(init.body)) as SynchronizationCommand;
      record = { ...record, jobType: command.jobType, matchId: command.matchId ?? null, requestKey: command.requestKey };
      admitted = true;
      return reply({ requestId: record.id, executionId: record.execution.id, deduplicated: false }, 202);
    }
    return String(url).includes("?limit=") ? reply({ requests: admitted ? [record] : [] }) : reply({ request: record });
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("Football synchronization component", () => {
  it.each(SYNCHRONIZATION_JOBS.slice(5))("Data mode confirms only $label for its fixed canonical Match UUID", async (job) => {
    render(<FootballSynchronization actorAccountId={actor} matchScope={{ id: matchId, label: "Милан — Интер" }} />); await ready();
    expect(screen.getAllByRole("radio")).toHaveLength(3); expect(screen.queryByLabelText("Match UUID")).toBeNull();
    expect(launch().hasAttribute("disabled")).toBe(true);
    fireEvent.click(screen.getByRole("radio", { name: new RegExp(job.label) }));
    confirmAndSubmit(); await ready();
    expect(parseAdminJobCommand(JSON.parse(String(posts()[0][1]?.body)))).toMatchObject({ jobType: job.type, matchId });
    expect(details().textContent).toContain("(pending)"); expect(details().textContent).toContain("consumer не активен");
  });
  it("keeps global concurrency protection even when active history belongs to another Match", async () => {
    admitted = true; // Existing season-wide pending request must block this Match's launch.
    render(<FootballSynchronization actorAccountId={actor} matchScope={{ id: matchId, label: "Милан — Интер" }} />); await ready();
    fireEvent.click(confirmation()); expect(launch().hasAttribute("disabled")).toBe(true); expect(posts()).toHaveLength(0);
    expect(screen.getByText(/В истории есть незавершённый Admin execution/)).toBeTruthy();
  });
  it("never retargets or replays an unresolved foreign intent from the Data page", async () => {
    sessionStorage.setItem(`football-admin-admission:v1:${actor}`, JSON.stringify({ command: { jobType: SYNCHRONIZATION_JOBS[0].type, requestKey: record.requestKey, confirmed: true }, outcome: "unknown" }));
    render(<FootballSynchronization actorAccountId={actor} matchScope={{ id: matchId, label: "Милан — Интер" }} />); await ready();
    expect(screen.getByText(/Сохранён запрос другого scope/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Повторить тот же запрос" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Отправить запрос на запуск" })).toBeNull();
    fireEvent.click(refresh()); await ready(); expect(posts()).toHaveLength(0);
  });
  it("shows exactly the eight jobs and opens with GET only", async () => {
    render(<FootballSynchronization actorAccountId={actor} />); await ready();
    expect(screen.getAllByRole("radio")).toHaveLength(8);
    expect(SYNCHRONIZATION_JOBS.map((job) => job.type)).toEqual([...ADMIN_JOB_TYPES]);
    expect(posts()).toHaveLength(0);
    expect(launch().hasAttribute("disabled")).toBe(true);
    expect(screen.queryByLabelText("Match UUID")).toBeNull();
    fireEvent.submit(launch().closest("form")!);
    expect(posts()).toHaveLength(0);
  });

  it.each(SYNCHRONIZATION_JOBS.slice(0, 5))("confirms fixed scope for $label", async (job) => {
    render(<FootballSynchronization actorAccountId={actor} />); await ready();
    fireEvent.click(screen.getByRole("radio", { name: new RegExp(job.label) }));
    expect(screen.getByText(/Серия A \(135\), сезон 2026\/27 \(2026\) · весь сезон/)).toBeTruthy();
    expect(posts()).toHaveLength(0);
    confirmAndSubmit();
    await waitFor(() => expect(within(details()).getByText(/Ожидает выполнения \(pending\)/)).toBeTruthy());
    const command = JSON.parse(String(posts()[0][1]?.body));
    expect(command).toEqual({ jobType: job.type, confirmed: true, requestKey: expect.any(String) });
    expect(parseAdminJobCommand(command).jobType).toBe(job.type);
    expect(posts()).toHaveLength(1);
  });

  it.each(SYNCHRONIZATION_JOBS.slice(5))("requires canonical Match UUID and explicit confirmation for $label", async (job) => {
    render(<FootballSynchronization actorAccountId={actor} />); await ready();
    fireEvent.click(screen.getByRole("radio", { name: new RegExp(job.label) }));
    const input = screen.getByLabelText("Match UUID");
    for (const value of ["bad", matchId.toUpperCase()]) {
      fireEvent.change(input, { target: { value } });
      expect(launch().hasAttribute("disabled")).toBe(true);
    }
    fireEvent.change(input, { target: { value: ` ${matchId} ` } });
    expect(posts()).toHaveLength(0);
    confirmAndSubmit();
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(parseAdminJobCommand(JSON.parse(String(posts()[0][1]?.body))).matchId).toBe(matchId);
    await ready();
  });

  it("clears confirmation when the task or Match UUID changes", async () => {
    render(<FootballSynchronization actorAccountId={actor} />); await ready();
    fireEvent.click(confirmation());
    fireEvent.click(screen.getByRole("radio", { name: /События матча/ }));
    expect((confirmation() as HTMLInputElement).checked).toBe(false);
    fireEvent.change(screen.getByLabelText("Match UUID"), { target: { value: matchId } });
    fireEvent.click(confirmation());
    fireEvent.change(screen.getByLabelText("Match UUID"), { target: { value: record.id } });
    expect((confirmation() as HTMLInputElement).checked).toBe(false);
    expect(posts()).toHaveLength(0);
  });

  it("blocks double submission while admission is in flight", async () => {
    let resolvePost!: (response: Response) => void;
    const original = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation((url, init) => init?.method === "POST"
      ? new Promise((resolve) => { resolvePost = resolve; }) : original(url, init));
    render(<FootballSynchronization actorAccountId={actor} />); await ready();
    fireEvent.click(confirmation());
    const button = launch();
    fireEvent.click(button); fireEvent.click(button);
    expect(posts()).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Повторить тот же запрос" }).hasAttribute("disabled")).toBe(true);
    await act(async () => resolvePost(reply({ requestId: record.id, executionId: record.execution.id, deduplicated: true })));
    await ready();
    expect(screen.getByRole("status").textContent).toContain("Новый execution не создавался");
  });

  it("retains the same body/key across a lost response, reload and explicit duplicate replay", async () => {
    const original = fetchMock.getMockImplementation()!;
    let postCount = 0;
    fetchMock.mockImplementation(async (url, init) => {
      if (init?.method !== "POST") return reply({ requests: [] });
      if (++postCount === 1) throw new TypeError("PRIVATE NETWORK ERROR");
      await original(url, init);
      return reply({ requestId: record.id, executionId: record.execution.id, deduplicated: true });
    });
    const view = render(<FootballSynchronization actorAccountId={actor} />); await ready(); confirmAndSubmit();
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("NETWORK_ERROR"));
    const body = posts()[0][1]?.body;
    expect(screen.queryByRole("button", { name: "Изменить запуск" })).toBeNull();
    view.unmount();
    render(<FootballSynchronization actorAccountId={actor} />); await ready();
    expect(posts()).toHaveLength(1); // Restoring the intent must never POST automatically.
    fireEvent.click(screen.getByRole("button", { name: "Повторить тот же запрос" }));
    await ready();
    expect(posts()).toHaveLength(2);
    expect(posts()[1][1]?.body).toBe(body);
    expect(screen.getByRole("status").textContent).toContain("исходный execution");
  });

  it("recovers a committed request from history after response loss without a second POST", async () => {
    const original = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (url, init) => {
      const response = await original(url, init);
      if (init?.method === "POST") throw new TypeError("lost response");
      return response;
    });
    render(<FootballSynchronization actorAccountId={actor} />); await ready(); confirmAndSubmit();
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("NETWORK_ERROR"));
    fireEvent.click(refresh()); await ready();
    expect(screen.queryByRole("heading", { name: "Сохранённый запрос" })).toBeNull();
    expect(within(details()).getByText(/Ожидает выполнения \(pending\)/)).toBeTruthy();
    expect(posts()).toHaveLength(1);
    record = { ...record, execution: { ...record.execution, status: "succeeded" } };
    fireEvent.click(refresh()); await ready();
    expect((confirmation() as HTMLInputElement).checked).toBe(false);
    expect(launch().hasAttribute("disabled")).toBe(true);
    expect(posts()).toHaveLength(1);
  });

  it.each([
    [401, "UNAUTHORIZED"], [403, "FORBIDDEN"], [409, "ADMIN_JOB_BUSY"], [409, "FOOTBALL_JOB_ALREADY_RUNNING"],
    [409, "IDEMPOTENCY_CONFLICT"], [429, "ADMIN_JOB_COOLDOWN"], [400, "MATCH_OUTSIDE_CURRENT_SERIE_A"], [500, "INTERNAL_SERVER_ERROR"],
  ])("handles %s / %s by code without exposing server messages", async (status, code) => {
    const original = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (url, init) => init?.method === "POST"
      ? reply({ error: { code, message: "PRIVATE ERROR MESSAGE", requestId: "safe-correlation" } }, Number(status)) : original(url, init));
    render(<FootballSynchronization actorAccountId={actor} />); await ready(); confirmAndSubmit();
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain(code));
    expect(screen.getByRole("alert").textContent).toContain("safe-correlation");
    expect(screen.getByRole("alert").textContent).not.toContain("PRIVATE");
    expect(!!screen.queryByRole("button", { name: "Изменить запуск" })).toBe(Number(status) < 500);
    expect(posts()).toHaveLength(1);
  });

  it.each(["running", "succeeded", "failed"] as const)("refreshes pending to %s using only GET", async (status) => {
    admitted = true;
    record.execution.attemptCount = 1; record.execution.lastErrorCode = "transient_error";
    render(<FootballSynchronization actorAccountId={actor} />); await ready();
    expect(details().textContent).toContain("Повторная попытка доступна с");
    expect(details().textContent).toContain("Если Admin consumer не активен");
    record = { ...record, execution: { ...record.execution, status } };
    fireEvent.click(refresh()); await ready();
    expect(details().textContent).toContain(`(${status})`);
    expect(details().textContent).toContain("1 / 3");
    expect(posts()).toHaveLength(0);
  });

  it("refreshes selected detail outside the history window without creating an execution", async () => {
    admitted = true;
    render(<FootballSynchronization actorAccountId={actor} />); await ready();
    admitted = false;
    fireEvent.click(refresh()); await ready();
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith(`/${record.id}`))).toBe(true);
    expect(details().textContent).toContain(record.execution.id);
    expect(posts()).toHaveLength(0);
  });

  it("retains last known data and blocks fresh admission after a failed refresh", async () => {
    admitted = true;
    render(<FootballSynchronization actorAccountId={actor} />); await ready();
    fetchMock.mockRejectedValue(new TypeError("PRIVATE NETWORK DETAIL"));
    fireEvent.click(refresh()); await ready();
    expect(details().textContent).toContain(record.execution.id);
    expect(screen.getByText(/Показанные сведения могут быть устаревшими/)).toBeTruthy();
    expect(launch().hasAttribute("disabled")).toBe(true);
    expect(posts()).toHaveLength(0);
  });

  it("does not POST if the retry key cannot be persisted", async () => {
    render(<FootballSynchronization actorAccountId={actor} />); await ready();
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("storage blocked"); });
    confirmAndSubmit();
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("CLIENT_STORAGE_ERROR"));
    expect(posts()).toHaveLength(0);
  });

  it("requires a fresh confirmation before changing a definitively rejected cooldown request", async () => {
    const original = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (url, init) => init?.method === "POST"
      ? reply({ error: { code: "ADMIN_JOB_COOLDOWN", message: "ignored", requestId: "cooldown-id" } }, 429) : original(url, init));
    render(<FootballSynchronization actorAccountId={actor} />); await ready(); confirmAndSubmit(); await ready();
    fireEvent.click(screen.getByRole("button", { name: "Изменить запуск" }));
    expect((confirmation() as HTMLInputElement).checked).toBe(false);
    expect(launch().hasAttribute("disabled")).toBe(true);
    expect(posts()).toHaveLength(1);
    fireEvent.click(screen.getByRole("radio", { name: /Турнирная таблица/ }));
    confirmAndSubmit(); await ready();
    expect(posts()).toHaveLength(2);
    expect(JSON.parse(String(posts()[0][1]?.body)).requestKey).not.toBe(JSON.parse(String(posts()[1][1]?.body)).requestKey);
  });

  it("treats a malformed successful admission reply as ambiguous and retains the key", async () => {
    const original = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (url, init) => init?.method === "POST"
      ? reply({ unexpected: true }, 202) : original(url, init));
    render(<FootballSynchronization actorAccountId={actor} />); await ready(); confirmAndSubmit(); await ready();
    expect(screen.getByRole("alert").textContent).toContain("INVALID_RESPONSE");
    expect(screen.queryByRole("button", { name: "Изменить запуск" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Повторить тот же запрос" })); await ready();
    expect(posts()).toHaveLength(2);
    expect(posts()[1][1]?.body).toBe(posts()[0][1]?.body);
  });
});
