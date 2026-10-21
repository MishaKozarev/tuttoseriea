"use client";
import { useRef, useState } from "react";
import { categoryPath, type Category, type CategoryKind, type CategoryPage, type CategoryQuery } from "@/src/categories/management";

export function Categories({ kind, initial, filter }: { kind: CategoryKind; initial: CategoryPage; filter: CategoryQuery }) {
  const [data, setData] = useState(initial), [selected, setSelected] = useState<Category | null>(null);
  const [name, setName] = useState(""), [confirmed, setConfirmed] = useState(false), [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  const inFlight = useRef(false);
  const [uncertain, setUncertain] = useState(false);
  const base = `/api${categoryPath(kind)}`;
  async function refresh() {
    const response = await fetch(`${base}?${new URLSearchParams({ query: filter.query, page: String(filter.page) })}`, { cache: "no-store" });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error?.code ?? "READ_FAILED");
    setData(body);
  }
  function choose(category: Category | null) { setSelected(category); setName(category?.name ?? ""); setConfirmed(false); setMessage(""); }
  async function mutate(remove = false) {
    if (inFlight.current || uncertain || remove && (!selected || !confirmed)) return;
    inFlight.current = true; setBusy(true); setMessage("");
    try {
      const response = await fetch(`${base}${selected ? `/${encodeURIComponent(selected.id)}` : ""}`, {
        method: remove ? "DELETE" : selected ? "PATCH" : "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify(remove ? { expectedRevision: selected!.revision, confirmed } : selected ? { name, expectedRevision: selected.revision } : { name }),
      });
      const body = await response.json();
      if (!response.ok) {
        const code = body.error?.code;
        if (code === "CATEGORY_CONFLICT" || code === "NOT_FOUND") setUncertain(true);
        const messages: Record<string, string> = { CATEGORY_NAME_CONFLICT: "Такое название уже существует.", CATEGORY_CONFLICT: "Категория изменена. Обновите список и выберите её заново.",
          CATEGORY_IN_USE: "Категория используется контентом; удаление запрещено.", VALIDATION_ERROR: "Введите непустое название длиной до 200 символов.",
          NOT_FOUND: "Категория больше не существует.", UNAUTHORIZED: "Необходимо войти и подтвердить MFA.", FORBIDDEN: "Недостаточно прав.", CONFIRMATION_REQUIRED: "Подтвердите удаление." };
        setMessage(`${messages[code] ?? "Операция отклонена."} Код: ${code ?? "UNKNOWN"}. Запрос: ${body.error?.requestId ?? "—"}`); return;
      }
      choose(null); await refresh(); setMessage(remove ? "Категория удалена." : "Категория сохранена.");
    } catch { setUncertain(true); setMessage("Результат операции не подтверждён. Обновите список перед следующим изменением."); }
    finally { inFlight.current = false; setBusy(false); }
  }
  return <div className="space-y-5">
    <form method="get" className="flex flex-wrap gap-3">
      <label>Поиск категорий<input name="query" type="search" maxLength={100} defaultValue={filter.query} className="ml-2 rounded border p-2" /></label>
      <button className="rounded border px-4">Найти</button>
    </form>
    <p>Найдено: {data.total}. Страница {data.page} из {Math.max(1, data.totalPages)}.</p>
    <button disabled={busy} className="rounded border px-3 py-2" onClick={async () => {
      setBusy(true); try { await refresh(); choose(null); setUncertain(false); } catch { setMessage("Не удалось обновить список."); } finally { setBusy(false); }
    }}>Обновить список</button>
    {!data.items.length && <p>Категории не найдены.</p>}
    <ul className="space-y-2">{data.items.map(category => <li key={category.id} className="flex flex-wrap items-center gap-3 rounded border p-3">
      <span className="flex-1 break-words">{category.name}</span><button disabled={busy} className="underline" onClick={() => choose(category)}>Редактировать {category.name}</button>
    </li>)}</ul>
    <nav aria-label="Страницы категорий" className="flex gap-4">
      {data.page > 1 && <a className="underline" href={`${categoryPath(kind)}?${new URLSearchParams({ query: filter.query, page: String(data.page - 1) })}`}>Назад</a>}
      {data.page < data.totalPages && <a className="underline" href={`${categoryPath(kind)}?${new URLSearchParams({ query: filter.query, page: String(data.page + 1) })}`}>Далее</a>}
    </nav>
    <form className="space-y-3 rounded border p-4" onSubmit={event => { event.preventDefault(); void mutate(); }}>
      <h2 className="text-lg font-semibold">{selected ? "Изменение категории" : "Новая категория"}</h2>
      <label className="block">Название категории<input required maxLength={200} value={name} disabled={busy} onChange={e => { setName(e.target.value); setConfirmed(false); }} className="mt-1 block w-full max-w-lg rounded border p-2" /></label>
      <button disabled={busy || uncertain || !name.trim()} className="rounded border px-3 py-2">{busy ? "Подождите…" : "Сохранить категорию"}</button>
      {selected && <>
        <button type="button" disabled={busy} className="ml-3 underline" onClick={() => choose(null)}>Отменить выбор</button>
        <label className="block"><input type="checkbox" checked={confirmed} disabled={busy} onChange={e => setConfirmed(e.target.checked)} /> Подтверждаю удаление категории «{selected.name}»</label>
        <button type="button" disabled={busy || uncertain || !confirmed} className="rounded border px-3 py-2" onClick={() => void mutate(true)}>Удалить категорию</button>
      </>}
    </form>
    {message && <p role="status">{message}</p>}
  </div>;
}
