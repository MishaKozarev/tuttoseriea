import type { CurrentSerieAMatch } from "@/src/football/matches-repository";

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

  if (match.status === "scheduled") {
    return "Не начался";
  }

  if (match.status === "finished") {
    return "Завершён";
  }

  if (match.status === "paused") {
    return "Перерыв";
  }

  if (match.status === "postponed") {
    return "Перенесён";
  }

  if (match.status === "cancelled") {
    return "Отменён";
  }

  return match.providerStatusLong ?? match.providerStatusShort;
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
  code,
  logoUrl,
  name,
}: {
  code: string | null;
  logoUrl: string | null;
  name: string;
}) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-md border bg-background text-[11px] font-semibold text-muted-foreground">
        {logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={logoUrl} alt="" className="size-6 object-contain" loading="lazy" />
        ) : (
          code ?? name.slice(0, 2).toUpperCase()
        )}
      </span>
      <span className="truncate text-sm font-medium text-foreground">{name}</span>
    </div>
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
            {round}
          </h2>
          <ul className="divide-y rounded-lg border bg-card text-card-foreground">
            {roundMatches.map((match) => {
              const venue = formatVenue(match);
              const homeLogoUrl = safeImageUrl(match.homeClub.providerLogoUrl);
              const awayLogoUrl = safeImageUrl(match.awayClub.providerLogoUrl);

              return (
                <li
                  key={match.id}
                  className="grid gap-3 p-4 md:grid-cols-[minmax(10rem,14rem)_1fr_auto] md:items-center"
                >
                  <div className="space-y-1 text-sm">
                    <p className="font-medium text-foreground">
                      {formatKickoff(match.kickoffAt)}
                    </p>
                    {venue ? (
                      <p className="text-xs leading-5 text-muted-foreground">{venue}</p>
                    ) : null}
                  </div>
                  <div className="grid min-w-0 grid-cols-[1fr_auto_1fr] items-center gap-3">
                    <ClubBadge
                      code={match.homeClub.code}
                      logoUrl={homeLogoUrl}
                      name={match.homeClub.displayName}
                    />
                    <span className="min-w-12 text-center text-sm font-semibold tabular-nums">
                      {formatScore(match)}
                    </span>
                    <div className="flex justify-end">
                      <ClubBadge
                        code={match.awayClub.code}
                        logoUrl={awayLogoUrl}
                        name={match.awayClub.displayName}
                      />
                    </div>
                  </div>
                  <div className="justify-self-start rounded-md border px-2.5 py-1 text-xs font-medium text-muted-foreground md:justify-self-end">
                    {statusLabel(match)}
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
