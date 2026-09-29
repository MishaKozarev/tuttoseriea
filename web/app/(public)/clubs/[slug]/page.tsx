import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";

import { ClubPage } from "@/components/football/club-page";
import { Container } from "@/components/layout/container";
import { getDbPool } from "@/src/db";
import { getCurrentSerieAClubPageData } from "@/src/football/club-page-repository";
import { buildClubMetadata } from "@/src/seo/site";

export const dynamic = "force-dynamic";

type ClubPageProps = {
  params: Promise<{ slug: string }>;
};

const getClubPageData = cache((slug: string) =>
  getCurrentSerieAClubPageData(getDbPool(), slug),
);

async function requireClubPageData(slug: string) {
  const data = await getClubPageData(slug);

  if (!data) {
    notFound();
  }

  return data;
}

export async function generateMetadata({ params }: ClubPageProps): Promise<Metadata> {
  const { slug } = await params;
  const data = await requireClubPageData(slug);

  return buildClubMetadata({
    slug: data.club.slug,
    displayName: data.club.displayName,
    seasonLabel: data.season.displayLabel,
  });
}

export default async function ClubDetailPage({ params }: ClubPageProps) {
  const { slug } = await params;
  const data = await requireClubPageData(slug);

  return (
    <section className="py-8 sm:py-12">
      <Container size="wide">
        <ClubPage data={data} />
      </Container>
    </section>
  );
}
