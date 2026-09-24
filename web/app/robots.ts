import type { MetadataRoute } from "next";

import { buildRobots } from "@/src/seo/site";

export const dynamic = "force-dynamic";

export default function robots(): MetadataRoute.Robots {
  return buildRobots();
}
