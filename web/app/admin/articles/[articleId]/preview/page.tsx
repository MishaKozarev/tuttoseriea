import Link from "next/link";
import { forbidden, notFound, redirect } from "next/navigation";

import { AdminShell } from "@/components/layout/admin-shell";
import { Container } from "@/components/layout/container";
import { ArticleContent } from "@/components/articles/article-content";
import { getArticlesAccess } from "@/src/articles/access";
import { getArticleDraft } from "@/src/articles/service";
import { ArticleError, type ArticleDraftDTO } from "@/src/articles/contract";
import { parseArticleDocument } from "@/src/articles/document";
import { ApplicationError } from "@/src/api/errors";
import { logger } from "@/src/logging/logger";

export default async function ArticlePreviewPage({ params }: { params: Promise<{ articleId: string }> }) {
  const { articleId } = await params;
  const access = await getArticlesAccess(`/admin/articles/${articleId}/preview`);
  if (access.type === "redirect") redirect(access.location);
  if (access.type === "forbidden") forbidden();
  let draft: ArticleDraftDTO | null = null;
  try {
    const loaded = await getArticleDraft(articleId);
    draft = { ...loaded, content: parseArticleDocument(loaded.content) };
  } catch (error) {
    if (error instanceof ArticleError || error instanceof ApplicationError) {
      if (error.status === 404 || error.status === 400) notFound();
      if (error.status === 403) forbidden();
    }
    logger.error("Article preview page read failed", { context: { event: "article.preview_read_failed" } });
  }
  return <AdminShell><section className="py-10"><Container size="wide" className="space-y-6">
    <Link href={`/admin/articles/${articleId}`} className="inline-block underline">Вернуться к редактору</Link>
    {draft ? <>
      <p role="status" className="text-sm text-muted-foreground">Предпросмотр сохранённого черновика · Ревизия {draft.revision}</p>
      <article className="mx-auto max-w-3xl space-y-6"><header className="space-y-3"><h1 className="break-words text-3xl font-semibold">{draft.h1 || "Без заголовка"}</h1><p className="text-sm text-muted-foreground">{draft.authorName || "Автор"}</p></header>
        <ArticleContent content={draft.content} images={draft.images} />
      </article>
    </> : <p role="alert">Не удалось загрузить предпросмотр. Обновите страницу.</p>}
  </Container></section></AdminShell>;
}
