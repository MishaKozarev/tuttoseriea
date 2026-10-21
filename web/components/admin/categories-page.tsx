import { forbidden, redirect } from "next/navigation";
import { AdminShell } from "@/components/layout/admin-shell";
import { Container } from "@/components/layout/container";
import { CatalogNavigation } from "./catalog-navigation";
import { Categories } from "./categories";
import { getCategoryAdminAccess } from "@/src/identity/category-admin-access";
import { getDbPool } from "@/src/db";
import { ArticleCategoryRepository, NewsCategoryRepository } from "@/src/categories/repository";
import { parseCategoryQuery, type CategoryKind, type CategoryPage, type CategoryQuery } from "@/src/categories/management";
import { logger } from "@/src/logging/logger";
export type CategorySearchParams = Promise<Record<string, string | string[] | undefined>>;
export async function CategoriesPage({ kind, searchParams }: { kind: CategoryKind; searchParams: CategorySearchParams }) {
  const access = await getCategoryAdminAccess(kind);
  if (access.type === "redirect") redirect(access.location);
  if (access.type === "forbidden") forbidden();
  let result: { data: CategoryPage; filter: CategoryQuery } | null = null;
  try {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(await searchParams)) {
      if (Array.isArray(value)) value.forEach(item => params.append(key, item)); else if (value !== undefined) params.set(key, value);
    }
    const filter = parseCategoryQuery(params), repository = kind === "article" ? new ArticleCategoryRepository(getDbPool()) : new NewsCategoryRepository(getDbPool());
    result = { filter, data: await repository.list(filter) };
  } catch (error) { logger.error("Category page read failed", { context: { kind, error } }); }
  return <AdminShell><section className="py-10"><Container size="wide" className="space-y-6">
    <h1 className="text-2xl font-semibold">{kind === "article" ? "Категории статей" : "Категории новостей"}</h1><CatalogNavigation />
    <p>Самостоятельный справочник. Используемые контентом категории удалять нельзя.</p>
    {result ? <Categories key={kind} kind={kind} initial={result.data} filter={result.filter} /> : <p role="alert">Не удалось прочитать категории или параметры поиска. Их состояние неизвестно.</p>}
  </Container></section></AdminShell>;
}
