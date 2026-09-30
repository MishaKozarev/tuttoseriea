import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";

import { PlayerPage } from "@/components/football/player-page";
import { Container } from "@/components/layout/container";
import { getDbPool } from "@/src/db";
import { getCurrentSerieAPlayerPageData } from "@/src/football/player-page-repository";
import { buildPlayerMetadata } from "@/src/seo/site";

export const dynamic = "force-dynamic";

type PlayerPageProps = {
  params: Promise<{ slug: string }>;
};

const getPlayerPageData = cache((slug: string) =>
  getCurrentSerieAPlayerPageData(getDbPool(), slug),
);

async function requirePlayerPageData(slug: string) {
  const data = await getPlayerPageData(slug);

  if (!data) {
    notFound();
  }

  return data;
}

export async function generateMetadata({ params }: PlayerPageProps): Promise<Metadata> {
  const { slug } = await params;
  const data = await requirePlayerPageData(slug);

  return buildPlayerMetadata({
    slug: data.player.slug,
    displayName: data.player.displayName,
    seasonLabel: data.season.displayLabel,
  });
}

export default async function PlayerDetailPage({ params }: PlayerPageProps) {
  const { slug } = await params;
  const data = await requirePlayerPageData(slug);

  return (
    <section className="py-8 sm:py-12">
      <Container size="wide">
        <PlayerPage data={data} />
      </Container>
    </section>
  );
}
