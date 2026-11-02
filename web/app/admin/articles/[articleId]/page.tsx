import { forbidden, notFound, redirect } from "next/navigation";

import { AdminShell } from "@/components/layout/admin-shell";
import { Container } from "@/components/layout/container";
import { ArticleEditor } from "@/components/articles/editor";
import { getArticlesAccess } from "@/src/articles/access";
import { getArticleDraft } from "@/src/articles/service";
import { ArticleError, type ArticleDraftDTO } from "@/src/articles/contract";
import { ApplicationError } from "@/src/api/errors";
import { logger } from "@/src/logging/logger";

export default async function ArticleEditorPage({ params }: { params: Promise<{ articleId: string }> }) {
  const { articleId } = await params;
  const access = await getArticlesAccess(`/admin/articles/${articleId}`);
  if (access.type === "redirect") redirect(access.location);
  if (access.type === "forbidden") forbidden();
  let draft: ArticleDraftDTO | null = null;
  try { draft = await getArticleDraft(articleId); }
  catch (error) {
    if (error instanceof ArticleError || error instanceof ApplicationError) {
      if (error.status === 404 || error.status === 400) notFound();
      if (error.status === 403) forbidden();
    }
    logger.error("Article editor page read failed", { context: { event: "article.editor_read_failed" } });
  }
  return <AdminShell><section className="py-10"><Container size="wide" className="space-y-6">
    <h1 className="text-2xl font-semibold">Редактор статьи</h1>
    {draft ? <><p className="text-sm text-muted-foreground">Автор: {draft.authorName || "Автор"}.</p><ArticleEditor key={draft.id} initial={draft} /></> : <p role="alert">Не удалось загрузить черновик. Обновите страницу.</p>}
  </Container></section></AdminShell>;
}
