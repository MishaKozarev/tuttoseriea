import Link from "next/link";

import type {
  CurrentSerieAMatchPageData,
  MatchPageClub,
  MatchPageEvent,
  MatchPageLineup,
  MatchPageLineupEntry,
  MatchPagePlayerIdentity,
  MatchPageScore,
  MatchPageStatistics,
} from "@/src/football/match-page-repository";
import {
  formatMatchEventMinute,
  formatMatchRound,
  resolveFixtureStatusLabel,
  resolveMatchEventDetailLabel,
  resolveMatchEventTypeLabel,
  resolveMatchStatisticTypeLabel,
  resolvePlayerPosition,
} from "@/src/football/localization";

const dateFormatter = new Intl.DateTimeFormat("ru-RU", {
  dateStyle: "long",
  timeStyle: "short",
  timeZone: "Europe/Rome",
});

function safeImageUrl(value: string | null): string | null {
  if (!value) {
    return null;
  }

  try {
    const url = new URL(value);

    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function completeScore(score: MatchPageScore): string | null {
  return score.home == null || score.away == null ? null : `${score.home}:${score.away}`;
}

function statusLabel(data: CurrentSerieAMatchPageData): string {
  const label = resolveFixtureStatusLabel(
    data.match.status,
    data.match.providerStatusLong ?? data.match.providerStatusShort,
  );

  if (data.match.status !== "live" || data.match.statusElapsed == null) {
    return label;
  }

  const extra = data.match.statusExtra == null ? "" : `+${data.match.statusExtra}`;

  return `${label} · ${data.match.statusElapsed}${extra}'`;
}

function ClubIdentity({ club, side }: { club: MatchPageClub; side: "home" | "away" }) {
  const logoUrl = safeImageUrl(club.providerLogoUrl);

  return (
    <Link
      href={`/clubs/${club.slug}`}
      aria-label={club.displayName}
      className={`flex min-w-0 flex-col gap-3 underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 ${
        side === "away" ? "items-end text-right" : "items-start"
      }`}
    >
      <span className="flex size-20 items-center justify-center rounded-md border bg-background text-lg font-semibold text-muted-foreground sm:size-24">
        {logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={logoUrl} alt="" className="size-16 object-contain sm:size-20" />
        ) : (
          club.code ?? club.displayName.slice(0, 2).toUpperCase()
        )}
      </span>
      <span className="max-w-full text-lg font-semibold sm:text-xl">{club.displayName}</span>
    </Link>
  );
}

function PlayerIdentity({ player }: { player: MatchPagePlayerIdentity }) {
  const displayName =
    player.displayName ??
    (player.providerPlayerId === null ? "Игрок не указан" : `Игрок #${player.providerPlayerId}`);

  return player.publicSlug ? (
    <Link
      href={`/players/${player.publicSlug}`}
      className="font-medium underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      {displayName}
    </Link>
  ) : (
    <span className="font-medium">{displayName}</span>
  );
}

function CompactClubIdentity({ club }: { club: MatchPageClub }) {
  return (
    <Link
      href={`/clubs/${club.slug}`}
      className="font-semibold underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      {club.displayName}
    </Link>
  );
}

function EventParticipants({ event }: { event: MatchPageEvent }) {
  if (event.providerType === "subst") {
    return (
      <dl className="grid gap-2 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-xs text-muted-foreground">Ушёл</dt>
          <dd><PlayerIdentity player={event.player} /></dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Вышел</dt>
          <dd><PlayerIdentity player={event.relatedPlayer} /></dd>
        </div>
      </dl>
    );
  }

  const hasPlayer = event.player.displayName !== null || event.player.providerPlayerId !== null;
  const hasRelatedPlayer =
    event.relatedPlayer.displayName !== null || event.relatedPlayer.providerPlayerId !== null;

  if (!hasPlayer && !hasRelatedPlayer) {
    return null;
  }

  return (
    <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
      {hasPlayer ? <PlayerIdentity player={event.player} /> : null}
      {hasRelatedPlayer ? (
        <span className="text-muted-foreground">
          Ассистент: <PlayerIdentity player={event.relatedPlayer} />
        </span>
      ) : null}
    </div>
  );
}

function MatchEventsSection({ events }: { events: MatchPageEvent[] }) {
  if (events.length === 0) {
    return null;
  }

  return (
    <section className="space-y-3" aria-labelledby="match-events-heading">
      <h2 id="match-events-heading" className="text-xl font-semibold">События матча</h2>
      <ol className="divide-y border-y">
        {events.map((event) => (
          <li key={event.id} className="grid gap-3 py-4 sm:grid-cols-[4rem_minmax(0,1fr)]">
            <p className="font-semibold tabular-nums">
              {formatMatchEventMinute(event.elapsed, event.extra)}
            </p>
            <div className="min-w-0 space-y-2">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="font-semibold">
                  {resolveMatchEventTypeLabel(event.providerType)} ·{" "}
                  {resolveMatchEventDetailLabel(event.providerDetail)}
                </p>
                <CompactClubIdentity club={event.club} />
              </div>
              <EventParticipants event={event} />
              {event.comments ? (
                <p className="text-sm text-muted-foreground">{event.comments}</p>
              ) : null}
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

function LineupEntry({ entry }: { entry: MatchPageLineupEntry }) {
  return (
    <li className="grid grid-cols-[2.5rem_minmax(0,1fr)_minmax(5rem,auto)] items-center gap-3 py-2 text-sm">
      <span className="text-center tabular-nums text-muted-foreground">
        {entry.shirtNumber ?? "—"}
      </span>
      <PlayerIdentity player={entry.player} />
      <span className="text-right text-muted-foreground">
        {entry.providerPosition ? resolvePlayerPosition(entry.providerPosition) : "—"}
      </span>
    </li>
  );
}

function LineupList({
  heading,
  entries,
}: {
  heading: string;
  entries: MatchPageLineupEntry[];
}) {
  return (
    <div className="space-y-2">
      <h4 className="text-sm font-semibold">{heading}</h4>
      {entries.length > 0 ? (
        <ol className="divide-y border-y">
          {entries.map((entry) => <LineupEntry key={entry.id} entry={entry} />)}
        </ol>
      ) : (
        <p className="text-sm text-muted-foreground">Данные отсутствуют.</p>
      )}
    </div>
  );
}

function TeamLineup({ club, lineup }: { club: MatchPageClub; lineup?: MatchPageLineup }) {
  return (
    <article className="space-y-4 rounded-lg border p-4">
      <div className="space-y-1">
        <h3><CompactClubIdentity club={club} /></h3>
        {lineup ? (
          <p className="text-sm text-muted-foreground">
            {lineup.formation ? `Схема: ${lineup.formation}` : "Схема не указана"}
            {lineup.coachName ? ` · Тренер: ${lineup.coachName}` : ""}
          </p>
        ) : null}
      </div>
      {lineup ? (
        <>
          <LineupList heading="Стартовый состав" entries={lineup.starters} />
          <LineupList heading="Запасные" entries={lineup.substitutes} />
        </>
      ) : (
        <p className="text-sm text-muted-foreground">Данные отсутствуют.</p>
      )}
    </article>
  );
}

function MatchLineupsSection({ data }: { data: CurrentSerieAMatchPageData }) {
  if (data.lineups.length === 0) {
    return null;
  }

  const lineupsByClubId = new Map(data.lineups.map((lineup) => [lineup.club.id, lineup]));

  return (
    <section className="space-y-3" aria-labelledby="match-lineups-heading">
      <h2 id="match-lineups-heading" className="text-xl font-semibold">Составы</h2>
      <div className="grid gap-4 lg:grid-cols-2">
        <TeamLineup club={data.homeClub} lineup={lineupsByClubId.get(data.homeClub.id)} />
        <TeamLineup club={data.awayClub} lineup={lineupsByClubId.get(data.awayClub.id)} />
      </div>
    </section>
  );
}

function formatStatisticValue(value: number | string | null): string {
  return value === null ? "—" : String(value);
}

function TeamStatistics({
  club,
  statistics,
}: {
  club: MatchPageClub;
  statistics?: MatchPageStatistics;
}) {
  return (
    <article className="space-y-3 rounded-lg border p-4">
      <h3><CompactClubIdentity club={club} /></h3>
      {statistics ? (
        statistics.items.length > 0 ? (
          <dl className="divide-y border-y">
            {statistics.items.map((item) => (
              <div key={item.id} className="flex items-center justify-between gap-4 py-2 text-sm">
                <dt className="text-muted-foreground">
                  {resolveMatchStatisticTypeLabel(item.providerType)}
                </dt>
                <dd className="font-medium tabular-nums">
                  {formatStatisticValue(item.providerValue)}
                </dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="text-sm text-muted-foreground">Данные отсутствуют.</p>
        )
      ) : (
        <p className="text-sm text-muted-foreground">Данные отсутствуют.</p>
      )}
    </article>
  );
}

function MatchStatisticsSection({ data }: { data: CurrentSerieAMatchPageData }) {
  if (data.statistics.length === 0) {
    return null;
  }

  const statisticsByClubId = new Map(
    data.statistics.map((statistics) => [statistics.club.id, statistics]),
  );

  return (
    <section className="space-y-3" aria-labelledby="match-statistics-heading">
      <h2 id="match-statistics-heading" className="text-xl font-semibold">
        Статистика матча
      </h2>
      <div className="grid gap-4 lg:grid-cols-2">
        <TeamStatistics
          club={data.homeClub}
          statistics={statisticsByClubId.get(data.homeClub.id)}
        />
        <TeamStatistics
          club={data.awayClub}
          statistics={statisticsByClubId.get(data.awayClub.id)}
        />
      </div>
    </section>
  );
}

export function MatchPage({ data }: { data: CurrentSerieAMatchPageData }) {
  const mainScore = completeScore(data.match.score);
  const phaseScores = [
    ["Перерыв", completeScore(data.match.halftimeScore)],
    ["Основное время", completeScore(data.match.fulltimeScore)],
    ["Дополнительное время", completeScore(data.match.extratimeScore)],
    ["Пенальти", completeScore(data.match.penaltyScore)],
  ].filter((entry): entry is [string, string] => entry[1] !== null);
  const details = [
    ["Стадион", data.match.venueName],
    ["Город", data.match.venueCity],
    ["Судья", data.match.referee],
  ].filter((entry): entry is [string, string] => entry[1] !== null);

  return (
    <div className="space-y-8">
      <header className="space-y-6 border-b pb-8">
        <div className="space-y-2 text-center">
          <p className="text-sm font-medium text-muted-foreground">
            {data.competition.displayName} · {data.season.displayLabel}
          </p>
          <p className="text-sm text-muted-foreground">
            {formatMatchRound(data.match.round)}
          </p>
          <h1 className="text-2xl font-semibold leading-tight sm:text-3xl">
            {data.homeClub.displayName} — {data.awayClub.displayName}
          </h1>
          <p className="text-sm font-medium">{statusLabel(data)}</p>
          <p className="text-sm text-muted-foreground">
            {data.match.kickoffAt
              ? dateFormatter.format(data.match.kickoffAt)
              : "Дата уточняется"}
          </p>
        </div>

        <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-4 sm:gap-8">
          <ClubIdentity club={data.homeClub} side="home" />
          <div className="min-w-16 text-center text-3xl font-semibold tabular-nums sm:min-w-24 sm:text-4xl">
            {mainScore ? <span aria-label={`Счёт ${mainScore}`}>{mainScore}</span> : null}
          </div>
          <ClubIdentity club={data.awayClub} side="away" />
        </div>
      </header>

      {phaseScores.length > 0 ? (
        <section className="space-y-3" aria-labelledby="match-score-details-heading">
          <h2 id="match-score-details-heading" className="text-xl font-semibold">
            Счёт по периодам
          </h2>
          <dl className="divide-y border-y">
            {phaseScores.map(([label, score]) => (
              <div key={label} className="flex items-center justify-between gap-4 py-3">
                <dt className="text-sm text-muted-foreground">{label}</dt>
                <dd className="font-medium tabular-nums">{score}</dd>
              </div>
            ))}
          </dl>
        </section>
      ) : null}

      {details.length > 0 ? (
        <section className="space-y-3" aria-labelledby="match-details-heading">
          <h2 id="match-details-heading" className="text-xl font-semibold">
            Детали матча
          </h2>
          <dl className="grid gap-x-8 gap-y-4 border-y py-4 sm:grid-cols-3">
            {details.map(([label, value]) => (
              <div key={label} className="space-y-1">
                <dt className="text-xs font-medium uppercase text-muted-foreground">{label}</dt>
                <dd className="text-sm font-medium">{value}</dd>
              </div>
            ))}
          </dl>
        </section>
      ) : null}

      <MatchEventsSection events={data.events} />
      <MatchLineupsSection data={data} />
      <MatchStatisticsSection data={data} />
    </div>
  );
}
