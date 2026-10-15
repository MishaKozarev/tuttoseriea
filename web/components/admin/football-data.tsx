import Link from "next/link";
import { FootballSynchronization } from "./football-synchronization";
import { FIXTURE_STATUS_LABELS_RU, resolveFixtureStatusLabel, resolveFootballGeography } from "@/src/football/localization";
import { FOOTBALL_DATA_VIEWS, footballDataHref, matchDatasetAvailability, type FootballDataQuery, type MatchDatasetEvidence } from "@/src/admin/football-data";
import type { FootballDataModel } from "@/src/admin/football-data-repository";
import { synchronizationTime } from "@/src/admin/football-synchronization-client";

const value = (input: string | number | boolean | null | undefined) => input === null || input === undefined ? "Нет сведений" : typeof input === "boolean" ? input ? "Да" : "Нет" : input;
const time = (date: Date | null) => synchronizationTime(date?.toISOString() ?? null);
const linkClass = "underline underline-offset-4";

export function FootballData({ data, filter, actorAccountId }: { data: FootballDataModel; filter: FootballDataQuery; actorAccountId: string }) {
  const page = "page" in data ? data.page : null;
  return <div className="space-y-6">
    <nav aria-label="Football datasets" className="flex flex-wrap gap-4">
      {Object.entries(FOOTBALL_DATA_VIEWS).map(([view, label]) => <Link key={view} className={linkClass} aria-current={filter.view === view ? "page" : undefined}
        href={footballDataHref({ view: view as FootballDataQuery["view"], query: "", status: "", club: "", id: "", page: 1 })}>{label}</Link>)}
    </nav>
    <p className="text-sm text-muted-foreground">Чтение PostgreSQL: {time(data.checkedAt)}. Доступность и актуальность на стороне provider неизвестны.</p>
    <a className={`${linkClass} inline-block text-sm`} href={footballDataHref(filter)}>Обновить данные из PostgreSQL</a>
    <h2 className="text-xl font-semibold">{FOOTBALL_DATA_VIEWS[data.view]}</h2>
    {data.view !== "standings" && <form action="/admin/football/data" method="get" className="flex flex-wrap items-end gap-3 rounded-lg border p-4">
      <input type="hidden" name="view" value={data.view} />
      <label className="min-w-0 flex-1 text-sm">Поиск<input type="search" name="query" maxLength={100} defaultValue={filter.query} className="mt-1 w-full rounded-lg border bg-background p-2" /></label>
      {data.view === "matches" && <>
        <div className="text-sm"><label htmlFor="data-status">Статус</label><select id="data-status" name="status" defaultValue={filter.status} className="mt-1 block rounded-lg border bg-background p-2">
          <option value="">Все статусы</option>{Object.entries(FIXTURE_STATUS_LABELS_RU).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
        </select></div>
        <div className="min-w-0 text-sm"><label htmlFor="data-club">Клуб</label><select id="data-club" name="club" defaultValue={filter.club} className="mt-1 block max-w-full rounded-lg border bg-background p-2">
          <option value="">Все клубы</option>{data.clubs.map((club) => <option key={club.id} value={club.id}>{club.displayName}</option>)}
        </select></div>
      </>}
      <button type="submit" className="rounded-lg border px-4 py-2 text-sm font-medium">Найти</button>
    </form>}
    {page && <>
      <p className="text-sm">Найдено: {page.total}. Страница {page.page} из {Math.max(1, page.totalPages)}; до 20 записей.</p>
      {page.items.length === 0 && <p>По заданным условиям ничего не найдено.</p>}
    </>}
    {data.view === "clubs" && <>
      <ul className="grid gap-3 md:grid-cols-2">{data.page.items.map((club) => <li key={club.id} className="min-w-0 space-y-2 rounded-lg border p-4 text-sm">
        <p className="break-words font-medium">{club.displayName}</p><p className="break-words">Original: {club.providerName} · {value(club.code)}</p>
        <Link className={linkClass} href={footballDataHref(filter, { id: club.id })}>Просмотреть клуб {club.displayName}</Link>{" · "}
        <Link className={linkClass} href={`/clubs/${encodeURIComponent(club.slug)}`}>Публичная страница клуба</Link>
      </li>)}</ul>
      {data.detail && <section aria-label="Данные клуба" className="space-y-3 rounded-lg border p-4">
        <h3 className="font-semibold">{data.detail.club.displayName}</h3>
        <p className="break-all text-sm">ID: {data.detail.club.id}</p>
        <p>Страна: {value(resolveFootballGeography(data.detail.club.country))} · Основан: {value(data.detail.club.founded)}</p>
        <p>Сезон: {data.detail.season.displayLabel}. Место: {value(data.detail.standing?.rank)}. Очки: {value(data.detail.standing?.points)}.</p>
        <h4 className="font-medium">Сохранённый текущий состав</h4>
        <p className="text-sm">Текущие squad memberships не являются историческим составом сезона.</p>
        {data.detail.squad.length === 0 && <p>Состав отсутствует.</p>}
        <ul className="space-y-2 text-sm">{data.detail.squad.map((p) => <li key={p.membershipId}>
          <Link className={linkClass} href={footballDataHref({ view: "players", query: "", status: "", club: "", page: 1, id: p.playerId })}>{p.displayName}</Link>
          {" · "}{p.position} · № {value(p.shirtNumber)} · Матчи: {value(p.statistics?.appearances)} · Голы: {value(p.statistics?.goals)}
        </li>)}</ul>
      </section>}
    </>}
    {data.view === "players" && <>
      <p className="text-sm">Все сохранённые игроки, включая не соответствующих public eligibility. Клубы ниже отражают текущие memberships; статистика показана по сохранённым сезонам и клубам.</p>
      <ul className="grid gap-3 md:grid-cols-2">{data.page.items.map((p) => <li key={p.id} className="min-w-0 space-y-2 rounded-lg border p-4 text-sm">
        <p className="break-words font-medium">{p.displayName}</p><p className="break-words">Original: {p.provider_name} · Возраст: {value(p.age)} · {p.publicEligible ? "Доступен публично" : "Вне public eligibility"}</p>
        <Link className={linkClass} href={footballDataHref(filter, { id: p.id })}>Просмотреть игрока {p.displayName}</Link>
      </li>)}</ul>
      {data.detail && <section aria-label="Данные игрока" className="space-y-3 rounded-lg border p-4">
        <h3 className="font-semibold">{data.detail.player.displayName}</h3>
        <p className="break-all text-sm">ID: {data.detail.player.id} · Provider: {data.detail.player.provider} · Provider ID: {data.detail.player.provider_player_id}</p>
        <p>{value(data.detail.player.firstname)} {value(data.detail.player.lastname)} · Возраст: {value(data.detail.player.age)} · Дата рождения: {value(data.detail.player.birth_date)}</p>
        <p>Гражданство: {value(resolveFootballGeography(data.detail.player.nationality))} · Рост: {value(data.detail.player.height)} · Вес: {value(data.detail.player.weight)} · Травма: {value(data.detail.player.injured)}</p>
        {data.detail.player.publicEligible && <Link className={linkClass} href={`/players/${encodeURIComponent(data.detail.player.slug)}`}>Публичная страница игрока</Link>}
        <h4 className="font-medium">Текущие клубы</h4>
        {data.detail.memberships.length === 0 && <p>Сохранённых memberships нет.</p>}
        <ul className="space-y-1 text-sm">{data.detail.memberships.map((m) => <li key={m.clubId}>{m.displayName} · {m.position} · № {value(m.shirtNumber)}{m.currentSerieA ? " · текущая Serie A" : " · вне текущей Serie A"}</li>)}</ul>
        <h4 className="font-medium">Доступная статистика</h4>
        {data.detail.statistics.length === 0 && <p>Статистика отсутствует.</p>}
        <ul className="space-y-3 text-sm">{data.detail.statistics.map((s) => <li key={s.id} className="rounded-lg border p-3">
          <p>{s.competition} · {s.season} · {s.club}</p>
          <p>Матчи: {value(s.appearances)} · В старте: {value(s.lineups)} · Минуты: {value(s.minutes)} · Голы: {value(s.goals)} · Передачи: {value(s.assists)} · Рейтинг: {value(s.rating)}</p>
          <p>Удары: {value(s.shots)} · Пасы: {value(s.passes)} · Отборы: {value(s.tackles)} · Жёлтые: {value(s.yellow)} · Красные: {value(s.red)}</p>
        </li>)}</ul>
      </section>}
    </>}
    {data.view === "matches" && <>
      <ul className="grid gap-3 md:grid-cols-2">{data.page.items.map((m) => <li key={m.id} className="min-w-0 space-y-2 rounded-lg border p-4 text-sm">
        <p className="break-words font-medium">{m.homeClub.displayName} — {m.awayClub.displayName}</p>
        <p>{time(m.kickoffAt)} · {resolveFixtureStatusLabel(m.status, m.providerStatusLong ?? m.providerStatusShort)} ({m.providerStatusShort}) · {value(m.homeGoals)} : {value(m.awayGoals)}</p>
        <p>{m.round}</p><Link className={linkClass} href={footballDataHref(filter, { id: m.id })}>Просмотреть матч {m.homeClub.displayName} — {m.awayClub.displayName}</Link>
      </li>)}</ul>
      {data.detail && data.evidence && <section aria-label="Данные матча" className="min-w-0 space-y-5 rounded-lg border p-4">
        <h3 className="text-lg font-semibold">{data.detail.homeClub.displayName} — {data.detail.awayClub.displayName}</h3>
        <p className="break-all text-sm">Внутренний Match UUID: {data.detail.match.id}. Provider fixture ID: {data.detail.match.providerFixtureId}.</p>
        <p>{time(data.detail.match.kickoffAt)} · {resolveFixtureStatusLabel(data.detail.match.status, data.detail.match.providerStatusLong ?? data.detail.match.providerStatusShort)} · {value(data.detail.match.score.home)} : {value(data.detail.match.score.away)}</p>
        <p>Стадион: {value(data.detail.match.venueName)} · Судья: {value(data.detail.match.referee)}</p>
        <Link className={linkClass} href={`/matches/${encodeURIComponent(data.detail.match.slug)}`}>Публичная страница матча</Link>
        <MatchDatasets evidence={data.evidence} home={data.detail.homeClub} away={data.detail.awayClub} />
        <h4 className="text-lg font-semibold">Обновить datasets выбранного матча</h4>
        <p className="text-sm">Успешный execution не гарантирует полноту dataset. После выполнения отдельно обновите данные из PostgreSQL. Чтение статуса execution не обновляет snapshots на этой странице.</p>
        <FootballSynchronization key={`${actorAccountId}:${data.detail.match.id}`} actorAccountId={actorAccountId}
          matchScope={{ id: data.detail.match.id, label: `${data.detail.homeClub.displayName} — ${data.detail.awayClub.displayName}` }} />
      </section>}
    </>}
    {filter.id && "detail" in data && !data.detail && <p role="alert">Запись не найдена в доступном scope. Обновите список.</p>}
    {data.view === "standings" && <>
      {data.standings.length === 0 ? <p>Сохранённая таблица текущей Serie A отсутствует.</p> : <div className="overflow-x-auto"><table className="w-full text-left text-sm">
        <caption className="pb-3 text-left">Сохранено строк: {data.standings.length}. Это данные PostgreSQL, а не подтверждение актуальности provider.</caption>
        <thead><tr>{["Место", "Клуб", "И", "В", "Н", "П", "Мячи", "Разница", "Очки"].map((title) => <th key={title} scope="col" className="p-2">{title}</th>)}</tr></thead>
        <tbody>{data.standings.map((s) => <tr key={s.id} className="border-t"><td className="p-2">{s.rank}</td><td className="p-2"><Link className={linkClass} href={footballDataHref({ view: "clubs", query: "", status: "", club: "", id: s.clubId, page: 1 })}>{s.club.displayName}</Link></td>
          <td className="p-2">{s.overall.played}</td><td className="p-2">{s.overall.wins}</td><td className="p-2">{s.overall.draws}</td><td className="p-2">{s.overall.losses}</td><td className="p-2">{s.overall.goalsFor}:{s.overall.goalsAgainst}</td><td className="p-2">{s.goalsDiff}</td><td className="p-2">{s.points}</td></tr>)}</tbody>
      </table></div>}
    </>}
    {page && <nav aria-label="Страницы данных" className="flex flex-wrap gap-4 text-sm">
      {page.page > 1 && <Link className={linkClass} href={footballDataHref(filter, { page: page.page - 1, id: "" })}>Предыдущая страница</Link>}
      {page.page < page.totalPages && <Link className={linkClass} href={footballDataHref(filter, { page: page.page + 1, id: "" })}>Следующая страница</Link>}
      {page.items.length === 0 && page.page > 1 && <Link className={linkClass} href={footballDataHref(filter, { page: 1, id: "" })}>К началу списка</Link>}
    </nav>}
  </div>;
}

export function MatchDatasets({ evidence, home, away }: { evidence: MatchDatasetEvidence; home: { id: string; displayName: string }; away: { id: string; displayName: string } }) {
  const availability = matchDatasetAvailability(evidence);
  return <section aria-label="Доступность Match datasets" className="space-y-3 text-sm">
    <h4 className="font-semibold">Сохранённые snapshots</h4>
    <div className="rounded-lg border p-3"><h5 className="font-medium">Events</h5>
      <p>{availability.events === "missing" ? "Данные отсутствуют; подтверждения пустого snapshot нет." : availability.events === "confirmed-empty" ? "Подтверждённый zero-row snapshot (0 событий)." : `Сохранён snapshot: ${evidence.eventRows} событий.`}</p>
      <p>Время наблюдения Events не хранится. Последний успешный canonical execution: {time(evidence.eventsSucceededAt)}. Это время синхронизации, не observation timestamp строк.</p>
    </div>
    {(["lineups", "statistics"] as const).map((kind) => <div key={kind} className="rounded-lg border p-3">
      <h5 className="font-medium">{kind === "lineups" ? "Lineups" : "Statistics (full_match)"}</h5>
      <p>{availability[kind] === "missing" ? "Данные отсутствуют: 0 из 2 Team snapshots." : availability[kind] === "partial" ? "Частичные данные: 1 из 2 Team snapshots." : "Подтверждено наличие обеих Team snapshots: 2 из 2."}</p>
      {[home, away].map((club) => <p key={club.id}>{club.displayName}: {synchronizationTime(evidence[kind].find((s) => s.clubId === club.id)?.observedAt ?? null)}</p>)}
    </div>)}
    <p className="text-muted-foreground">Полнота означает наличие сохранённого snapshot, а не окончательные данные матча. Snapshots команд могут наблюдаться в разное время. Пустой ответ Lineups/Statistics сохраняет прежние данные. Доступность у provider и свежесть относительно provider неизвестны.</p>
  </section>;
}
