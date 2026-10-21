import Link from "next/link";
export function CatalogNavigation() {
  return <nav aria-label="Справочники Admin" className="flex flex-wrap gap-4 text-sm underline underline-offset-4">
    <Link href="/admin/football">Football Admin</Link><Link href="/admin/football/tags">Football Tags</Link>
    <Link href="/admin/articles/categories">Категории статей</Link><Link href="/admin/news/categories">Категории новостей</Link>
  </nav>;
}
