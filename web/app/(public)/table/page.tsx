import type { Metadata } from "next";

import { StandingsTable } from "@/components/football/standings-table";
import { Container } from "@/components/layout/container";
import { getDbPool } from "@/src/db";
import { listCurrentSerieAStandings } from "@/src/football/standings-repository";
import { tableMetadata } from "@/src/seo/site";

export const dynamic = "force-dynamic";
export const metadata: Metadata = tableMetadata;

export default async function TablePage() {
  const standings = await listCurrentSerieAStandings(getDbPool());

  return (
    <section className="py-10 sm:py-14">
      <Container size="wide" className="space-y-6">
        <div className="max-w-3xl space-y-3">
          <p className="text-sm font-medium text-muted-foreground">Серия А 2026/27</p>
          <h1 className="text-3xl font-semibold leading-tight text-foreground sm:text-4xl">
            Таблица Серии А
          </h1>
          <p className="text-base leading-7 text-muted-foreground">
            Текущее положение команд чемпионата по сохранённым данным PostgreSQL.
          </p>
        </div>
        <StandingsTable standings={standings} />
      </Container>
    </section>
  );
}
