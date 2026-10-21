import Link from "next/link";
import { forbidden, redirect } from "next/navigation";
import { AdminShell } from "@/components/layout/admin-shell";
import { Container } from "@/components/layout/container";
import { CatalogNavigation } from "@/components/admin/catalog-navigation";
import { FootballTagImage } from "@/components/admin/football-tag-image";
import { getFootballAdminAccess } from "@/src/identity/football-admin-access";
import { getDbPool } from "@/src/db";
import { parseTagQuery, type TagQuery, type TagPage } from "@/src/taxonomy/football-tags";
import { listFootballTags } from "@/src/taxonomy/football-tags-repository";
import { logger } from "@/src/logging/logger";

export default async function FootballTagsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const access = await getFootballAdminAccess("/admin/football/tags");
  if (access.type === "redirect") redirect(access.location);
  if (access.type === "forbidden") forbidden();
  let result: { filter: TagQuery; data: TagPage } | null = null;
  try {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(await searchParams)) {
      if (Array.isArray(value)) value.forEach(item => params.append(key, item)); else if (value !== undefined) params.set(key, value);
    }
    const filter = parseTagQuery(params); result = { filter, data: await listFootballTags(getDbPool(), filter) };
  } catch (error) { logger.error("Football Tags read failed", { context: { error } }); }
  const href = (page: number) => `/admin/football/tags?${new URLSearchParams({ query: result!.filter.query, kind: result!.filter.kind, page: String(page) })}`;
  return <AdminShell><section className="py-10"><Container size="wide" className="space-y-6">
    <h1 className="text-2xl font-semibold">Football Tags</h1><CatalogNavigation />
    <p>Автоматические ссылки на Football. Имена и изображения читаются из исходных записей. Редактирование тегов недоступно.</p>
    {!result ? <p role="alert">Не удалось прочитать теги или параметры поиска. Их состояние неизвестно.</p> : <>
      <form method="get" className="flex flex-wrap gap-3">
        <label>Поиск<input name="query" type="search" maxLength={100} defaultValue={result.filter.query} className="ml-2 rounded border p-2" /></label>
        <label>Источник<select name="kind" defaultValue={result.filter.kind} className="ml-2 rounded border p-2">
          <option value="all">Все</option><option value="clubs">Клубы</option><option value="players">Игроки</option>
          <option value="coaches">Тренеры</option><option value="competitions">Соревнования</option>
        </select></label><button className="rounded border px-4">Найти</button>
      </form>
      <p>Найдено: {result.data.total}. Страница {result.data.page} из {Math.max(1, result.data.totalPages)}.</p>
      {!result.data.items.length && <p>Теги не найдены. Для существующих Football данных первоначальное заполнение выполняется отдельно оператором.</p>}
      <ul className="grid gap-3 md:grid-cols-2">{result.data.items.map(tag => <li key={tag.id} className="flex gap-3 rounded border p-4 text-sm">
        <FootballTagImage url={tag.imageUrl} name={tag.displayName} /><div className="min-w-0 break-words">
          <p className="font-semibold">{tag.displayName}</p><p>Источник: {tag.kind} · {tag.provider} / {tag.providerId}</p>
          <p>Tag ID: {tag.id}</p><p>Football ID: {tag.sourceEntityId}</p>
          {!tag.profileAvailable && <p>Профиль Coaches API ещё не получен.</p>}
          <Link className="underline" href={`/admin/football/localization?${new URLSearchParams({ kind: tag.kind, id: tag.sourceEntityId })}`}>Открыть источник в Football Localization</Link>
        </div>
      </li>)}</ul>
      <nav aria-label="Страницы тегов" className="flex gap-4">
        {result.data.page > 1 && <Link className="underline" href={href(result.data.page - 1)}>Назад</Link>}
        {result.data.page < result.data.totalPages && <Link className="underline" href={href(result.data.page + 1)}>Далее</Link>}
      </nav>
    </>}
  </Container></section></AdminShell>;
}
