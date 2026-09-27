import type { CurrentSerieAStanding } from "@/src/football/standings-repository";

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

function formatGoalsDifference(value: number): string {
  return value > 0 ? `+${value}` : String(value);
}

function Club({ standing }: { standing: CurrentSerieAStanding }) {
  const logoUrl = safeImageUrl(standing.club.providerLogoUrl);

  return (
    <div className="flex min-w-0 items-center gap-3">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-md border bg-background text-[11px] font-semibold text-muted-foreground">
        {logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={logoUrl} alt="" className="size-7 object-contain" loading="lazy" />
        ) : (
          standing.club.code ?? standing.club.displayName.slice(0, 2).toUpperCase()
        )}
      </span>
      <span className="min-w-0">
        <span className="block truncate font-medium text-foreground">
          {standing.club.displayName}
        </span>
        {standing.description ? (
          <span className="block truncate text-xs text-muted-foreground">
            {standing.description}
          </span>
        ) : null}
      </span>
    </div>
  );
}

export function StandingsTable({ standings }: { standings: CurrentSerieAStanding[] }) {
  if (standings.length === 0) {
    return (
      <div className="rounded-lg border border-dashed bg-muted/25 p-6 text-sm leading-6 text-muted-foreground">
        Таблица появится после синхронизации текущего положения команд Серии А.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border bg-card text-card-foreground">
      <table className="w-full min-w-[58rem] border-collapse text-sm">
        <caption className="sr-only">Таблица Серии А сезона 2026/27</caption>
        <thead className="bg-muted/40 text-xs text-muted-foreground">
          <tr className="border-b">
            <th scope="col" className="w-14 px-3 py-3 text-center font-medium">
              М
            </th>
            <th scope="col" className="min-w-64 px-3 py-3 text-left font-medium">
              Клуб
            </th>
            <th scope="col" className="w-12 px-2 py-3 text-center font-medium">
              И
            </th>
            <th scope="col" className="w-12 px-2 py-3 text-center font-medium">
              В
            </th>
            <th scope="col" className="w-12 px-2 py-3 text-center font-medium">
              Н
            </th>
            <th scope="col" className="w-12 px-2 py-3 text-center font-medium">
              П
            </th>
            <th scope="col" className="w-20 px-2 py-3 text-center font-medium">
              Мячи
            </th>
            <th scope="col" className="w-14 px-2 py-3 text-center font-medium">
              +/-
            </th>
            <th scope="col" className="w-24 px-3 py-3 text-center font-medium">
              Форма
            </th>
            <th scope="col" className="w-14 px-3 py-3 text-center font-semibold text-foreground">
              О
            </th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {standings.map((standing) => (
            <tr key={standing.id}>
              <td className="px-3 py-3 text-center font-semibold tabular-nums">
                {standing.rank}
              </td>
              <th scope="row" className="px-3 py-3 text-left font-normal">
                <Club standing={standing} />
              </th>
              <td className="px-2 py-3 text-center tabular-nums">{standing.overall.played}</td>
              <td className="px-2 py-3 text-center tabular-nums">{standing.overall.wins}</td>
              <td className="px-2 py-3 text-center tabular-nums">{standing.overall.draws}</td>
              <td className="px-2 py-3 text-center tabular-nums">{standing.overall.losses}</td>
              <td className="px-2 py-3 text-center tabular-nums">
                {standing.overall.goalsFor}:{standing.overall.goalsAgainst}
              </td>
              <td className="px-2 py-3 text-center tabular-nums">
                {formatGoalsDifference(standing.goalsDiff)}
              </td>
              <td className="px-3 py-3 text-center font-medium tabular-nums">
                {standing.form ?? "-"}
              </td>
              <td className="px-3 py-3 text-center text-base font-semibold tabular-nums">
                {standing.points}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
