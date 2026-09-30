import {
  CalendarDays,
  HeartPulse,
  MapPin,
  Ruler,
  Shirt,
  UserRound,
  Weight,
} from "lucide-react";
import Link from "next/link";

import type {
  CurrentSerieAPlayerPageData,
  PlayerPageClub,
  PlayerPageStatistics,
} from "@/src/football/player-page-repository";
import {
  resolveFootballGeography,
  resolvePlayerPosition,
  resolvePlayerStatisticsLabel,
} from "@/src/football/localization";

const birthDateFormatter = new Intl.DateTimeFormat("ru-RU", {
  dateStyle: "long",
  timeZone: "UTC",
});

const statisticGroups = [
  {
    title: "Игровое время",
    fields: ["appearances", "lineups", "minutes", "rating"],
  },
  {
    title: "Атака",
    fields: ["goalsTotal", "goalsAssists", "shotsTotal", "shotsOn"],
  },
  {
    title: "Передачи",
    fields: ["passesTotal", "passesKey", "passesAccuracy"],
  },
  {
    title: "Оборона",
    fields: ["tacklesTotal", "tacklesBlocks", "tacklesInterceptions"],
  },
  {
    title: "Карточки",
    fields: ["cardsYellow", "cardsYellowRed", "cardsRed"],
  },
] as const satisfies ReadonlyArray<{
  title: string;
  fields: ReadonlyArray<keyof PlayerPageStatistics>;
}>;

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

function formatBirthDate(value: string | null): string | null {
  if (!value) {
    return null;
  }

  const date = new Date(`${value}T00:00:00.000Z`);

  return Number.isNaN(date.getTime()) ? value : birthDateFormatter.format(date);
}

function formatStatistic(value: number | string | null): string {
  return value == null ? "—" : String(value);
}

function ClubIdentity({ club }: { club: PlayerPageClub }) {
  const logoUrl = safeImageUrl(club.providerLogoUrl);

  return (
    <Link
      href={`/clubs/${club.slug}`}
      className="inline-flex min-w-0 items-center gap-3 font-medium text-foreground underline-offset-4 hover:underline"
    >
      <span
        className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-md border bg-background text-xs font-semibold text-muted-foreground"
        aria-hidden="true"
      >
        {logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={logoUrl} alt="" className="size-8 object-contain" loading="lazy" />
        ) : (
          initials(club.displayName)
        )}
      </span>
      <span className="truncate">{club.displayName}</span>
    </Link>
  );
}

function CurrentMemberships({ data }: { data: CurrentSerieAPlayerPageData }) {
  if (data.memberships.length === 0) {
    return (
      <div className="rounded-lg border border-dashed bg-muted/25 p-5 text-sm leading-6 text-muted-foreground">
        Текущий клуб игрока в составе Серии A не указан.
      </div>
    );
  }

  return (
    <ul className="divide-y rounded-lg border bg-card text-card-foreground">
      {data.memberships.map((membership) => (
        <li
          key={membership.id}
          className="grid gap-3 p-4 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-center"
        >
          <ClubIdentity club={membership.club} />
          <span className="text-sm text-muted-foreground">
            {resolvePlayerPosition(membership.position)}
          </span>
          <span className="text-sm tabular-nums text-muted-foreground">
            № {formatStatistic(membership.shirtNumber)}
          </span>
        </li>
      ))}
    </ul>
  );
}

