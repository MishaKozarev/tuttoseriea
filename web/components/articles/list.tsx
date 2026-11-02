import Link from "next/link";

import type { ArticleListDTO } from "@/src/articles/contract";

export function ArticlesList({ data, scope, manageAll }: { data: ArticleListDTO; scope: "own" | "all"; manageAll: boolean }) {
  const pageHref = (page: number) => `/admin/articles?${new URLSearchParams({ page: String(page), scope })}`;
  return <div className="space-y-5">
    {manageAll && <nav aria-label="Список черновиков" className="flex flex-wrap gap-3 text-sm">
      <Link href="/admin/articles?scope=own" aria-current={scope === "own" ? "page" : undefined} className="rounded border px-3 py-2 aria-[current=page]:bg-muted">Мои черновики</Link>
      <Link href="/admin/articles?scope=all" aria-current={scope === "all" ? "page" : undefined} className="rounded border px-3 py-2 aria-[current=page]:bg-muted">Все черновики</Link>
    </nav>}
    <p className="text-sm text-muted-foreground">Черновиков: {data.total}. Страница {data.page} из {Math.max(1, data.totalPages)}.</p>
    {data.items.length ? <ul className="divide-y rounded border">{data.items.map(draft => <li key={draft.id} className="space-y-2 p-4">
      <Link href={`/admin/articles/${draft.id}`} className="break-words text-lg font-medium underline underline-offset-4">{draft.h1 || "Без заголовка"}</Link>
      <p className="text-sm text-muted-foreground">Автор: {draft.authorName || "Автор"}. Ревизия {draft.revision}.</p>
      <p className="text-sm text-muted-foreground">Изменён: <time dateTime={draft.updatedAt}>{new Date(draft.updatedAt).toLocaleString("ru-RU", { timeZone: "UTC" })} UTC</time></p>
    </li>)}</ul> : <p className="rounded border p-5">Черновиков пока нет.</p>}
    <nav aria-label="Страницы черновиков" className="flex flex-wrap gap-4 text-sm underline">
      {data.page > 1 && <Link href={pageHref(data.page - 1)}>Предыдущая страница</Link>}
      {data.page < data.totalPages && <Link href={pageHref(data.page + 1)}>Следующая страница</Link>}
    </nav>
  </div>;
}
