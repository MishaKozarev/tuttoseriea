import type { MetadataRoute } from "next";

import { getDbPool } from "@/src/db";
import { listCurrentSerieAClubSlugs } from "@/src/football/club-page-repository";
import { listCurrentSerieAEligiblePlayerSlugs } from "@/src/football/player-page-repository";
import { listCurrentSerieAMatchSlugs } from "@/src/football/match-page-repository";
import { buildSitemap } from "@/src/seo/site";

export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const pool = getDbPool();
  const clubSlugs = await listCurrentSerieAClubSlugs(pool);
  const playerSlugs = await listCurrentSerieAEligiblePlayerSlugs(pool);
  const matchSlugs = await listCurrentSerieAMatchSlugs(pool);

  return buildSitemap(process.env, clubSlugs, playerSlugs, matchSlugs);
}
