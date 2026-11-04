import type { FootballTag } from "../taxonomy/football-tags";
import type { ArticleImageDTO } from "./contract";
import type { ArticleDocument } from "./document";

export const PUBLIC_ARTICLES_PAGE_SIZE = 20;
export type PublicArticleSitemapEntry = { slug: string; updatedAt: string };
export type PublicArticleAuthor = {
  nickname: string;
  avatarUrl: string | null;
  socialLinks: { label: string; url: string }[];
};
export type PublicArticleSummary = {
  id: string;
  slug: string;
  h1: string;
  firstPublishedAt: string;
  updatedAt: string;
  author: PublicArticleAuthor;
  cover: (ArticleImageDTO & { alt: string }) | null;
};
export type PublicArticleDetail = PublicArticleSummary & {
  formatVersion: 1;
  content: ArticleDocument;
  seoTitle: string;
  metaDescription: string;
  categories: { id: string; name: string }[];
  tags: FootballTag[];
  images: ArticleImageDTO[];
};
export type PublicArticlePage = {
  items: PublicArticleSummary[];
  page: number;
  total: number;
  totalPages: number;
};

export function parsePublicArticlePage(params: URLSearchParams): number | null {
  const values = params.getAll("page");
  if (values.length > 1) return null;
  const value = values[0] ?? "1";
  return /^[1-9][0-9]{0,5}$/.test(value) ? Number(value) : null;
}

export function publicArticleListPath(page: number): `/articles${string}` {
  return page === 1 ? "/articles" : `/articles?page=${page}`;
}
