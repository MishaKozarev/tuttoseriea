import Link from "next/link";
import { CoachPhoto } from "./coach-photo";
import { footballCoachesHref, type FootballCoachesQuery } from "@/src/admin/football-coaches";
import type { FootballCoachesModel } from "@/src/admin/football-coaches-repository";
import { localizationStatus } from "@/src/admin/football-localization-client";
import { FIXTURE_STATUS_LABELS_RU } from "@/src/football/localization";
import type { LastKnownTeamCoach } from "@/src/football/coaches";

const time = (value: string | Date | null) => value ? new Date(value).toISOString().replace("T", " ").replace(".000Z", " UTC") : "Дата неизвестна";
const linkClass = "text-sm font-medium underline underline-offset-4";
export function FootballCoaches({ data, filter }: { data: FootballCoachesModel; filter: FootballCoachesQuery }) {
  const { page, detail } = data;
  return <div className="space-y-6">
    <p className="text-sm text-muted-foreground">Сохранённые Coach identities из PostgreSQL. Разные provider IDs показаны отдельно, даже если имена похожи. Срез: {time(data.checkedAt)}.</p>
    <form method="get" action="/admin/football/coaches" className="flex flex-wrap items-end gap-3 rounded-lg border p-4">
      <label className="flex-1 text-sm">Поиск по оригинальному или русскому имени<input type="search" name="query" maxLength={100} defaultValue={filter.query} className="mt-1 w-full rounded-lg border bg-background p-2" /></label>
      <label className="text-sm">Статус перевода<select name="status" defaultValue={filter.status} className="mt-1 block rounded-lg border bg-background p-2">
        <option value="all">Все</option><option value="missing">Отсутствует</option><option value="unreviewed">Не подтверждено</option><option value="reviewed">Подтверждено</option>
      </select></label>
      <button type="submit" className="rounded-lg border px-4 py-2 text-sm">Найти</button>
    </form>
    <p className="text-sm">Найдено: {page.total}. Страница {page.page} из {Math.max(1, page.totalPages)}.</p>
    {page.items.length === 0 && <p>По заданным условиям тренеры не найдены.</p>}
    <ul className="grid gap-3 md:grid-cols-2">{page.items.map((coach) => <li key={coach.id} className="flex gap-4 rounded-lg border p-4">
      <CoachPhoto url={coach.providerPhotoUrl} /><div className="min-w-0 space-y-1 text-sm">
        <Link className={linkClass} href={footballCoachesHref(filter, { id: coach.id })}>{coach.providerName}</Link>
        <p>Русское имя: {coach.nameRu ?? "—"}</p><p>{localizationStatus(coach)}</p><p>Отображаемое имя: {coach.displayName}</p>
      </div>
    </li>)}</ul>
    <nav aria-label="Страницы тренеров" className="flex gap-4">
      {page.page > 1 && <Link className={linkClass} href={footballCoachesHref(filter, { page: page.page - 1, id: "" })}>Предыдущая страница</Link>}
      {page.page < page.totalPages && <Link className={linkClass} href={footballCoachesHref(filter, { page: page.page + 1, id: "" })}>Следующая страница</Link>}
      {page.page > 1 && page.items.length === 0 && <Link className={linkClass} href={footballCoachesHref(filter, { page: 1, id: "" })}>К началу списка</Link>}
    </nav>
    {filter.id && !detail && <p role="alert">Тренер не найден. Проверьте внутренний ID или выберите запись из списка.</p>}
    {detail && <section className="space-y-4 rounded-lg border p-4" aria-labelledby="coach-detail-title">
      <h2 id="coach-detail-title" className="text-xl font-semibold">{detail.entity.providerName}</h2>
      <CoachPhoto url={detail.providerPhotoUrl} />
      <dl className="space-y-2 break-words text-sm">
        <div><dt>Оригинальное имя</dt><dd>{detail.entity.providerName}</dd></div>
        <div><dt>Русское имя</dt><dd>{detail.entity.nameRu ?? "—"} · {localizationStatus(detail.entity)}</dd></div>
        <div><dt>Отображаемое имя</dt><dd>{detail.entity.displayName}</dd></div>
        <div><dt>Внутренний ID</dt><dd>{detail.entity.id}</dd></div>
        <div><dt>Provider identity</dt><dd>{detail.entity.provider} / {detail.providerCoachId}</dd></div>
        <div><dt>Источник имени — Match</dt><dd>{detail.nameSourceMatchId}</dd></div>
        <div><dt>Источник фото — Match</dt><dd>{detail.photoSourceMatchId ?? "—"}</dd></div>
      </dl>
      <Link className={linkClass} href={`/admin/football/localization?${new URLSearchParams({ kind: "coaches", id: detail.entity.id })}`}>Редактировать русское имя в Локализации</Link>
      <h3 className="text-lg font-semibold">Наблюдения по клубам</h3>
      <p className="text-sm text-muted-foreground">Источник — только сохранённые составы матчей. Это не история карьеры и не подтверждение действующего контракта. Замена состава может убрать наблюдение; отсутствие сведений не означает увольнение.</p>
      {detail.observations.length === 0 && <p>Доступных наблюдений в сохранённых составах нет.</p>}
      {detail.observations.map((club) => <article key={club.clubId} className="space-y-2 rounded-lg border p-3 text-sm">
        <h4 className="font-semibold">{club.displayName}</h4><p>Сохранённых наблюдений этого тренера: {club.snapshots}.</p>
        <p>Последние по дате матча наблюдения этого тренера (включая незавершённые матчи):</p>
        <ul>{club.sources.map((source) => <li key={source.matchId} className="break-words">Match {source.matchId} · {time(source.kickoffAt)} · {FIXTURE_STATUS_LABELS_RU[source.status as keyof typeof FIXTURE_STATUS_LABELS_RU] ?? source.status} · состав наблюдался {time(source.lineupObservedAt)}</li>)}</ul>
        <LastKnown observation={club.lastKnown} coachId={detail.entity.id} />
      </article>)}
    </section>}
  </div>;
}
function LastKnown({ observation, coachId }: { observation: LastKnownTeamCoach; coachId: string }) {
  const candidates = observation.kind === "known" || observation.kind === "unresolved" ? [observation.candidate] : observation.kind === "ambiguous" ? observation.candidates : [];
  return <div className="space-y-1 border-t pt-2">
    <p className="font-medium">Последний известный по завершённым матчам (FT/AET/PEN)</p>
    {observation.kind === "unknown" && <p>Тренер неизвестен.</p>}
    {observation.kind === "ambiguous" && <p>Неоднозначные наблюдения с одинаковой датой матча; один тренер не выбран.</p>}
    {observation.kind === "unresolved" && <p>Provider identity не разрешена; более ранний тренер не подставляется.</p>}
    {candidates.map((candidate) => <div key={`${candidate.provider}/${candidate.providerCoachId}`}>
      <p>{candidate.coach?.displayName ?? "Неразрешённый Coach"} · {candidate.provider} / {candidate.providerCoachId}{observation.kind === "known" && candidate.coach?.id === coachId ? " · этот тренер" : ""}</p>
      <ul>{candidate.sources.map((source) => <li key={source.matchId}>Источник: Match {source.matchId} · {time(source.kickoffAt)} · состав наблюдался {time(source.lineupObservedAt)}</li>)}</ul>
    </div>)}
    {observation.chronologyIncomplete && <p>Хронология неполна: есть завершённые матчи без пригодной даты или с датой в будущем.</p>}
  </div>;
}
