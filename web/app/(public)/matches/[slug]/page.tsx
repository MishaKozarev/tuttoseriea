import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";

import { MatchPage } from "@/components/football/match-page";
import { Container } from "@/components/layout/container";
import { getDbPool } from "@/src/db";
import { getCurrentSerieAMatchPageData } from "@/src/football/match-page-repository";
import { buildMatchMetadata } from "@/src/seo/site";

export const dynamic = "force-dynamic";

type MatchPageProps = {
  params: Promise<{ slug: string }>;
};

const getMatchPageData = cache((slug: string) =>
  getCurrentSerieAMatchPageData(getDbPool(), slug),
);

async function requireMatchPageData(slug: string) {
  const data = await getMatchPageData(slug);

  if (!data) {
    notFound();
  }

  return data;
}

export async function generateMetadata({ params }: MatchPageProps): Promise<Metadata> {
  const { slug } = await params;
  const data = await requireMatchPageData(slug);

  return buildMatchMetadata({
    slug: data.match.slug,
    homeClubName: data.homeClub.displayName,
    awayClubName: data.awayClub.displayName,
    competitionName: data.competition.displayName,
    seasonLabel: data.season.displayLabel,
  });
}

export default async function MatchDetailPage({ params }: MatchPageProps) {
  const { slug } = await params;
  const data = await requireMatchPageData(slug);

  return (
    <section className="py-8 sm:py-12">
      <Container size="wide">
        <MatchPage data={data} />
      </Container>
    </section>
  );
}
