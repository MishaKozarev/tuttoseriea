import Link from "next/link";

import type { CurrentSerieAMatch } from "@/src/football/matches-repository";
import {
  formatMatchRound,
  resolveFixtureStatusLabel,
} from "@/src/football/localization";

const dateFormatter = new Intl.DateTimeFormat("ru-RU", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Europe/Rome",
});

function formatKickoff(value: Date | null): string {
  return value ? dateFormatter.format(value) : "Дата уточняется";
}

function formatVenue(match: CurrentSerieAMatch): string | null {
  if (match.venueName && match.venueCity) {
    return `${match.venueName}, ${match.venueCity}`;
  }

  return match.venueName ?? match.venueCity;
}

function formatScore(match: CurrentSerieAMatch): string {
  if (match.homeGoals == null || match.awayGoals == null) {
    return "-";
  }

  return `${match.homeGoals}:${match.awayGoals}`;
}

function statusLabel(match: CurrentSerieAMatch): string {
  if (match.status === "live" && match.statusElapsed != null) {
    const extra = match.statusExtra != null ? `+${match.statusExtra}` : "";

    return `${match.statusElapsed}${extra}'`;
  }

  return resolveFixtureStatusLabel(
    match.status,
    match.providerStatusLong ?? match.providerStatusShort,
  );
}

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

function groupMatchesByRound(matches: CurrentSerieAMatch[]): [string, CurrentSerieAMatch[]][] {
  const rounds = new Map<string, CurrentSerieAMatch[]>();

  for (const match of matches) {
    const roundMatches = rounds.get(match.round) ?? [];

    roundMatches.push(match);
    rounds.set(match.round, roundMatches);
  }

  return [...rounds.entries()];
}

function ClubBadge({
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
  return (
    <Link
      href={`/clubs/${slug}`}
      className="flex min-w-0 items-center gap-2 underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      <span
        aria-hidden="true"
        className="flex size-8 shrink-0 items-center justify-center rounded-md border bg-background text-[11px] font-semibold text-muted-foreground"
      >
        {logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={logoUrl} alt="" className="size-6 object-contain" loading="lazy" />
        ) : (
          code ?? name.slice(0, 2).toUpperCase()
        )}
      </span>
      <span className="truncate text-sm font-medium text-foreground">{name}</span>
    </Link>
  );
}

export function MatchesCalendar({ matches }: { matches: CurrentSerieAMatch[] }) {
  if (matches.length === 0) {
    return (
      <div className="rounded-lg border border-dashed bg-muted/25 p-6 text-sm leading-6 text-muted-foreground">
        Календарь появится после синхронизации матчей Серии А из сохранённых данных.
      </div>
    );
  }

  const rounds = groupMatchesByRound(matches);

  return (
    <div className="space-y-6">
      {rounds.map(([round, roundMatches], roundIndex) => (
        <section
          key={round}
          className="space-y-3"
          aria-labelledby={`calendar-round-${roundIndex}`}
        >
          <h2
            id={`calendar-round-${roundIndex}`}
            className="text-lg font-semibold text-foreground"
          >
            {formatMatchRound(round)}
          </h2>
          <ul className="divide-y rounded-lg border bg-card text-card-foreground">
            {roundMatches.map((match) => {
              const venue = formatVenue(match);
              const homeLogoUrl = safeImageUrl(match.homeClub.providerLogoUrl);
              const awayLogoUrl = safeImageUrl(match.awayClub.providerLogoUrl);

              return (
                <li
                  key={match.id}
                  className="grid gap-4 p-4 sm:grid-cols-[minmax(0,1fr)_minmax(9rem,auto)_minmax(0,1fr)] sm:items-center"
                >
                  <ClubBadge
                    slug={match.homeClub.slug}
                    code={match.homeClub.code}
                    logoUrl={homeLogoUrl}
                    name={match.homeClub.displayName}
                  />
                  <Link
                    href={`/matches/${match.slug}`}
                    aria-label={`${match.homeClub.displayName} — ${match.awayClub.displayName}`}
                    className="space-y-1 text-center underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                  >
                    <span className="block text-xs text-muted-foreground">
                      {formatKickoff(match.kickoffAt)}
                    </span>
                    <span className="block text-sm font-semibold tabular-nums">
                      {formatScore(match)}
                    </span>
                    <span className="block text-xs font-medium text-muted-foreground">
                      {statusLabel(match)}
                    </span>
                    {venue ? (
                      <span className="block text-xs leading-5 text-muted-foreground">{venue}</span>
                    ) : null}
                  </Link>
                  <div className="flex justify-end">
                    <ClubBadge
                      slug={match.awayClub.slug}
                      code={match.awayClub.code}
                      logoUrl={awayLogoUrl}
                      name={match.awayClub.displayName}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
