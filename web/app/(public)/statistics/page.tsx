import type { Metadata } from "next";

import { StatisticsPage } from "@/components/football/statistics-page";
import { Container } from "@/components/layout/container";
import { getDbPool } from "@/src/db";
import { getCurrentSerieAStatisticsPageData } from "@/src/football/statistics-page-repository";
import { statisticsMetadata } from "@/src/seo/site";

export const dynamic = "force-dynamic";
export const metadata: Metadata = statisticsMetadata;

export default async function GeneralStatisticsPage() {
  const data = await getCurrentSerieAStatisticsPageData(getDbPool());

  return (
    <section className="py-10 sm:py-14">
      <Container size="wide">
        <StatisticsPage data={data} />
      </Container>
    </section>
  );
}
