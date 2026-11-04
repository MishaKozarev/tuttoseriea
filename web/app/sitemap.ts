import type { MetadataRoute } from "next";

import { getDbPool } from "@/src/db";
import { listCurrentSerieAClubSlugs } from "@/src/football/club-page-repository";
import { listCurrentSerieAEligiblePlayerSlugs } from "@/src/football/player-page-repository";
import { listCurrentSerieAMatchSlugs } from "@/src/football/match-page-repository";
import { listPublishedArticleSlugs } from "@/src/articles/public-repository";
import { buildSitemap, isArticleIndexingEnabled } from "@/src/seo/site";

export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const pool = getDbPool();
  const clubSlugs = await listCurrentSerieAClubSlugs(pool);
  const playerSlugs = await listCurrentSerieAEligiblePlayerSlugs(pool);
  const matchSlugs = await listCurrentSerieAMatchSlugs(pool);
  const articleSlugs = isArticleIndexingEnabled() ? await listPublishedArticleSlugs(pool) : [];

  return buildSitemap(process.env, clubSlugs, playerSlugs, matchSlugs, articleSlugs);
}
