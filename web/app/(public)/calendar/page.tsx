import type { Metadata } from "next";

import { MatchesCalendar } from "@/components/football/matches-calendar";
import { Container } from "@/components/layout/container";
import { getDbPool } from "@/src/db";
import { listCurrentSerieAMatches } from "@/src/football/matches-repository";
import { calendarMetadata } from "@/src/seo/site";

export const dynamic = "force-dynamic";
export const metadata: Metadata = calendarMetadata;

export default async function CalendarPage() {
  const matches = await listCurrentSerieAMatches(getDbPool());

  return (
    <section className="py-10 sm:py-14">
      <Container size="wide" className="space-y-6">
        <div className="max-w-3xl space-y-3">
          <p className="text-sm font-medium text-muted-foreground">Серия А 2026/27</p>
          <h1 className="text-3xl font-semibold leading-tight text-foreground sm:text-4xl">
            Календарь Серии А
          </h1>
          <p className="text-base leading-7 text-muted-foreground">
            Матчи текущего сезона из сохранённых данных PostgreSQL.
          </p>
        </div>
        <MatchesCalendar matches={matches} />
      </Container>
    </section>
  );
}
