"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import {
  SYNCHRONIZATION_JOBS, SYNCHRONIZATION_STATUSES, SynchronizationApiError,
  admitSynchronization, getSynchronization, isMatchUuid, listSynchronizations,
  readSynchronizationIntent, storeSynchronizationIntent, synchronizationJob, synchronizationScope, synchronizationTime,
  type Admission, type SynchronizationCommand, type SynchronizationIntent, type SynchronizationRequest,
} from "@/src/admin/football-synchronization-client";

function failure(error: unknown): SynchronizationApiError {
  return error instanceof SynchronizationApiError ? error : new SynchronizationApiError("NETWORK_ERROR");
}

export function FootballSynchronization({ actorAccountId, matchScope }: { actorAccountId: string; matchScope?: { id: string; label: string } }) {
  const scopeId = matchScope?.id;
  const jobs = scopeId ? SYNCHRONIZATION_JOBS.filter((job) => job.matchScoped) : SYNCHRONIZATION_JOBS;
  const [jobType, setJobType] = useState<string>(jobs[0].type);
  const [matchId, setMatchId] = useState(scopeId ?? "");
  const [confirmed, setConfirmed] = useState(false);
  const [history, setHistory] = useState<SynchronizationRequest[]>([]);
  const [selected, setSelected] = useState<SynchronizationRequest | null>(null);
  const [admission, setAdmission] = useState<Admission | null>(null);
  const [intent, setIntent] = useState<SynchronizationIntent | null>(null);
  const [busy, setBusy] = useState<"read" | "post" | null>("read");
  const [ready, setReady] = useState(false);
  const [storageBlocked, setStorageBlocked] = useState(false);
  const [lastRead, setLastRead] = useState<string | null>(null);
  const [error, setError] = useState<SynchronizationApiError | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const operation = useRef(true);

  useEffect(() => {
    let alive = true;
    let saved: SynchronizationIntent | null = null;
    let storageError = false;
    try { saved = readSynchronizationIntent(actorAccountId); } catch { storageError = true; }
    listSynchronizations().then((requests) => {
      if (!alive) return;
      const retained = saved;
      const recovered = retained && requests.find((r) => matchesIntent(r, retained, actorAccountId));
      if (recovered) {
        try { storeSynchronizationIntent(actorAccountId, null); saved = null; } catch { storageError = true; }
      }
      setHistory(requests);
      setSelected((recovered && inMatchScope(recovered, scopeId) ? recovered : requests.find((r) => inMatchScope(r, scopeId))) || null);
      setReady(true);
      setLastRead(new Date().toISOString());
    }).catch((caught: unknown) => {
      if (alive) setError(failure(caught));
    }).finally(() => {
      if (!alive) return;
      setIntent(saved);
      setStorageBlocked(storageError);
      if (storageError) setError(new SynchronizationApiError("CLIENT_STORAGE_ERROR"));
      setBusy(null);
      operation.current = false;
    });
    return () => { alive = false; };
  }, [actorAccountId, scopeId]);

  const job = synchronizationJob(jobType)!;
  const validScope = (!job.matchScoped || isMatchUuid(matchId.trim())) && (!scopeId || matchId === scopeId && job.matchScoped);
  const visibleHistory = history.filter((request) => inMatchScope(request, scopeId));
  const foreignIntent = intent !== null && !inMatchScope(intent.command, scopeId);
  const active = history.some((request) => ["pending", "running"].includes(request.execution.status));
  const frozen = busy !== null || intent !== null || storageBlocked;

  async function readState(requestId?: string, pendingIntent = intent, executionId?: string) {
    const requests = await listSynchronizations();
    const recovered = pendingIntent && requests.find((r) => matchesIntent(r, pendingIntent, actorAccountId));
    const id = recovered && inMatchScope(recovered, scopeId) ? recovered.id : requestId;
    const detail = id ? requests.find((request) => request.id === id) ?? await getSynchronization(id) : requests.find((r) => inMatchScope(r, scopeId)) ?? null;
    if (detail && !inMatchScope(detail, scopeId)) throw new SynchronizationApiError("INVALID_RESPONSE");
    if (executionId && detail?.execution.id !== executionId) throw new SynchronizationApiError("INVALID_RESPONSE");
    if (recovered) {
      storeSynchronizationIntent(actorAccountId, null);
      setIntent(null);
      setNotice("Сохранённый запрос найден в истории. Новый execution не создавался.");
    }
    setHistory(requests);
    setSelected(detail);
    setReady(true);
    setLastRead(new Date().toISOString());
  }

  async function refresh() {
    if (operation.current) return;
    operation.current = true;
    setBusy("read"); setError(null);
    try {
      let retained = intent;
      if (storageBlocked) {
        retained = readSynchronizationIntent(actorAccountId);
        setIntent(retained); setStorageBlocked(false);
      }
      await readState(admission?.requestId ?? selected?.id, retained);
    }
    catch (caught) { setError(failure(caught)); setReady(false); }
    finally { operation.current = false; setBusy(null); }
  }

  async function send(command: SynchronizationCommand) {
    if (operation.current) return;
    if (!inMatchScope(command, scopeId)) { setError(new SynchronizationApiError("VALIDATION_ERROR")); return; }
    operation.current = true;
    setBusy("post"); setError(null); setNotice(null);
    setConfirmed(false);
    const pending: SynchronizationIntent = { command, outcome: "unknown" };
    setIntent(pending);
    let accepted = false;
    try {
      // Persist intent before POST; reload/retry must retain the original actor-bound key/scope.
      storeSynchronizationIntent(actorAccountId, pending);
      const result = await admitSynchronization(command);
      accepted = true;
      setAdmission(result);
      setSelected(null);
      setConfirmed(false);
      setNotice(result.deduplicated
        ? "Повтор запроса: сервер вернул исходный execution. Новый execution не создавался."
        : "Запрос принят. Исполнение зависит от отдельно активированного Admin consumer.");
      storeSynchronizationIntent(actorAccountId, null);
      setIntent(null);
      await readState(result.requestId, null, result.executionId);
    } catch (caught) {
      const apiError = failure(caught);
      if (!accepted) {
        const retained: SynchronizationIntent = { command, outcome: apiError.rejected ? "rejected" : "unknown" };
        setIntent(retained);
        try { storeSynchronizationIntent(actorAccountId, retained); } catch { /* Keep the same key in memory; no automatic POST. */ }
      } else setReady(false);
      setError(apiError);
    } finally { operation.current = false; setBusy(null); }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!ready || active || frozen || !confirmed || !validScope) return;
    void send({ jobType: job.type, ...(job.matchScoped ? { matchId: matchId.trim() } : {}),
      requestKey: crypto.randomUUID(), confirmed: true });
  }

  function changeRequest() {
    if (operation.current || intent?.outcome !== "rejected") return;
    try {
      storeSynchronizationIntent(actorAccountId, null);
      setIntent(null); setConfirmed(false); setError(null);
    } catch (caught) { setError(failure(caught)); }
  }

  return (
    <div className="space-y-8">
      <div className="space-y-2 rounded-lg border p-4 text-sm">
        <p>Одновременно допускается один незавершённый Admin execution. Для того же scope действует cooldown 300 секунд после завершения.</p>
        <p>Запрос сохраняется для отдельного Admin consumer. Pending означает ожидание и не подтверждает, что consumer активен. Интервал между provider attempts Admin consumer — не менее 500 мс.</p>
        <p>Автоматического повторного запуска из браузера нет. Обновление состояния выполняет только GET.</p>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" variant="outline" disabled={busy !== null} onClick={() => void refresh()}>Обновить состояние</Button>
        <p className="text-sm text-muted-foreground" aria-live="polite">
          {busy === "read" ? "Чтение состояния…" : `Последнее чтение: ${synchronizationTime(lastRead)}.`}
          {!ready && lastRead !== null && " Показанные сведения могут быть устаревшими."}
        </p>
      </div>
      {error && <div role="alert" className="space-y-1 rounded-lg border p-4 text-sm">
        <p>{error.message}</p><p>Код: <code>{error.code}</code>{error.requestId && <> · Request ID: <code>{error.requestId}</code></>}</p>
        {error.code === "UNAUTHORIZED" && <a className="underline" href="/admin/login?returnTo=%2Fadmin%2Ffootball%2Fsynchronization">Войти снова</a>}
      </div>}
      {notice && <p role="status" className="rounded-lg border p-4 text-sm">{notice}</p>}

      {intent ? (
        <section aria-labelledby="retained-heading" className="space-y-3 rounded-lg border p-4">
          <h2 id="retained-heading" className="text-lg font-semibold">Сохранённый запрос</h2>
          <p>{synchronizationJob(intent.command.jobType)?.label}</p>
          <p>{synchronizationScope(intent.command.jobType, intent.command.matchId)}</p>
          <p className="break-all text-sm">Ключ запроса: <code>{intent.command.requestKey}</code></p>
          <p className="text-sm">{intent.outcome === "unknown"
            ? "Результат отправки не подтверждён. Сначала обновите состояние или повторите тот же запрос с исходным ключом. Новый запуск недоступен."
            : "Сервер отклонил запрос. После устранения причины можно повторить его с тем же ключом или изменить запуск."}</p>
          {foreignIntent ? <p className="text-sm">Сохранён запрос другого scope. Для его восстановления откройте <a className="underline" href="/admin/football/synchronization">Синхронизацию</a>. Новый запуск заблокирован до разрешения этого запроса.</p> : <div className="flex flex-wrap gap-3">
            <Button type="button" disabled={busy !== null || storageBlocked} onClick={() => void send(intent.command)}>Повторить тот же запрос</Button>
            {intent.outcome === "rejected" && <Button type="button" variant="outline" disabled={busy !== null} onClick={changeRequest}>Изменить запуск</Button>}
          </div>}
        </section>
      ) : (
        <form onSubmit={submit} className="space-y-4 rounded-lg border p-4">
          <fieldset disabled={frozen} className="min-w-0 space-y-3">
            <legend className="text-lg font-semibold">Выберите задачу</legend>
            <div className="grid gap-3 md:grid-cols-2">
              {jobs.map((item) => (
                <label key={item.type} className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm">
                  <input type="radio" name="football-job" value={item.type} checked={jobType === item.type}
                    onChange={() => { setJobType(item.type); setConfirmed(false); }} />
                  <span><span className="font-medium">{item.label}</span><span className="block text-muted-foreground">{item.matchScoped ? "Один матч по UUID" : "Фиксированный scope сезона"}</span></span>
                </label>
              ))}
            </div>
            {scopeId && <p className="break-words text-sm">Выбранный матч: {matchScope.label}. Внутренний Match UUID: <code className="break-all">{scopeId}</code></p>}
            {job.matchScoped && !scopeId && <div className="space-y-1">
              <label htmlFor="football-match-id" className="block text-sm font-medium">Match UUID</label>
              <input id="football-match-id" className="w-full max-w-xl rounded-lg border bg-background px-3 py-2 text-sm"
                value={matchId} autoComplete="off" spellCheck={false} aria-describedby="football-match-help"
                aria-invalid={matchId.length > 0 && !validScope}
                onChange={(event) => { setMatchId(event.target.value); setConfirmed(false); }} />
              <p id="football-match-help" className="text-sm text-muted-foreground">Внутренний UUID матча текущего сезона Серии A, строчными буквами. Принадлежность сезону проверяет сервер.</p>
            </div>}
          </fieldset>
          <div className="space-y-2" aria-labelledby="scope-heading">
            <h2 id="scope-heading" className="font-semibold">Scope запуска</h2>
            <p>{job.label}: {synchronizationScope(jobType, matchId.trim())}.</p>
            <p className="text-sm text-muted-foreground">Синхронизация может выполнить ограниченные запросы API-Football и обновить сохранённые данные в указанном scope.</p>
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" checked={confirmed} disabled={frozen || !validScope}
                onChange={(event) => setConfirmed(event.target.checked)} />
              <span>Подтверждаю синхронизацию указанной задачи и scope</span>
            </label>
          </div>
          <Button type="submit" disabled={frozen || !ready || active || !confirmed || !validScope}>Отправить запрос на запуск</Button>
          {active && <p className="text-sm">В истории есть незавершённый Admin execution. Новый запуск доступен после его завершения.</p>}
        </form>
      )}

      <section aria-labelledby="execution-heading" className="space-y-3" aria-live="polite">
        <h2 id="execution-heading" className="text-lg font-semibold">Состояние execution</h2>
        {selected ? <ExecutionDetails request={selected} /> : admission ? (
          <div className="space-y-1 text-sm"><p>Request ID: <code>{admission.requestId}</code></p>
            <p>Execution ID: <code>{admission.executionId}</code></p><p>Текущий статус ещё не получен. Обновите состояние.</p></div>
        ) : <p className="text-sm">Выберите запрос из истории или отправьте подтверждённый запрос.</p>}
      </section>
      <section aria-labelledby="history-heading" className="space-y-3">
        <h2 id="history-heading" className="text-lg font-semibold">Последние Admin requests</h2>
        <p className="text-sm text-muted-foreground">{scopeId ? "Запросы выбранного матча среди 20 последних Admin requests. Глобальный незавершённый execution также блокирует новый запуск." : "До 20 последних запросов всех Football администраторов."} Обновление и выбор запроса не создают execution.</p>
        {visibleHistory.length === 0 ? <p className="text-sm">{ready ? "История запросов пуста." : "История запросов не получена."}</p> : (
          <ul className="space-y-2">{visibleHistory.map((request) => <li key={request.id} className="rounded-lg border p-3 text-sm">
            <p>{synchronizationJob(request.jobType)?.label} · {SYNCHRONIZATION_STATUSES[request.execution.status]}</p>
            <p>{synchronizationScope(request.jobType, request.matchId)}</p>
            <p className="break-all">Execution ID: <code>{request.execution.id}</code></p>
            <Button type="button" variant="link" className="h-auto max-w-full whitespace-normal break-all text-left" disabled={busy !== null} onClick={() => { setSelected(request); setAdmission(null); }}>Подробнее о запросе {request.id}</Button>
          </li>)}</ul>
        )}
      </section>
    </div>
  );
}

