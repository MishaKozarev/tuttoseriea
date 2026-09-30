import Link from "next/link";

import type {
  CurrentSerieAStatisticsPageData,
  RankedPlayerStatistic,
} from "@/src/football/statistics-page-repository";
import type { CurrentSerieAStanding } from "@/src/football/standings-repository";

type LeaderboardProps = {
  id: string;
  title: string;
  valueLabel: string;
  emptyText: string;
  rows: RankedPlayerStatistic[];
};

function Leaderboard({
  id,
  title,
  valueLabel,
  emptyText,
  rows,
}: LeaderboardProps) {
  return (
    <section className="space-y-3" aria-labelledby={id}>
      <h2 id={id} className="text-xl font-semibold text-foreground">
        {title}
      </h2>
      {rows.length === 0 ? (
        <div className="rounded-lg border border-dashed bg-muted/25 p-5 text-sm leading-6 text-muted-foreground">
          {emptyText}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border bg-card text-card-foreground">
          <table className="w-full min-w-[34rem] border-collapse text-sm">
            <caption className="sr-only">{title}, Серия А 2026/27</caption>
            <thead className="bg-muted/40 text-xs text-muted-foreground">
              <tr className="border-b">
                <th scope="col" className="w-12 px-3 py-3 text-center font-medium">
                  М
                </th>
                <th scope="col" className="min-w-40 px-3 py-3 text-left font-medium">
                  Игрок
                </th>
                <th scope="col" className="min-w-44 px-3 py-3 text-left font-medium">
                  Клубы
                </th>
                <th scope="col" className="w-20 px-3 py-3 text-center font-medium">
                  {valueLabel}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((row) => (
                <tr key={row.player.id}>
                  <td className="px-3 py-3 text-center font-semibold tabular-nums">
                    {row.rank}
                  </td>
                  <th scope="row" className="px-3 py-3 text-left font-normal">
                    <Link
                      href={`/players/${row.player.slug}`}
                      className="font-medium text-foreground underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                    >
                      {row.player.displayName}
                    </Link>
                  </th>
                  <td className="px-3 py-3 text-muted-foreground">
                    <span className="flex flex-wrap gap-x-1.5 gap-y-1">
                      {row.clubs.map((club) => (
                        <Link
                          key={club.id}
                          href={`/clubs/${club.slug}`}
                          className="underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                        >
                          {club.displayName}
                        </Link>
                      ))}
                    </span>
                  </td>
                  <td className="px-3 py-3 text-center text-base font-semibold tabular-nums">
                    {row.value}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function formatGoalsDifference(value: number): string {
  return value > 0 ? `+${value}` : String(value);
}

function Goals({ standing }: { standing: CurrentSerieAStanding }) {
  return (
    <>
      {standing.overall.goalsFor}:{standing.overall.goalsAgainst}
    </>
  );
}

function SplitGoals({ goalsFor, goalsAgainst }: { goalsFor: number; goalsAgainst: number }) {
  return (
    <>
      {goalsFor}:{goalsAgainst}
    </>
  );
}

function ClubStatistics({ standings }: { standings: CurrentSerieAStanding[] }) {
  return (
    <section className="space-y-3" aria-labelledby="club-statistics-heading">
      <h2 id="club-statistics-heading" className="text-xl font-semibold text-foreground">
        Статистика команд
      </h2>
      {standings.length === 0 ? (
        <div className="rounded-lg border border-dashed bg-muted/25 p-5 text-sm leading-6 text-muted-foreground">
          Статистика команд пока отсутствует.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border bg-card text-card-foreground">
          <table className="w-full min-w-[92rem] border-collapse text-sm">
            <caption className="sr-only">Статистика команд Серии А сезона 2026/27</caption>
            <thead className="bg-muted/40 text-xs text-muted-foreground">
              <tr className="border-b">
                <th rowSpan={2} scope="col" className="w-12 px-3 py-3 text-center font-medium">
                  М
                </th>
                <th
                  rowSpan={2}
                  scope="col"
                  className="min-w-52 border-r px-3 py-3 text-left font-medium"
                >
                  Клуб
                </th>
                <th colSpan={7} scope="colgroup" className="border-r px-3 py-2 text-center font-semibold">
                  Всего
                </th>
                <th colSpan={5} scope="colgroup" className="border-r px-3 py-2 text-center font-semibold">
                  Дома
                </th>
                <th colSpan={5} scope="colgroup" className="px-3 py-2 text-center font-semibold">
                  В гостях
                </th>
              </tr>
              <tr className="border-b">
                {[
                  "И",
                  "В",
                  "Н",
                  "П",
                  "Мячи",
                  "+/-",
                  "О",
                  "И",
                  "В",
                  "Н",
                  "П",
                  "Мячи",
                  "И",
                  "В",
                  "Н",
                  "П",
                  "Мячи",
                ].map((label, index) => (
                  <th
                    key={`${label}-${index}`}
                    scope="col"
                    className={`px-2 py-2 text-center font-medium ${index === 6 || index === 11 ? "border-r" : ""}`}
                  >
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y">
              {standings.map((standing) => (
                <tr key={standing.id}>
                  <td className="px-3 py-3 text-center font-semibold tabular-nums">
                    {standing.rank}
                  </td>
                  <th scope="row" className="border-r px-3 py-3 text-left font-normal">
                    <Link
                      href={`/clubs/${standing.club.slug}`}
                      className="font-medium text-foreground underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                    >
                      {standing.club.displayName}
                    </Link>
                  </th>
                  <td className="px-2 py-3 text-center tabular-nums">{standing.overall.played}</td>
                  <td className="px-2 py-3 text-center tabular-nums">{standing.overall.wins}</td>
                  <td className="px-2 py-3 text-center tabular-nums">{standing.overall.draws}</td>
                  <td className="px-2 py-3 text-center tabular-nums">{standing.overall.losses}</td>
                  <td className="px-2 py-3 text-center tabular-nums">
                    <Goals standing={standing} />
                  </td>
                  <td className="px-2 py-3 text-center tabular-nums">
                    {formatGoalsDifference(standing.goalsDiff)}
                  </td>
                  <td className="border-r px-2 py-3 text-center font-semibold tabular-nums">
                    {standing.points}
                  </td>
                  <td className="px-2 py-3 text-center tabular-nums">{standing.home.played}</td>
                  <td className="px-2 py-3 text-center tabular-nums">{standing.home.wins}</td>
                  <td className="px-2 py-3 text-center tabular-nums">{standing.home.draws}</td>
                  <td className="px-2 py-3 text-center tabular-nums">{standing.home.losses}</td>
                  <td className="border-r px-2 py-3 text-center tabular-nums">
                    <SplitGoals
                      goalsFor={standing.home.goalsFor}
                      goalsAgainst={standing.home.goalsAgainst}
                    />
                  </td>
                  <td className="px-2 py-3 text-center tabular-nums">{standing.away.played}</td>
                  <td className="px-2 py-3 text-center tabular-nums">{standing.away.wins}</td>
                  <td className="px-2 py-3 text-center tabular-nums">{standing.away.draws}</td>
                  <td className="px-2 py-3 text-center tabular-nums">{standing.away.losses}</td>
                  <td className="px-2 py-3 text-center tabular-nums">
                    <SplitGoals
                      goalsFor={standing.away.goalsFor}
                      goalsAgainst={standing.away.goalsAgainst}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export function StatisticsPage({ data }: { data: CurrentSerieAStatisticsPageData }) {
  return (
    <div className="space-y-10">
      <header className="max-w-3xl space-y-3">
        <p className="text-sm font-medium text-muted-foreground">Serie A · 2026/27</p>
        <h1 className="text-3xl font-semibold leading-tight text-foreground sm:text-4xl">
          Статистика Серии А
        </h1>
      </header>

      <div className="grid gap-8 xl:grid-cols-2">
        <Leaderboard
          id="top-scorers-heading"
          title="Бомбардиры"
          valueLabel="Голы"
          emptyText="Данные о бомбардирах пока отсутствуют."
          rows={data.leaderboards.goals}
        />
        <Leaderboard
          id="top-assists-heading"
          title="Ассисты"
          valueLabel="Ассисты"
          emptyText="Данные о голевых передачах пока отсутствуют."
          rows={data.leaderboards.assists}
        />
        <Leaderboard
          id="top-appearances-heading"
          title="Больше всего матчей"
          valueLabel="Матчи"
          emptyText="Данные о сыгранных матчах пока отсутствуют."
          rows={data.leaderboards.appearances}
        />
        <Leaderboard
          id="top-minutes-heading"
          title="Больше всего минут"
          valueLabel="Минуты"
          emptyText="Данные о сыгранных минутах пока отсутствуют."
          rows={data.leaderboards.minutes}
        />
      </div>

      <ClubStatistics standings={data.standings} />
    </div>
  );
}
