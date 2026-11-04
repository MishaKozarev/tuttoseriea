import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";

import { Container } from "@/components/layout/container";
import { PublicArticlesList } from "@/components/articles/public-list";
import { getDbPool } from "@/src/db";
import { listPublicArticles } from "@/src/articles/public-repository";
import { parsePublicArticlePage } from "@/src/articles/public-contract";
import { buildArticlesMetadata } from "@/src/seo/site";

export const dynamic = "force-dynamic";
type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };
const readPage = cache((page: number) => listPublicArticles(getDbPool(), page));

async function requirePage(searchParams: Props["searchParams"]) {
  const values = await searchParams;
  const params = new URLSearchParams();
  const value = values.page;
  if (Array.isArray(value)) value.forEach(item => params.append("page", item));
  else if (value !== undefined) params.set("page", value);
  const page = parsePublicArticlePage(params);
  if (page === null) notFound();
  const data = await readPage(page);
  if (page > 1 && page > data.totalPages) notFound();
  return data;
}

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const data = await requirePage(searchParams);
  return buildArticlesMetadata(data.page);
}

export default async function ArticlesPage({ searchParams }: Props) {
  const data = await requirePage(searchParams);
  return <section className="py-8 sm:py-12"><Container size="wide" className="space-y-8">
    <h1 className="text-3xl font-semibold">Статьи</h1>
    <PublicArticlesList data={data} />
  </Container></section>;
}
