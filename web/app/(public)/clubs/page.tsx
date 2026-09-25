import type { Metadata } from "next";

import { ClubsList } from "@/components/football/clubs-list";
import { Container } from "@/components/layout/container";
import { getDbPool } from "@/src/db";
import { listCurrentSerieAClubs } from "@/src/football/repository";
import { clubsMetadata } from "@/src/seo/site";

export const dynamic = "force-dynamic";
export const metadata: Metadata = clubsMetadata;

export default async function ClubsPage() {
  const clubs = await listCurrentSerieAClubs(getDbPool());

  return (
    <section className="py-10 sm:py-14">
      <Container size="wide" className="space-y-6">
        <div className="max-w-3xl space-y-3">
          <p className="text-sm font-medium text-muted-foreground">Серия А 2026/27</p>
          <h1 className="text-3xl font-semibold leading-tight text-foreground sm:text-4xl">
            Клубы Серии А
          </h1>
          <p className="text-base leading-7 text-muted-foreground">
            Минимальная база клубов текущего сезона из сохранённых данных.
          </p>
        </div>
        <ClubsList clubs={clubs} />
      </Container>
    </section>
  );
}
