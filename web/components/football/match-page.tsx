import Link from "next/link";

import type {
  CurrentSerieAMatchPageData,
  MatchPageClub,
  MatchPageScore,
} from "@/src/football/match-page-repository";
import {
  formatMatchRound,
  resolveFixtureStatusLabel,
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
    </div>
  );
}