function StatisticsSection({ statistics }: { statistics: PlayerPageStatistics }) {
  return (
    <article className="overflow-hidden rounded-lg border bg-card text-card-foreground">
      <header className="border-b p-4">
        <ClubIdentity club={statistics.club} />
      </header>
      <div className="grid gap-6 p-4 md:grid-cols-2 xl:grid-cols-3">
        {statisticGroups.map((group) => (
          <section key={group.title} className="space-y-3" aria-label={group.title}>
            <h3 className="text-sm font-semibold text-foreground">{group.title}</h3>
            <dl className="space-y-2 text-sm">
              {group.fields.map((field) => (
                <div key={field} className="flex items-baseline justify-between gap-4">
                  <dt className="text-muted-foreground">
                    {resolvePlayerStatisticsLabel(field)}
                  </dt>
                  <dd className="font-medium tabular-nums">
                    {formatStatistic(statistics[field])}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </article>
  );
}

export function PlayerPage({ data }: { data: CurrentSerieAPlayerPageData }) {
  const photoUrl = safeImageUrl(data.player.providerPhotoUrl);
  const birthDate = formatBirthDate(data.player.birthDate);
  const birthCountry = resolveFootballGeography(data.player.birthCountry);
  const nationality = resolveFootballGeography(data.player.nationality);
  const providerFullName = [data.player.firstname, data.player.lastname]
    .filter((value): value is string => Boolean(value?.trim()))
    .join(" ");
  const showProviderFullName =
    providerFullName.length > 0 &&
    providerFullName.localeCompare(data.player.displayName, undefined, {
      sensitivity: "base",
    }) !== 0;
  const birthPlace = [data.player.birthPlace, birthCountry].filter(Boolean).join(", ");

  return (
    <div className="space-y-10">
      <header className="grid gap-5 border-b pb-8 sm:grid-cols-[auto_1fr] sm:items-center">
        <div className="flex size-28 items-center justify-center overflow-hidden rounded-lg border bg-card text-2xl font-semibold text-muted-foreground sm:size-32">
          {photoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={photoUrl} alt="" className="size-full object-cover" />
          ) : (
            initials(data.player.displayName)
          )}
        </div>
        <div className="min-w-0 space-y-3">
          <p className="text-sm font-medium text-muted-foreground">
            {data.competition.displayName} · {data.season.displayLabel}
          </p>
          <div>
            <h1 className="text-3xl font-semibold leading-tight text-foreground sm:text-4xl">
              {data.player.displayName}
            </h1>
            {showProviderFullName ? (
              <p className="mt-1 text-sm text-muted-foreground">{providerFullName}</p>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm text-muted-foreground">
            {birthDate ? (
              <span className="inline-flex items-center gap-1.5">
                <CalendarDays className="size-4" aria-hidden="true" />
                {birthDate}
              </span>
            ) : null}
            {birthPlace ? (
              <span className="inline-flex items-center gap-1.5">
                <MapPin className="size-4" aria-hidden="true" />
                {birthPlace}
              </span>
            ) : null}
            {nationality ? (
              <span className="inline-flex items-center gap-1.5">
                <UserRound className="size-4" aria-hidden="true" />
                {nationality}
              </span>
            ) : null}
            {data.player.age != null ? <span>Возраст: {data.player.age}</span> : null}
            {data.player.height ? (
              <span className="inline-flex items-center gap-1.5">
                <Ruler className="size-4" aria-hidden="true" />
                {data.player.height}
              </span>
            ) : null}
            {data.player.weight ? (
              <span className="inline-flex items-center gap-1.5">
                <Weight className="size-4" aria-hidden="true" />
                {data.player.weight}
              </span>
            ) : null}
            {data.player.injured != null ? (
              <span className="inline-flex items-center gap-1.5">
                <HeartPulse className="size-4" aria-hidden="true" />
                {data.player.injured ? "Травмирован" : "Не травмирован"}
              </span>
            ) : null}
          </div>
        </div>
      </header>

      <section className="space-y-4" aria-labelledby="player-memberships-heading">
        <h2
          id="player-memberships-heading"
          className="flex items-center gap-2 text-xl font-semibold"
        >
          <Shirt className="size-5" aria-hidden="true" />Текущий клуб
        </h2>
        <CurrentMemberships data={data} />
      </section>

      <section className="space-y-4" aria-labelledby="player-statistics-heading">
        <div className="space-y-1">
          <h2 id="player-statistics-heading" className="text-xl font-semibold">
            Статистика сезона
          </h2>
          <p className="text-sm text-muted-foreground">
            {data.competition.displayName} · {data.season.displayLabel}. Данные показаны
            отдельно для каждого клуба.
          </p>
        </div>
        {data.statistics.length > 0 ? (
          <div className="space-y-5">
            {data.statistics.map((statistics) => (
              <StatisticsSection key={statistics.id} statistics={statistics} />
            ))}
          </div>
        ) : (
          <div className="rounded-lg border border-dashed bg-muted/25 p-5 text-sm leading-6 text-muted-foreground">
            Статистика игрока за текущий сезон пока отсутствует.
          </div>
        )}
      </section>
    </div>
  );
}
