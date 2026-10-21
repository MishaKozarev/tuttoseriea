import { CategoriesPage, type CategorySearchParams } from "@/components/admin/categories-page";
export default function ArticleCategoriesPage({ searchParams }: { searchParams: CategorySearchParams }) {
  return <CategoriesPage kind="article" searchParams={searchParams} />;
}
