"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import {
  LOCALIZATION_KINDS, LOCALIZATION_NAME_LIMIT, normalizeLocalizationName,
  type FootballLocalizationEntity, type FootballLocalizationPage, type FootballLocalizationQuery,
} from "@/src/football/localization-management";
import {
  LOCALIZATION_KIND_LABELS, LocalizationApiError, loadLocalizationEntity, loadLocalizationPage, localizationStatus,
} from "@/src/admin/football-localization-client";

const initialFilter: FootballLocalizationQuery = { kind: "clubs", query: "", status: "all", page: 1 };
const failure = (error: unknown) => error instanceof LocalizationApiError ? error : new LocalizationApiError("NETWORK_ERROR");

export function FootballLocalization({ filter = initialFilter, initialId }: { filter?: FootballLocalizationQuery; initialId?: string }) {
  const [form, setForm] = useState(filter);
  const [applied, setApplied] = useState(filter);
  const [page, setPage] = useState<FootballLocalizationPage | null>(null);
  const [selected, setSelected] = useState<FootballLocalizationEntity | null>(null);
  const [name, setName] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [busy, setBusy] = useState(true);
  const [listError, setListError] = useState<LocalizationApiError | null>(null);
  const [editError, setEditError] = useState<LocalizationApiError | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const operation = useRef(true);

  useEffect(() => {
    let alive = true;
    loadLocalizationPage(filter).then(async (data) => {
      if (alive) setPage(data);
      if (initialId) {
        const entity = await loadLocalizationEntity({ kind: filter.kind, id: initialId });
        if (alive) { setSelected(entity); setName(entity.nameRu ?? ""); }
      }
    })
      .catch((error: unknown) => { if (alive) setListError(failure(error)); })
      .finally(() => { if (alive) { operation.current = false; setBusy(false); } });
    return () => { alive = false; };
  }, [filter, initialId]);

  function choose(entity: FootballLocalizationEntity) {
    setSelected(entity); setName(entity.nameRu ?? ""); setConfirmed(false); setBlocked(false); setEditError(null);
  }
  async function search(filter: FootballLocalizationQuery) {
    if (operation.current) return;
    operation.current = true; setBusy(true); setListError(null); setNotice(null);
    try {
      const data = await loadLocalizationPage(filter);
      setPage(data); setApplied(filter); setSelected(null); setConfirmed(false); setEditError(null);
    } catch (error) { setListError(failure(error)); }
    finally { operation.current = false; setBusy(false); }
  }
  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); void search({ ...form, query: form.query.trim(), page: 1 });
  }
  async function reloadEntity() {
    if (operation.current || !selected) return;
    operation.current = true; setBusy(true); setEditError(null); setNotice(null);
    try { choose(await loadLocalizationEntity(selected)); }
    catch (error) { setEditError(failure(error)); setBlocked(true); }
    finally { operation.current = false; setBusy(false); }
  }

  let validName = false;
  try { normalizeLocalizationName(name); validName = true; } catch { /* Show validation alongside the field. */ }
  const dirty = selected !== null && name.trim() !== (selected.nameRu ?? "");
  const canReview = selected?.nameRuReviewStatus === "unreviewed" && validName && !dirty;
  const filterChanged = form.kind !== applied.kind || form.query.trim() !== applied.query || form.status !== applied.status;

  async function edit(action: "save" | "review") {
    if (operation.current || !selected || blocked || !validName ||
        (action === "save" ? !dirty : !canReview || !confirmed)) return;
    operation.current = true; setBusy(true); setEditError(null); setNotice(null); setConfirmed(false);
    try {
      const entity = await loadLocalizationEntity(selected, {
        action, nameRu: action === "review" ? selected.nameRu : normalizeLocalizationName(name),
        expectedRevision: selected.localizationRevision, ...(action === "review" ? { confirmed: true } : {}),
      });
      choose(entity);
      setNotice(action === "review" ? "Русское название подтверждено (reviewed)." : "Название сохранено как неподтверждённое (unreviewed). Публичное отображение использует provider/original name.");
      try { setPage(await loadLocalizationPage(applied)); setListError(null); }
      catch (error) { setListError(failure(error)); }
    } catch (error) {
      const problem = failure(error);
      setEditError(problem);
      if (!["VALIDATION_ERROR", "CONFIRMATION_REQUIRED"].includes(problem.code)) setBlocked(true);
    } finally { operation.current = false; setBusy(false); }
  }

  return <div className="space-y-6">
    <p className="max-w-3xl text-sm text-muted-foreground">
      Названия общие для Football entities, независимо от сезона. Только reviewed используется как canonical Russian name.
      Отсутствующее или неподтверждённое название отображается публично в provider/original форме.
    </p>
    <form onSubmit={submitSearch} className="flex flex-wrap items-end gap-3 rounded-lg border p-4">
      <label className="space-y-1 text-sm"><span className="block font-medium">Тип entity</span>
        <select value={form.kind} disabled={busy} className="rounded-lg border bg-background p-2"
          onChange={(event) => setForm({ ...form, kind: event.target.value as FootballLocalizationQuery["kind"] })}>
          {LOCALIZATION_KINDS.map((kind) => <option key={kind} value={kind}>{LOCALIZATION_KIND_LABELS[kind]}</option>)}
        </select>
      </label>
      <label className="min-w-0 flex-1 space-y-1 text-sm"><span className="block font-medium">Поиск по original или русскому названию</span>
        <input type="search" value={form.query} maxLength={100} disabled={busy} className="w-full rounded-lg border bg-background p-2"
          onChange={(event) => setForm({ ...form, query: event.target.value })} />
      </label>
      <label className="space-y-1 text-sm"><span className="block font-medium">Статус перевода</span>
        <select value={form.status} disabled={busy} className="rounded-lg border bg-background p-2"
          onChange={(event) => setForm({ ...form, status: event.target.value as FootballLocalizationQuery["status"] })}>
          <option value="all">Все</option><option value="missing">Отсутствует</option>
          <option value="unreviewed">Не подтверждено</option><option value="reviewed">Подтверждено</option>
        </select>
      </label>
      <Button type="submit" disabled={busy}>Найти</Button>
    </form>
    {busy && <p role="status" className="text-sm">Обработка запроса…</p>}
    {listError && <ErrorNotice error={listError} suffix={page ? "Показан предыдущий успешно полученный список." : undefined} />}
    {notice && <p role="status" className="rounded-lg border p-3 text-sm">{notice}</p>}
    <section aria-labelledby="localization-list-heading" className="space-y-3">
      <h2 id="localization-list-heading" className="text-lg font-semibold">{LOCALIZATION_KIND_LABELS[applied.kind]}</h2>
      {page && <p className="text-sm">Найдено: {page.total}. Страница {page.page} из {Math.max(1, page.totalPages)}; до {page.pageSize} записей на странице.</p>}
      {page?.items.length === 0 && <p className="text-sm">По заданным условиям ничего не найдено.</p>}
      <ul className="grid gap-3 lg:grid-cols-2">{page?.items.map((entity) => <li key={entity.id} className="min-w-0 space-y-2 rounded-lg border p-4 text-sm">
        <p className="break-words font-medium">{entity.providerName ?? entity.displayName}</p>
        <p>name_ru: <span>{entity.nameRu ?? "—"}</span></p>
        <p>name_ru_review_status: <code>{entity.nameRuReviewStatus ?? "null"}</code> · {localizationStatus(entity)}</p>
        <p className="break-words">Публичное название: {entity.displayName}</p>
        <Button type="button" variant="outline" className="h-auto max-w-full whitespace-normal text-left" disabled={busy}
          onClick={() => { choose(entity); setNotice(null); }}>Редактировать {entity.providerName ?? entity.displayName}</Button>
      </li>)}</ul>
      {page && <div className="flex flex-wrap gap-3">
        <Button type="button" variant="outline" disabled={busy || filterChanged || page.page <= 1} onClick={() => void search({ ...applied, page: page.page - 1 })}>Предыдущая страница</Button>
        <Button type="button" variant="outline" disabled={busy || filterChanged || page.page >= page.totalPages} onClick={() => void search({ ...applied, page: page.page + 1 })}>Следующая страница</Button>
        {page.items.length === 0 && page.page > 1 && <Button type="button" variant="link" disabled={busy} onClick={() => void search({ ...applied, page: 1 })}>К началу списка</Button>}
      </div>}
    </section>
    {selected && <section aria-labelledby="localization-editor-heading" className="min-w-0 space-y-4 rounded-lg border p-4">
      <h2 id="localization-editor-heading" className="text-lg font-semibold">Русское название: {selected.providerName ?? selected.displayName}</h2>
      <dl className="space-y-1 text-sm">
        <div><dt className="inline font-medium">Provider/original name: </dt><dd className="inline break-words">{selected.providerName ?? "Профиль Coaches API ещё не получен"}</dd></div>
        <div><dt className="inline font-medium">Provider: </dt><dd className="inline">{selected.provider}</dd></div>
        <div><dt className="inline font-medium">Entity ID: </dt><dd className="inline break-all"><code>{selected.id}</code></dd></div>
        {selected.slug !== null && <div><dt className="inline font-medium">Slug: </dt><dd className="inline break-all"><code>{selected.slug}</code></dd></div>}
        <div><dt className="inline font-medium">Сохранённый статус: </dt><dd className="inline">{localizationStatus(selected)} ({selected.nameRuReviewStatus ?? "null"})</dd></div>
        <div><dt className="inline font-medium">Публичное название: </dt><dd className="inline">{selected.displayName}</dd></div>
      </dl>
      <label className="block space-y-1 text-sm"><span className="block font-medium">Русское название (name_ru)</span>
        <input value={name} disabled={busy} maxLength={LOCALIZATION_NAME_LIMIT} className="w-full max-w-xl rounded-lg border bg-background p-2"
          aria-invalid={name.length > 0 && !validName} aria-describedby="localization-name-help"
          onChange={(event) => { setName(event.target.value); setConfirmed(false); }} />
      </label>
      <p id="localization-name-help" className="text-sm text-muted-foreground">От 1 до {LOCALIZATION_NAME_LIMIT} символов; пустое имя и управляющие символы недопустимы. Пробелы по краям удаляются.</p>
      {selected.nameRuReviewStatus === "reviewed" && dirty && <p className="text-sm">Исправление будет сохранено как unreviewed. До повторного подтверждения публично используется provider/original name.</p>}
      {editError && <ErrorNotice error={editError} />}
      {blocked && <p className="text-sm">Для продолжения загрузите актуальную версию. Текущий черновик формы будет заменён; автоматического объединения или повтора изменений нет.</p>}
      <div className="flex flex-wrap gap-3">
        <Button type="button" disabled={busy || blocked || !validName || !dirty} onClick={() => void edit("save")}>Сохранить как unreviewed</Button>
        <Button type="button" variant="outline" disabled={busy} onClick={() => void reloadEntity()}>Загрузить актуальную версию</Button>
      </div>
      <div className="space-y-3 border-t pt-4">
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" checked={confirmed} disabled={busy || blocked || !canReview} onChange={(event) => setConfirmed(event.target.checked)} />
          <span>Подтверждаю сохранённое русское название: «{selected.nameRu ?? "—"}»</span>
        </label>
        <Button type="button" disabled={busy || blocked || !canReview || !confirmed} onClick={() => void edit("review")}>Подтвердить как reviewed</Button>
        {dirty && <p className="text-sm text-muted-foreground">Сначала сохраните исправленное название как unreviewed, затем подтвердите его отдельно.</p>}
      </div>
    </section>}
  </div>;
}

function ErrorNotice({ error, suffix }: { error: LocalizationApiError; suffix?: string }) {
  return <div role="alert" className="space-y-1 rounded-lg border p-3 text-sm">
    <p>{error.message} {suffix}</p><p>Код: <code>{error.code}</code>{error.requestId && <> · Request ID: <code>{error.requestId}</code></>}</p>
  </div>;
}
