export class ArticleRequestError extends Error {
  constructor(readonly code: string, readonly requestId?: string, readonly status?: number) {
    super(code);
  }
}

export async function articleRequest<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try { response = await fetch(path, { ...init, cache: "no-store" }); }
  catch { throw new ArticleRequestError("UNKNOWN_OUTCOME"); }
  let body: unknown;
  try { body = await response.json(); }
  catch { throw new ArticleRequestError("UNKNOWN_OUTCOME"); }
  if (!response.ok) {
    const error = (body as { error?: { code?: string; requestId?: string } })?.error;
    throw new ArticleRequestError(error?.code ?? "UNKNOWN_OUTCOME", error?.requestId, response.status);
  }
  return body as T;
}

export function needsArticleRefresh(error: unknown): boolean {
  if (error instanceof ArticleRequestError && error.code === "ARTICLE_SLUG_CONFLICT") return false;
  return !(error instanceof ArticleRequestError) || error.code === "UNKNOWN_OUTCOME" ||
    error.code.includes("CONFLICT") || (error.status ?? 0) >= 500 || error.code === "ARTICLE_NOT_FOUND";
}

export function articleErrorMessage(error: unknown): string {
  if (!(error instanceof ArticleRequestError)) return "Результат операции не подтверждён. Загрузите текущую версию перед следующим изменением. Ваши правки сохранены в форме.";
  const messages: Record<string, string> = {
    UNAUTHORIZED: "Войдите заново и завершите подтверждение MFA, если оно требуется.",
    FORBIDDEN: "Недостаточно прав для этой операции.",
    VALIDATION_ERROR: "Проверьте поля, ссылки и структуру текста.",
    BAD_REQUEST: "Проверьте формат и размер запроса.",
    ARTICLE_NOT_FOUND: "Черновик не найден или недоступен.",
    ARTICLE_TOO_LARGE: "Текст слишком большой или содержит слишком сложную структуру.",
    ARTICLE_SLUG_INVALID: "Slug: строчные латинские буквы, цифры и дефисы между словами.",
    ARTICLE_SLUG_CONFLICT: "Этот slug уже используется другой статьёй. Выберите другой slug.",
    ARTICLE_FORMAT_UNSUPPORTED: "Формат текста не поддерживается. Сохраните свои правки перед обновлением страницы.",
    ARTICLE_IMAGE_LIMIT: "К черновику уже прикреплено максимальное число изображений.",
    MEDIA_TOO_LARGE: "Изображение превышает допустимый размер 5 MiB.",
    MEDIA_INVALID_IMAGE: "Выберите статичное изображение JPEG, PNG или WebP допустимого размера.",
    MEDIA_BUSY: "Обработка изображений занята. Повторите загрузку позже.",
    MEDIA_STORAGE_UNAVAILABLE: "Хранилище изображений временно недоступно.",
    UNKNOWN_OUTCOME: "Результат операции не подтверждён. Загрузите текущую версию перед следующим изменением.",
  };
  const description = error.code.includes("CONFLICT") && error.code !== "ARTICLE_SLUG_CONFLICT"
    ? "Черновик изменился. Загрузите текущую версию и выберите, какие правки продолжить."
    : messages[error.code] ?? "Операция отклонена. Проверьте данные и загрузите текущее состояние.";
  return `${description} Код: ${error.code}. Запрос: ${error.requestId ?? "—"}.`;
}
