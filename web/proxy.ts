import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { getDbPool } from "@/src/db";
import { currentSerieAClubSlugExists } from "@/src/football/club-page-repository";
import { currentSerieAPlayerSlugExists } from "@/src/football/player-page-repository";

const CLUB_PATH_PREFIX = "/clubs/";
const PLAYER_PATH_PREFIX = "/players/";

export async function proxy(request: NextRequest): Promise<NextResponse> {
  const pathname = request.nextUrl.pathname;
  const pool = getDbPool();
  const exists = pathname.startsWith(CLUB_PATH_PREFIX)
    ? await currentSerieAClubSlugExists(pool, pathname.slice(CLUB_PATH_PREFIX.length))
    : await currentSerieAPlayerSlugExists(
        pool,
        pathname.slice(PLAYER_PATH_PREFIX.length),
      );

  return exists ? NextResponse.next() : NextResponse.next({ status: 404 });
}

export const config = {
  matcher: ["/clubs/:slug", "/players/:slug"],
};
