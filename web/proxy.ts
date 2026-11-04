import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { getDbPool } from "@/src/db";
import { currentSerieAClubSlugExists } from "@/src/football/club-page-repository";
import { currentSerieAMatchSlugExists } from "@/src/football/match-page-repository";
import { currentSerieAPlayerSlugExists } from "@/src/football/player-page-repository";
import { isMediaOptimizerTarget } from "@/src/media/optimizer";
import { publicArticlePageExists, publicArticleSlugExists } from "@/src/articles/public-repository";
import { parsePublicArticlePage } from "@/src/articles/public-contract";

const CLUB_PATH_PREFIX = "/clubs/";
const MATCH_PATH_PREFIX = "/matches/";
const PLAYER_PATH_PREFIX = "/players/";
const ARTICLE_PATH_PREFIX = "/articles/";

export async function proxy(request: NextRequest): Promise<NextResponse> {
  const pathname = request.nextUrl.pathname;
  if (pathname.startsWith("/_next/image")) {
    // Run before the independent optimizer cache; other image sources keep
    // their existing Next behavior, including its validation and caching.
    if (isMediaOptimizerTarget(request.url, process.env.AUTH_URL)) return new NextResponse(null, { status: 404, headers: {
      "Cache-Control": "private, no-store, max-age=0, must-revalidate", "Cloudflare-CDN-Cache-Control": "no-store",
    } });
    return NextResponse.next();
  }
  const pool = getDbPool();
  let exists: boolean;

  if (pathname === "/articles") {
    const page = parsePublicArticlePage(request.nextUrl.searchParams);
    exists = page !== null && await publicArticlePageExists(pool, page);
  } else if (pathname.startsWith(ARTICLE_PATH_PREFIX)) {
    exists = await publicArticleSlugExists(pool, pathname.slice(ARTICLE_PATH_PREFIX.length));
  } else if (pathname.startsWith(CLUB_PATH_PREFIX)) {
    exists = await currentSerieAClubSlugExists(
      pool,
      pathname.slice(CLUB_PATH_PREFIX.length),
    );
  } else if (pathname.startsWith(PLAYER_PATH_PREFIX)) {
    exists = await currentSerieAPlayerSlugExists(
      pool,
      pathname.slice(PLAYER_PATH_PREFIX.length),
    );
  } else {
    exists = await currentSerieAMatchSlugExists(
      pool,
      pathname.slice(MATCH_PATH_PREFIX.length),
    );
  }

  return exists ? NextResponse.next() : NextResponse.next({ status: 404 });
}

export const config = {
  matcher: ["/articles", "/articles/:slug", "/clubs/:slug", "/players/:slug", "/matches/:slug", "/_next/image(.*)"],
};
