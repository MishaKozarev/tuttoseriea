type ErrorEnvelope = { error?: { code?: string; requestId?: string } };

export class WriterRequestError extends Error {
  constructor(readonly code: string, readonly requestId?: string, readonly status?: number) { super(code); }
}

export async function writerRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { ...init, cache: "no-store" });
  let body: unknown;
  try { body = await response.json(); }
  catch { throw new WriterRequestError("UNKNOWN_OUTCOME"); }
  if (!response.ok) {
    const error = (body as ErrorEnvelope)?.error;
    throw new WriterRequestError(error?.code ?? "UNKNOWN_OUTCOME", error?.requestId, response.status);
  }
  return body as T;
}

export function writerErrorMessage(error: unknown): string {
  if (!(error instanceof WriterRequestError)) return "Результат операции не подтверждён. Обновите данные перед следующим изменением.";
  const messages: Record<string, string> = {
    UNAUTHORIZED: "Войдите заново и завершите подтверждение MFA, если оно требуется.",
    FORBIDDEN: "Недостаточно прав для этой операции.",
    VALIDATION_ERROR: "Проверьте введённые данные.",
    BAD_REQUEST: "Проверьте формат и размер запроса.",
    NOT_FOUND: "Учётная запись не найдена. Обновите данные.",
    WRITER_ALREADY_EXISTS: "Учётная запись уже существует. Найдите её по email и назначьте роль Writer.",
    WRITER_ACCOUNT_EXISTS: "Учётная запись уже существует. Найдите её по email и назначьте роль Writer.",
    WRITER_NOT_FOUND: "Учётная запись не найдена. Обновите данные.",
    ACCOUNT_ALREADY_EXISTS: "Учётная запись уже существует. Найдите её по email и назначьте роль Writer.",
    EMAIL_ALREADY_EXISTS: "Учётная запись уже существует. Найдите её по email и назначьте роль Writer.",
    MEDIA_TOO_LARGE: "Файл превышает допустимый размер 5 MiB.",
    MEDIA_INVALID_IMAGE: "Выберите статичное изображение JPEG, PNG или WebP допустимого размера.",
    UNKNOWN_OUTCOME: "Результат операции не подтверждён. Обновите данные перед следующим изменением.",
  };
  const description = error.code.includes("CONFLICT")
    ? "Данные изменились. Обновите их перед следующим изменением."
    : messages[error.code] ?? "Операция отклонена. Проверьте данные и обновите состояние.";
  return `${description} Код: ${error.code}. Запрос: ${error.requestId ?? "—"}.`;
}

export function requiresWriterRefresh(error: unknown): boolean {
  return !(error instanceof WriterRequestError) || (error.status ?? 0) >= 500 || error.code.includes("CONFLICT") || error.code === "UNKNOWN_OUTCOME" || error.code === "NOT_FOUND" || error.code === "WRITER_NOT_FOUND";
}
