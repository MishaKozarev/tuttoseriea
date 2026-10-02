import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { getDbPool } from "@/src/db";
import { currentSerieAClubSlugExists } from "@/src/football/club-page-repository";
import { currentSerieAMatchSlugExists } from "@/src/football/match-page-repository";
import { currentSerieAPlayerSlugExists } from "@/src/football/player-page-repository";

const CLUB_PATH_PREFIX = "/clubs/";
const MATCH_PATH_PREFIX = "/matches/";
const PLAYER_PATH_PREFIX = "/players/";

export async function proxy(request: NextRequest): Promise<NextResponse> {
  const pathname = request.nextUrl.pathname;
  const pool = getDbPool();
  let exists: boolean;

  if (pathname.startsWith(CLUB_PATH_PREFIX)) {
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
  matcher: ["/clubs/:slug", "/players/:slug", "/matches/:slug"],
};
