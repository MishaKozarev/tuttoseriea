"use client";

import { useRef, useState } from "react";
import type { CategoryPage } from "@/src/categories/management";
import type { FootballTag, TagPage, TagQuery } from "@/src/taxonomy/football-tags";
import { articleErrorMessage, articleRequest } from "./client";

const kindNames: Record<string, string> = { clubs: "Клубы", players: "Игроки", coaches: "Тренеры", competitions: "Турниры" };
const inputClass = "mt-1 block w-full rounded border bg-background p-2";
const buttonClass = "rounded border px-3 py-2 text-sm disabled:opacity-50";
type CategoryChoice = { id: string; name: string };

export function ArticleCategoryPicker({ selected, disabled, onChange }: { selected: CategoryChoice[]; disabled: boolean; onChange: (value: CategoryChoice[]) => void }) {
  const [query, setQuery] = useState("");
  const [applied, setApplied] = useState("");
  const [data, setData] = useState<CategoryPage | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const inFlight = useRef(false);
  async function search(page = 1, value = query) {
    if (inFlight.current || disabled) return;
    inFlight.current = true; setBusy(true); setError("");
    try {
      const result = await articleRequest<CategoryPage>(`/api/admin/articles/options/categories?${new URLSearchParams({ query: value, page: String(page) })}`);
      setData(result); setApplied(value);
    } catch (failure) { setError(articleErrorMessage(failure)); }
    finally { setBusy(false); inFlight.current = false; }
  }
  return <fieldset className="space-y-3 rounded border p-4" disabled={disabled}>
    <legend className="px-1 font-medium">Категории статьи</legend>
    <ul className="flex flex-wrap gap-2" aria-label="Выбранные категории">{selected.map(category => <li key={category.id} className="flex items-center gap-2 rounded bg-muted px-3 py-2 text-sm">
      {category.name}<button type="button" aria-label={`Убрать категорию ${category.name}`} onClick={() => onChange(selected.filter(item => item.id !== category.id))}>×</button>
    </li>)}</ul>
    <div className="flex flex-wrap items-end gap-3">
      <label className="min-w-0 flex-1">Поиск категорий<input value={query} maxLength={100} disabled={busy} onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); void search(); } }} className={inputClass} /></label>
      <button type="button" disabled={busy} onClick={() => void search()} className={buttonClass}>Найти категории</button>
    </div>
    {data && <div className="space-y-2">
      <p className="text-sm text-muted-foreground">Найдено категорий: {data.total}.</p>
      <ul className="space-y-1">{data.items.map(item => <li key={item.id}><label className="flex items-center gap-2 rounded p-2 hover:bg-muted">
        <input type="checkbox" checked={selected.some(value => value.id === item.id)} disabled={selected.length >= 20 && !selected.some(value => value.id === item.id)} onChange={event => onChange(event.target.checked ? [...selected, { id: item.id, name: item.name }] : selected.filter(value => value.id !== item.id))} />{item.name}
      </label></li>)}</ul>
      <div className="flex flex-wrap gap-2">
        {data.page > 1 && <button type="button" disabled={busy} className={buttonClass} onClick={() => void search(data.page - 1, applied)}>Предыдущие категории</button>}
        {data.page < data.totalPages && <button type="button" disabled={busy} className={buttonClass} onClick={() => void search(data.page + 1, applied)}>Следующие категории</button>}
      </div>
    </div>}
    {error && <p role="alert" className="break-words text-sm">{error}</p>}
  </fieldset>;
}

export function ArticleTagPicker({ selected, disabled, onChange }: { selected: FootballTag[]; disabled: boolean; onChange: (value: FootballTag[]) => void }) {
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<TagQuery["kind"]>("all");
  const [applied, setApplied] = useState({ query: "", kind: "all" as TagQuery["kind"] });
  const [data, setData] = useState<TagPage | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const inFlight = useRef(false);
  async function search(page = 1, filter = { query, kind }) {
    if (inFlight.current || disabled) return;
    inFlight.current = true; setBusy(true); setError("");
    try {
      const result = await articleRequest<TagPage>(`/api/admin/articles/options/tags?${new URLSearchParams({ ...filter, page: String(page) })}`);
      setData(result); setApplied(filter);
    } catch (failure) { setError(articleErrorMessage(failure)); }
    finally { setBusy(false); inFlight.current = false; }
  }
  return <fieldset className="space-y-3 rounded border p-4" disabled={disabled}>
    <legend className="px-1 font-medium">Football Tags</legend>
    <ul className="flex flex-wrap gap-2" aria-label="Выбранные теги">{selected.map(tag => <li key={tag.id} className="flex items-center gap-2 rounded bg-muted px-3 py-2 text-sm">
      {tag.displayName} · {kindNames[tag.kind]}<button type="button" aria-label={`Убрать тег ${tag.displayName}`} onClick={() => onChange(selected.filter(item => item.id !== tag.id))}>×</button>
    </li>)}</ul>
    <div className="flex flex-wrap items-end gap-3">
      <label className="min-w-0 flex-1">Поиск Football Tags<input value={query} maxLength={100} disabled={busy} onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); void search(); } }} className={inputClass} /></label>
      <label>Источник тегов<select value={kind} disabled={busy} onChange={event => setKind(event.target.value as TagQuery["kind"])} className={inputClass}>
        <option value="all">Все источники</option>{Object.entries(kindNames).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select></label>
      <button type="button" disabled={busy} onClick={() => void search()} className={buttonClass}>Найти теги</button>
    </div>
    {data && <div className="space-y-2">
      <p className="text-sm text-muted-foreground">Найдено тегов: {data.total}.</p>
      <ul className="space-y-1">{data.items.map(item => <li key={item.id}><label className="flex items-center gap-2 rounded p-2 hover:bg-muted">
        <input type="checkbox" checked={selected.some(value => value.id === item.id)} disabled={selected.length >= 50 && !selected.some(value => value.id === item.id)} onChange={event => onChange(event.target.checked ? [...selected, item] : selected.filter(value => value.id !== item.id))} />{item.displayName}<span className="text-sm text-muted-foreground">{kindNames[item.kind]}</span>
      </label></li>)}</ul>
      <div className="flex flex-wrap gap-2">
        {data.page > 1 && <button type="button" disabled={busy} className={buttonClass} onClick={() => void search(data.page - 1, applied)}>Предыдущие теги</button>}
        {data.page < data.totalPages && <button type="button" disabled={busy} className={buttonClass} onClick={() => void search(data.page + 1, applied)}>Следующие теги</button>}
      </div>
    </div>}
    {error && <p role="alert" className="break-words text-sm">{error}</p>}
  </fieldset>;
}
