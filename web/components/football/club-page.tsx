import {
  CalendarDays,
  MapPin,
  Shield,
  Trophy,
} from "lucide-react";
import Link from "next/link";

import {
  formatMatchRound,
  formatStandingsForm,
  resolveFixtureStatusLabel,
  resolveFootballGeography,
  resolvePlayerPosition,
  resolveStandingsDescription,
} from "@/src/football/localization";
import type {
  ClubPageMatch,
  ClubPageStanding,
  CurrentSerieAClubPageData,
} from "@/src/football/club-page-repository";

const dateFormatter = new Intl.DateTimeFormat("ru-RU", {
  dateStyle: "medium",
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

function initials(name: string): string {
  return name
    .split(/\s+/u)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

function EmptyState({ children }: { children: string }) {
  return (
    <div className="rounded-lg border border-dashed bg-muted/25 p-5 text-sm leading-6 text-muted-foreground">
      {children}
    </div>
  );
}

function formatDifference(value: number): string {
  return value > 0 ? `+${value}` : String(value);
}

function StandingsSummary({ standing }: { standing: ClubPageStanding | null }) {
  if (!standing) {
    return <EmptyState>Данные турнирной таблицы для клуба пока отсутствуют.</EmptyState>;
  }

  const description = resolveStandingsDescription(standing.description);
  const form = formatStandingsForm(standing.form);
  const facts = [
    ["Место", standing.rank],
    ["Матчи", standing.played],
    ["Победы", standing.wins],
    ["Ничьи", standing.draws],
    ["Поражения", standing.losses],
    ["Мячи", `${standing.goalsFor}:${standing.goalsAgainst}`],
    ["Разница", formatDifference(standing.goalsDiff)],
    ["Очки", standing.points],
  ] as const;

  return (
    <div className="overflow-hidden rounded-lg border bg-card text-card-foreground">
      <dl className="grid grid-cols-2 divide-x divide-y sm:grid-cols-4 lg:grid-cols-8">
        {facts.map(([label, value]) => (
          <div key={label} className="min-w-0 px-3 py-4 text-center">
            <dt className="text-xs text-muted-foreground">{label}</dt>
            <dd className="mt-1 text-lg font-semibold tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
      {description || form ? (
        <div className="flex flex-wrap gap-x-5 gap-y-1 border-t px-4 py-3 text-sm text-muted-foreground">
          {description ? <p>{description}</p> : null}
          {form ? <p>Форма: <span className="font-medium text-foreground">{form}</span></p> : null}
        </div>
      ) : null}
    </div>
  );
}

function matchStatus(match: ClubPageMatch): string {
  if (match.status === "live" && match.statusElapsed != null) {
    const extra = match.statusExtra != null ? `+${match.statusExtra}` : "";

    return `${match.statusElapsed}${extra}'`;
  }

  return resolveFixtureStatusLabel(
    match.status,
    match.providerStatusLong ?? match.providerStatusShort,
  );
}

function matchScore(match: ClubPageMatch): string {
  return match.homeGoals == null || match.awayGoals == null
    ? "—"
    : `${match.homeGoals}:${match.awayGoals}`;
}

function TeamMark({
  slug,
  code,
  logoUrl,
  name,
}: {
  slug: string;
  code: string | null;
  logoUrl: string | null;
  name: string;
}) {
  const imageUrl = safeImageUrl(logoUrl);

  return (
    <Link
      href={`/clubs/${slug}`}
      className="flex min-w-0 items-center gap-2 underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      <span
        aria-hidden="true"
        className="flex size-8 shrink-0 items-center justify-center rounded-md border bg-background text-[10px] font-semibold text-muted-foreground"
      >
        {imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={imageUrl} alt="" className="size-6 object-contain" loading="lazy" />
        ) : (
          code ?? initials(name)
        )}
      </span>
      <span className="truncate text-sm font-medium">{name}</span>
    </Link>
  );
}

function ClubMatches({ matches }: { matches: ClubPageMatch[] }) {
  if (matches.length === 0) {
    return <EmptyState>Матчей в этой секции пока нет.</EmptyState>;
  }

  return (
    <ul className="divide-y rounded-lg border bg-card text-card-foreground">
      {matches.map((match) => (
        <li
          key={match.id}
          className="grid gap-4 p-4 sm:grid-cols-[minmax(0,1fr)_minmax(9rem,auto)_minmax(0,1fr)] sm:items-center"
        >
          <TeamMark
            slug={match.homeClub.slug}
            code={match.homeClub.code}
            logoUrl={match.homeClub.providerLogoUrl}
            name={match.homeClub.displayName}
          />
          <Link
            href={`/matches/${match.slug}`}
            aria-label={`${match.homeClub.displayName} — ${match.awayClub.displayName}`}
            className="space-y-1 text-center underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <span className="block text-xs text-muted-foreground">
              {match.kickoffAt ? dateFormatter.format(match.kickoffAt) : "Дата уточняется"}
            </span>
            <span className="block font-semibold tabular-nums">{matchScore(match)}</span>
            <span className="block text-xs text-muted-foreground">
              {formatMatchRound(match.round)} · {matchStatus(match)}
            </span>
          </Link>
          <span className="flex justify-end">
            <TeamMark
              slug={match.awayClub.slug}
              code={match.awayClub.code}
              logoUrl={match.awayClub.providerLogoUrl}
              name={match.awayClub.displayName}
            />
          </span>
        </li>
      ))}
    </ul>
  );
}

function formatStatistic(value: number | string | null): string {
  return value == null ? "—" : String(value);
}

function SquadTable({ data }: { data: CurrentSerieAClubPageData }) {
  if (data.squad.length === 0) {
    return <EmptyState>Текущий состав клуба пока не загружен.</EmptyState>;
  }

  return (
    <div className="overflow-x-auto rounded-lg border bg-card text-card-foreground">
      <table className="w-full min-w-[62rem] border-collapse text-sm">
        <caption className="sr-only">
          Текущий состав {data.club.displayName} и статистика сезона {data.season.displayLabel}
        </caption>
        <thead className="bg-muted/40 text-xs text-muted-foreground">
          <tr className="border-b">
            <th scope="col" className="min-w-64 px-4 py-3 text-left font-medium">Игрок</th>
            <th scope="col" className="w-14 px-2 py-3 text-center font-medium">№</th>
            <th scope="col" className="min-w-32 px-3 py-3 text-left font-medium">Позиция</th>
            <th scope="col" className="w-16 px-2 py-3 text-center font-medium">Матчи</th>
            <th scope="col" className="w-16 px-2 py-3 text-center font-medium">Старт</th>
            <th scope="col" className="w-16 px-2 py-3 text-center font-medium">Мин</th>
            <th scope="col" className="w-16 px-2 py-3 text-center font-medium">Голы</th>
            <th scope="col" className="w-16 px-2 py-3 text-center font-medium">ГП</th>
            <th scope="col" className="w-20 px-3 py-3 text-center font-medium">Рейтинг</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {data.squad.map((player) => {
            const photoUrl = safeImageUrl(player.providerPhotoUrl);
            const playerIdentity = (
              <>
                <span
                  aria-hidden="true"
                  className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-md border bg-background text-xs font-semibold text-muted-foreground"
                >
                  {photoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={photoUrl} alt="" className="size-full object-cover" loading="lazy" />
                  ) : (
                    initials(player.displayName)
                  )}
                </span>
                <span className="truncate font-medium text-foreground">
                  {player.displayName}
                </span>
              </>
            );

            return (
              <tr key={player.membershipId}>
                <th scope="row" className="px-4 py-3 text-left font-normal">
                  {player.publicPlayerSlug ? (
                    <Link
                      href={`/players/${player.publicPlayerSlug}`}
                      className="flex min-w-0 items-center gap-3 underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                    >
                      {playerIdentity}
                    </Link>
                  ) : (
                    <span className="flex min-w-0 items-center gap-3">
                      {playerIdentity}
                    </span>
                  )}
                </th>
                <td className="px-2 py-3 text-center tabular-nums">
                  {formatStatistic(player.shirtNumber)}
                </td>
                <td className="px-3 py-3">{resolvePlayerPosition(player.position)}</td>
                <td className="px-2 py-3 text-center tabular-nums">{formatStatistic(player.statistics?.appearances ?? null)}</td>
                <td className="px-2 py-3 text-center tabular-nums">{formatStatistic(player.statistics?.lineups ?? null)}</td>
                <td className="px-2 py-3 text-center tabular-nums">{formatStatistic(player.statistics?.minutes ?? null)}</td>
                <td className="px-2 py-3 text-center tabular-nums">{formatStatistic(player.statistics?.goals ?? null)}</td>
                <td className="px-2 py-3 text-center tabular-nums">{formatStatistic(player.statistics?.assists ?? null)}</td>
                <td className="px-3 py-3 text-center tabular-nums">{formatStatistic(player.statistics?.rating ?? null)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function ClubPage({ data }: { data: CurrentSerieAClubPageData }) {
  const logoUrl = safeImageUrl(data.club.providerLogoUrl);
  const country = resolveFootballGeography(data.club.country);

  return (
    <div className="space-y-10">
      <header className="grid gap-5 border-b pb-8 sm:grid-cols-[auto_1fr] sm:items-center">
        <div className="flex size-24 items-center justify-center rounded-lg border bg-card text-xl font-semibold text-muted-foreground sm:size-28">
          {logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logoUrl} alt="" className="size-20 object-contain sm:size-24" />
          ) : (
            initials(data.club.displayName)
          )}
        </div>
        <div className="min-w-0 space-y-3">
          <p className="text-sm font-medium text-muted-foreground">
            {data.competition.displayName} · {data.season.displayLabel}
          </p>
          <h1 className="text-3xl font-semibold leading-tight text-foreground sm:text-4xl">
            {data.club.displayName}
          </h1>
          <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm text-muted-foreground">
            {data.club.code ? (
              <span className="inline-flex items-center gap-1.5"><Shield className="size-4" aria-hidden="true" />{data.club.code}</span>
            ) : null}
            {country ? (
              <span className="inline-flex items-center gap-1.5"><MapPin className="size-4" aria-hidden="true" />{country}</span>
            ) : null}
            {data.club.founded ? (
              <span className="inline-flex items-center gap-1.5"><CalendarDays className="size-4" aria-hidden="true" />Основан в {data.club.founded}</span>
            ) : null}
          </div>
        </div>
      </header>

      <section className="space-y-4" aria-labelledby="club-standing-heading">
        <h2 id="club-standing-heading" className="flex items-center gap-2 text-xl font-semibold">
          <Trophy className="size-5" aria-hidden="true" />Положение в таблице
        </h2>
        <StandingsSummary standing={data.standing} />
      </section>

      <section className="space-y-4" aria-labelledby="club-matches-heading">
        <h2 id="club-matches-heading" className="text-xl font-semibold">Матчи</h2>
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="space-y-3">
            <h3 className="text-sm font-semibold uppercase text-muted-foreground">Последние</h3>
            <ClubMatches matches={data.recentMatches} />
          </div>
          <div className="space-y-3">
            <h3 className="text-sm font-semibold uppercase text-muted-foreground">Ближайшие</h3>
            <ClubMatches matches={data.upcomingMatches} />
          </div>
        </div>
      </section>

      <section className="space-y-4" aria-labelledby="club-squad-heading">
        <div className="space-y-1">
          <h2 id="club-squad-heading" className="text-xl font-semibold">Текущий состав</h2>
          <p className="text-sm text-muted-foreground">
            Текущий состав и статистика игроков за сезон {data.season.displayLabel}.
          </p>
        </div>
        <SquadTable data={data} />
      </section>
    </div>
  );
}
