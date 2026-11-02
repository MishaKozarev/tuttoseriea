import Link from "next/link";
import { forbidden, redirect } from "next/navigation";

import { AdminShell } from "@/components/layout/admin-shell";
import { Container } from "@/components/layout/container";
import { ArticlesList } from "@/components/articles/list";
import { getArticlesAccess } from "@/src/articles/access";
import { listArticleDrafts } from "@/src/articles/service";
import { parseArticleListQuery, type ArticleListDTO, type ArticleListQuery } from "@/src/articles/contract";
import { logger } from "@/src/logging/logger";

export default async function ArticlesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const access = await getArticlesAccess();
  if (access.type === "redirect") redirect(access.location);
  if (access.type === "forbidden") forbidden();
  let data: ArticleListDTO | null = null;
  let query: ArticleListQuery | null = null;
  let scope: "own" | "all" = "own";
  try {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(await searchParams)) {
      if (Array.isArray(value)) value.forEach(item => params.append(key, item));
      else if (value !== undefined) params.set(key, value);
    }
    query = parseArticleListQuery(params);
  } catch { logger.error("Article list page query rejected", { context: { event: "article.list_query_failed" } }); }
  if (query) {
    scope = query.scope ?? (access.actor.manageAll ? "all" : "own");
    if (scope === "all" && !access.actor.manageAll) forbidden();
    try { data = await listArticleDrafts({ ...query, scope }); }
    catch { logger.error("Article draft list page read failed", { context: { event: "article.list_read_failed" } }); }
  }
  return <AdminShell><section className="py-10"><Container size="wide" className="space-y-6">
    <div className="flex flex-wrap items-center justify-between gap-4"><h1 className="text-2xl font-semibold">Черновики статей</h1><Link href="/admin/articles/new" className="rounded border px-4 py-2">Новая статья</Link></div>
    <Link href="/admin" className="inline-block underline">В кабинет</Link>
    {data ? <ArticlesList data={data} scope={scope} manageAll={access.actor.manageAll} /> : <p role="alert">Не удалось загрузить черновики или параметры списка. Обновите страницу.</p>}
  </Container></section></AdminShell>;
}
