// Browser-safe boundary: never import the runner registry or repositories at runtime here.
import type { AdminJobType } from "../jobs/admin-contract";
import type { AdminJobRepository, AdminJobView } from "../jobs/admin-repository";
import {
  SERIE_A_CURRENT_SEASON, SERIE_A_CURRENT_SEASON_LABEL, SERIE_A_PROVIDER_LEAGUE_ID,
  SERIE_A_FOUNDATION_JOB_TYPE, SERIE_A_MATCHES_JOB_TYPE, SERIE_A_STANDINGS_JOB_TYPE,
  SERIE_A_SQUADS_JOB_TYPE, SERIE_A_PLAYER_STATISTICS_JOB_TYPE,
  SERIE_A_MATCH_EVENTS_JOB_TYPE, SERIE_A_MATCH_LINEUPS_JOB_TYPE, SERIE_A_MATCH_STATISTICS_JOB_TYPE,
} from "../football/foundation";

export const SYNCHRONIZATION_JOBS = [
  { type: SERIE_A_FOUNDATION_JOB_TYPE, label: "Лига, сезон и клубы", matchScoped: false },
  { type: SERIE_A_MATCHES_JOB_TYPE, label: "Матчи сезона", matchScoped: false },
  { type: SERIE_A_STANDINGS_JOB_TYPE, label: "Турнирная таблица", matchScoped: false },
  { type: SERIE_A_SQUADS_JOB_TYPE, label: "Текущие составы клубов", matchScoped: false },
  { type: SERIE_A_PLAYER_STATISTICS_JOB_TYPE, label: "Сезонная статистика игроков", matchScoped: false },
  { type: SERIE_A_MATCH_EVENTS_JOB_TYPE, label: "События матча", matchScoped: true },
  { type: SERIE_A_MATCH_LINEUPS_JOB_TYPE, label: "Стартовые составы матча", matchScoped: true },
  { type: SERIE_A_MATCH_STATISTICS_JOB_TYPE, label: "Статистика матча", matchScoped: true },
] as const satisfies readonly { type: AdminJobType; label: string; matchScoped: boolean }[];

type Execution = AdminJobView["execution"];
export type SynchronizationRequest = Omit<AdminJobView, "createdAt" | "execution"> & {
  createdAt: string;
  execution: Omit<Execution, "availableAt" | "startedAt" | "finishedAt" | "updatedAt"> & {
    availableAt: string; startedAt: string | null; finishedAt: string | null; updatedAt: string;
  };
};
export type Admission = Awaited<ReturnType<AdminJobRepository["admit"]>>;
export type SynchronizationCommand = { jobType: AdminJobType; matchId?: string; requestKey: string; confirmed: true };
export type SynchronizationIntent = { command: SynchronizationCommand; outcome: "unknown" | "rejected" };

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export const isMatchUuid = (value: string) => uuidPattern.test(value);
export const synchronizationJob = (type: string) => SYNCHRONIZATION_JOBS.find((job) => job.type === type);
export function synchronizationScope(type: string, matchId?: string | null): string {
  const season = `Серия A (${SERIE_A_PROVIDER_LEAGUE_ID}), сезон ${SERIE_A_CURRENT_SEASON_LABEL} (${SERIE_A_CURRENT_SEASON})`;
  return `${season} · ${synchronizationJob(type)?.matchScoped ? `матч ${matchId || "не выбран"}` : "весь сезон"}`;
}
export const SYNCHRONIZATION_STATUSES: Record<Execution["status"], string> = {
  pending: "Ожидает выполнения", running: "Выполняется", succeeded: "Успешно завершён", failed: "Завершён с ошибкой",
};
export function synchronizationTime(value: string | null): string {
  return value === null ? "Нет сведений" : new Intl.DateTimeFormat("ru-RU", {
    dateStyle: "short", timeStyle: "medium", timeZone: "UTC",
  }).format(new Date(value)) + " UTC";
}

const errorMessages: Record<string, string> = {
  UNAUTHORIZED: "Сессия истекла. Войдите снова и обновите состояние.",
  FORBIDDEN: "Сервер отклонил доступ. Проверьте права, сессию и источник запроса.",
  VALIDATION_ERROR: "Проверьте выбранную задачу и Match UUID.",
  CONFIRMATION_REQUIRED: "Необходимо явное подтверждение scope запуска.",
  MATCH_OUTSIDE_CURRENT_SERIE_A: "Матч не найден в текущем сезоне Серии A. Проверьте UUID.",
  ADMIN_JOB_BUSY: "Другой Admin execution ожидает или выполняется. Обновите состояние и дождитесь его завершения.",
  FOOTBALL_JOB_ALREADY_RUNNING: "Эта задача уже выполняется вне Admin. Дождитесь её завершения и обновите состояние.",
  ADMIN_JOB_COOLDOWN: "Для этого scope действует cooldown: 300 секунд после завершения предыдущего Admin execution. Точное оставшееся время API не сообщает.",
  IDEMPOTENCY_CONFLICT: "Ключ запроса уже связан с другим scope. Этот запрос отклонён.",
  NOT_FOUND: "Admin request не найден. Обновите историю.",
  INTERNAL_SERVER_ERROR: "Сервер не смог обработать запрос. Обновите состояние; для отправки используйте тот же ключ запроса.",
  INVALID_RESPONSE: "Сервер вернул неожиданный ответ. Обновите состояние.",
  NETWORK_ERROR: "Не удалось получить ответ сервера. Обновите состояние.",
  CLIENT_STORAGE_ERROR: "Не удалось сохранить ключ повтора во вкладке. Повторите действие после восстановления доступа к хранилищу браузера.",
};
export class SynchronizationApiError extends Error {
  constructor(readonly code: string, readonly requestId: string | null = null, readonly rejected = false) {
    super(errorMessages[code] ?? "Не удалось выполнить запрос. Обновите состояние и проверьте код ошибки.");
  }
}

