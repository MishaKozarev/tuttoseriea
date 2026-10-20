import {
  LOCALIZATION_PAGE_SIZE, type FootballLocalizationEntity, type FootballLocalizationPage, type FootballLocalizationQuery,
} from "../football/localization-management";

export const LOCALIZATION_KIND_LABELS = { competitions: "Соревнования", clubs: "Клубы", players: "Игроки", coaches: "Тренеры" } as const;
export function localizationStatus(entity: FootballLocalizationEntity): string {
  return entity.nameRu === null ? "Отсутствует" : entity.nameRuReviewStatus === "reviewed" ? "Подтверждено" : "Не подтверждено";
}
const messages: Record<string, string> = {
  UNAUTHORIZED: "Сессия истекла. Войдите снова и обновите страницу.",
  FORBIDDEN: "Сервер отклонил доступ. Проверьте права, сессию и источник запроса.",
  VALIDATION_ERROR: "Проверьте название, параметры поиска и номер страницы.",
  CONFIRMATION_REQUIRED: "Явно подтвердите сохранённое русское название.",
  NOT_FOUND: "Football entity не найдена. Обновите список.",
  LOCALIZATION_CONFLICT: "Локализация изменилась. Загрузите актуальную версию и проверьте её перед новым сохранением или подтверждением.",
  NETWORK_ERROR: "Не удалось получить ответ сервера. Обновите данные; изменения автоматически не повторяются.",
  INVALID_RESPONSE: "Сервер вернул неожиданный ответ. Обновите данные перед продолжением.",
  INTERNAL_SERVER_ERROR: "Не удалось обработать запрос. Обновите данные перед продолжением.",
};
export class LocalizationApiError extends Error {
  constructor(readonly code: string, readonly requestId: string | null = null) { super(messages[code] ?? "Не удалось выполнить запрос. Проверьте код ошибки."); }
}
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
function parseEntity(value: unknown): FootballLocalizationEntity {
  if (!object(value) || !Object.hasOwn(LOCALIZATION_KIND_LABELS, String(value.kind)) ||
      ![value.id, value.provider, value.providerName, value.displayName].every((v) => typeof v === "string") ||
      (value.kind === "coaches" ? value.slug !== null : typeof value.slug !== "string") ||
      !(value.nameRu === null || typeof value.nameRu === "string") ||
      ![null, "reviewed", "unreviewed"].includes(value.nameRuReviewStatus as string | null) ||
      !Number.isInteger(value.localizationRevision) || Number(value.localizationRevision) < 0) throw new LocalizationApiError("INVALID_RESPONSE");
  return value as FootballLocalizationEntity;
}
async function request(path: string, edit?: unknown): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(`/api/admin/football/localization${path}`, {
      method: edit ? "PATCH" : "GET", credentials: "same-origin", cache: "no-store", mode: "same-origin", redirect: "error",
      signal: AbortSignal.timeout(15_000), ...(edit ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(edit) } : {}),
    });
  } catch { throw new LocalizationApiError("NETWORK_ERROR"); }
  let body: unknown;
  try { body = await response.json(); } catch { throw new LocalizationApiError("INVALID_RESPONSE"); }
  if (!response.ok) {
    if (object(body) && object(body.error) && typeof body.error.code === "string") {
      throw new LocalizationApiError(body.error.code, typeof body.error.requestId === "string" ? body.error.requestId : null);
    }
    throw new LocalizationApiError("INVALID_RESPONSE");
  }
  return body;
}
export async function loadLocalizationPage(filter: FootballLocalizationQuery): Promise<FootballLocalizationPage> {
  const data = await request(`?${new URLSearchParams({ kind: filter.kind, query: filter.query, status: filter.status, page: String(filter.page) })}`);
  if (!object(data) || !Array.isArray(data.items) || data.items.length > LOCALIZATION_PAGE_SIZE ||
      data.page !== filter.page || data.pageSize !== LOCALIZATION_PAGE_SIZE || !Number.isInteger(data.total) || Number(data.total) < 0 ||
      data.totalPages !== Math.ceil(Number(data.total) / LOCALIZATION_PAGE_SIZE)) throw new LocalizationApiError("INVALID_RESPONSE");
  const items = data.items.map(parseEntity);
  if (items.some((entity) => entity.kind !== filter.kind)) throw new LocalizationApiError("INVALID_RESPONSE");
  return { items, total: Number(data.total), page: Number(data.page), pageSize: LOCALIZATION_PAGE_SIZE, totalPages: Number(data.totalPages) };
}
export async function loadLocalizationEntity(entity: Pick<FootballLocalizationEntity, "kind" | "id">, edit?: unknown): Promise<FootballLocalizationEntity> {
  const body = await request(`/${entity.kind}/${encodeURIComponent(entity.id)}`, edit);
  if (!object(body)) throw new LocalizationApiError("INVALID_RESPONSE");
  const result = parseEntity(body.entity);
  if (result.id !== entity.id || result.kind !== entity.kind) throw new LocalizationApiError("INVALID_RESPONSE");
  return result;
}
