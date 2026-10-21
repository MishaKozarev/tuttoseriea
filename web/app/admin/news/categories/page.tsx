import { CategoriesPage, type CategorySearchParams } from "@/components/admin/categories-page";
export default function NewsCategoriesPage({ searchParams }: { searchParams: CategorySearchParams }) {
  return <CategoriesPage kind="news" searchParams={searchParams} />;
}