const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === "string";
const date = (value: unknown) => text(value) && Number.isFinite(Date.parse(value));
const nullableDate = (value: unknown) => value === null || date(value);

function parseRequest(value: unknown): SynchronizationRequest {
  if (!object(value) || !text(value.id) || !uuidPattern.test(value.id) || !text(value.jobType) || !synchronizationJob(value.jobType) ||
      !text(value.requestKey) || !uuidPattern.test(value.requestKey) || !text(value.actorAccountId) ||
      !text(value.idempotencyKey) || !text(value.correlationId) || !date(value.createdAt) ||
      !(value.matchId === null || (text(value.matchId) && uuidPattern.test(value.matchId))) || !object(value.execution)) {
    throw new SynchronizationApiError("INVALID_RESPONSE");
  }
  const e = value.execution;
  if (!text(e.id) || !uuidPattern.test(e.id) || !text(e.status) || !Object.hasOwn(SYNCHRONIZATION_STATUSES, e.status) ||
      !Number.isInteger(e.attemptCount) || Number(e.attemptCount) < 0 || !Number.isInteger(e.maxAttempts) || Number(e.maxAttempts) < 1 ||
      !date(e.availableAt) || !date(e.updatedAt) || !nullableDate(e.startedAt) || !nullableDate(e.finishedAt) ||
      !(e.lastErrorCode === null || text(e.lastErrorCode))) throw new SynchronizationApiError("INVALID_RESPONSE");
  return value as SynchronizationRequest;
}

async function api(path: string, command?: SynchronizationCommand): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(`/api/admin/football/jobs${path}`, {
      method: command ? "POST" : "GET", credentials: "same-origin", mode: "same-origin", redirect: "error", cache: "no-store",
      signal: AbortSignal.timeout(15_000),
      ...(command ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(command) } : {}),
    });
  } catch { throw new SynchronizationApiError("NETWORK_ERROR"); }
  let body: unknown;
  try { body = await response.json(); } catch { throw new SynchronizationApiError("INVALID_RESPONSE"); }
  if (!response.ok) {
    if (object(body) && object(body.error) && text(body.error.code)) {
      throw new SynchronizationApiError(body.error.code, text(body.error.requestId) ? body.error.requestId : null,
        response.status >= 400 && response.status < 500);
    }
    throw new SynchronizationApiError("INVALID_RESPONSE");
  }
  return body;
}

export async function admitSynchronization(command: SynchronizationCommand): Promise<Admission> {
  const body = await api("", command);
  if (!object(body) || !text(body.requestId) || !uuidPattern.test(body.requestId) ||
      !text(body.executionId) || !uuidPattern.test(body.executionId) || typeof body.deduplicated !== "boolean") {
    throw new SynchronizationApiError("INVALID_RESPONSE");
  }
  return body as Admission;
}
export async function listSynchronizations(): Promise<SynchronizationRequest[]> {
  const body = await api("?limit=20");
  if (!object(body) || !Array.isArray(body.requests) || body.requests.length > 20) throw new SynchronizationApiError("INVALID_RESPONSE");
  return body.requests.map(parseRequest);
}
export async function getSynchronization(requestId: string): Promise<SynchronizationRequest> {
  if (!uuidPattern.test(requestId)) throw new SynchronizationApiError("INVALID_RESPONSE");
  const body = await api(`/${requestId}`);
  if (!object(body)) throw new SynchronizationApiError("INVALID_RESPONSE");
  const request = parseRequest(body.request);
  if (request.id !== requestId) throw new SynchronizationApiError("INVALID_RESPONSE");
  return request;
}

function storageKey(actorId: string) { return `football-admin-admission:v1:${actorId}`; }
export function readSynchronizationIntent(actorId: string): SynchronizationIntent | null {
  try {
    const raw = sessionStorage.getItem(storageKey(actorId));
    if (raw === null) return null;
    const saved: unknown = JSON.parse(raw);
    if (!object(saved) || !object(saved.command)) throw new SynchronizationApiError("CLIENT_STORAGE_ERROR");
    const c = saved.command;
    const job = text(c.jobType) ? synchronizationJob(c.jobType) : undefined;
    if (!job || !text(c.requestKey) || !uuidPattern.test(c.requestKey) || c.confirmed !== true ||
        (job.matchScoped ? !text(c.matchId) || !uuidPattern.test(c.matchId) : c.matchId !== undefined) ||
        !["unknown", "rejected"].includes(String(saved.outcome)) ||
        Object.keys(c).some((key) => !["jobType", "matchId", "requestKey", "confirmed"].includes(key))) {
      throw new SynchronizationApiError("CLIENT_STORAGE_ERROR");
    }
    return saved as SynchronizationIntent;
  } catch { throw new SynchronizationApiError("CLIENT_STORAGE_ERROR"); }
}
export function storeSynchronizationIntent(actorId: string, intent: SynchronizationIntent | null): void {
  try {
    if (intent) sessionStorage.setItem(storageKey(actorId), JSON.stringify(intent));
    else sessionStorage.removeItem(storageKey(actorId));
  } catch { throw new SynchronizationApiError("CLIENT_STORAGE_ERROR"); }
}
