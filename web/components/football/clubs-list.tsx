import Link from "next/link";

import type { CurrentSerieAClub } from "@/src/football/repository";
import { resolveFootballGeography } from "@/src/football/localization";

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

function clubInitials(name: string): string {
  return name
    .split(/\s+/u)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

export function ClubsList({ clubs }: { clubs: CurrentSerieAClub[] }) {
  if (clubs.length === 0) {
    return (
      <div className="rounded-lg border border-dashed bg-muted/25 p-6 text-sm leading-6 text-muted-foreground">
        Клубы появятся после первой синхронизации данных API-Football.
      </div>
    );
  }

  return (
    <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {clubs.map((club) => {
        const logoUrl = safeImageUrl(club.providerLogoUrl);
        const country = resolveFootballGeography(club.country);

        return (
          <li key={club.id}>
            <Link
              href={`/clubs/${club.slug}`}
              className="block rounded-lg border bg-card p-4 text-card-foreground transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <div className="flex min-h-14 items-center gap-3">
                <div className="flex size-11 shrink-0 items-center justify-center rounded-md border bg-background text-sm font-semibold">
                  {logoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={logoUrl}
                      alt=""
                      className="size-8 object-contain"
                      loading="lazy"
                    />
                  ) : (
                    <span>{clubInitials(club.displayName)}</span>
                  )}
                </div>
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{club.displayName}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {club.code ? `${club.code} · ` : ""}
                    {country ?? club.providerName}
                  </p>
                </div>
              </div>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
