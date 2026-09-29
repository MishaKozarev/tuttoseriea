import type { MetadataRoute } from "next";

import { getDbPool } from "@/src/db";
import { listCurrentSerieAClubSlugs } from "@/src/football/club-page-repository";
import { buildSitemap } from "@/src/seo/site";

export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const clubSlugs = await listCurrentSerieAClubSlugs(getDbPool());

  return buildSitemap(process.env, clubSlugs);
}
