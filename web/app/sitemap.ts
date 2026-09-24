import type { MetadataRoute } from "next";

import { buildSitemap } from "@/src/seo/site";

export const dynamic = "force-dynamic";

export default function sitemap(): MetadataRoute.Sitemap {
  return buildSitemap();
}
