import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";

import { Container } from "@/components/layout/container";
import { ArticleContent } from "@/components/articles/article-content";
import { getDbPool } from "@/src/db";
import { getPublicArticleBySlug } from "@/src/articles/public-repository";
import { buildArticleMetadata } from "@/src/seo/site";

export const dynamic = "force-dynamic";
type Props = { params: Promise<{ slug: string }> };
const readArticle = cache((slug: string) => getPublicArticleBySlug(getDbPool(), slug));

async function requireArticle(slug: string) {
  const article = await readArticle(slug);
  if (!article) notFound();
  return article;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return buildArticleMetadata(await requireArticle((await params).slug));
}

export default async function ArticlePage({ params }: Props) {
  const article = await requireArticle((await params).slug);
  return <section className="py-8 sm:py-12"><Container size="normal" className="space-y-7">
    <Link href="/articles" className="text-sm underline underline-offset-4">Все статьи</Link>
    <article className="space-y-8">
      <header className="space-y-5">
        <h1 className="break-words text-3xl font-semibold leading-tight sm:text-4xl">{article.h1}</h1>
        <div className="flex items-center gap-3">
          {article.author.avatarUrl &&
            // eslint-disable-next-line @next/next/no-img-element
            <img src={article.author.avatarUrl} alt="" width={48} height={48} className="size-12 rounded-full object-cover" />}
          <div className="min-w-0 space-y-1"><p className="break-words font-medium">{article.author.nickname}</p>
            <time dateTime={article.firstPublishedAt} className="text-sm text-muted-foreground">{new Date(article.firstPublishedAt).toLocaleDateString("ru-RU", { timeZone: "UTC", day: "numeric", month: "long", year: "numeric" })}</time>
          </div>
        </div>
        {!!article.author.socialLinks.length && <ul aria-label="Ссылки автора" className="flex flex-wrap gap-3 text-sm">{article.author.socialLinks.map((link, index) => <li key={`${link.url}-${index}`} className="min-w-0 break-words"><a href={link.url} target="_blank" rel="noopener noreferrer nofollow" className="underline underline-offset-4">{link.label}</a></li>)}</ul>}
      </header>
      <ArticleContent content={article.content} images={article.images} visibility="public" />
      {(article.categories.length > 0 || article.tags.length > 0) && <footer className="space-y-3 border-t pt-5">
        {!!article.categories.length && <ul aria-label="Категории статьи" className="flex flex-wrap gap-2">{article.categories.map(category => <li key={category.id} className="max-w-full break-words rounded bg-muted px-3 py-1 text-sm">{category.name}</li>)}</ul>}
        {!!article.tags.length && <ul aria-label="Теги статьи" className="flex flex-wrap gap-2">{article.tags.map(tag => <li key={tag.id} className="max-w-full break-words rounded border px-3 py-1 text-sm">{tag.displayName}</li>)}</ul>}
      </footer>}
    </article>
  </Container></section>;
}