function inMatchScope(request: { jobType: string; matchId?: string | null }, matchId: string | undefined): boolean {
  return !matchId || request.matchId === matchId && synchronizationJob(request.jobType)?.matchScoped === true;
}

function matchesIntent(request: SynchronizationRequest, intent: SynchronizationIntent, actorId: string): boolean {
  return request.actorAccountId === actorId && request.requestKey === intent.command.requestKey &&
    request.jobType === intent.command.jobType && request.matchId === (intent.command.matchId ?? null);
}

function ExecutionDetails({ request }: { request: SynchronizationRequest }) {
  const e = request.execution;
  return <div className="space-y-2 rounded-lg border p-4 text-sm">
    <p>{synchronizationJob(request.jobType)?.label}: {synchronizationScope(request.jobType, request.matchId)}</p>
    <dl className="space-y-1">
      <div><dt className="inline font-medium">Request ID: </dt><dd className="inline break-all"><code>{request.id}</code></dd></div>
      <div><dt className="inline font-medium">Execution ID: </dt><dd className="inline break-all"><code>{e.id}</code></dd></div>
      <div><dt className="inline font-medium">Сохранённый статус: </dt><dd className="inline">{SYNCHRONIZATION_STATUSES[e.status]} ({e.status})</dd></div>
      <div><dt className="inline font-medium">Попытки: </dt><dd className="inline">{e.attemptCount} / {e.maxAttempts}</dd></div>
      <div><dt className="inline font-medium">Запрос создан: </dt><dd className="inline">{synchronizationTime(request.createdAt)}</dd></div>
      <div><dt className="inline font-medium">Начало выполнения: </dt><dd className="inline">{synchronizationTime(e.startedAt)}</dd></div>
      <div><dt className="inline font-medium">Завершение: </dt><dd className="inline">{synchronizationTime(e.finishedAt)}</dd></div>
      <div><dt className="inline font-medium">Execution обновлён: </dt><dd className="inline">{synchronizationTime(e.updatedAt)}</dd></div>
      <div><dt className="inline font-medium">Код последней ошибки: </dt><dd className="inline"><code>{e.lastErrorCode ?? "—"}</code></dd></div>
    </dl>
    {e.status === "pending" && <>
      <p>{e.attemptCount > 0 ? "Повторная попытка доступна с" : "Доступен для consumer с"}: {synchronizationTime(e.availableAt)}.</p>
      <p>Запрос ожидает выполнения. Если Admin consumer не активен, он останется pending. Фактический запуск и его срок не подтверждены.</p>
    </>}
    {e.status === "succeeded" && <p>Job сообщил об успешном завершении. Полноту сохранённых datasets проверяйте отдельно в Обзоре.</p>}
    {e.status === "failed" && <p>Execution завершён с ошибкой. Обновление статуса не запускает его повторно.</p>}
    <p className="text-muted-foreground">Счётчики обработанных данных не сохранены в этом API. Подробные результаты остаются в operational logs.</p>
  </div>;
}
