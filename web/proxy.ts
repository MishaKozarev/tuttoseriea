import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { getDbPool } from "@/src/db";
import { currentSerieAClubSlugExists } from "@/src/football/club-page-repository";

const CLUB_PATH_PREFIX = "/clubs/";

export async function proxy(request: NextRequest): Promise<NextResponse> {
  const slug = request.nextUrl.pathname.slice(CLUB_PATH_PREFIX.length);
  const exists = await currentSerieAClubSlugExists(getDbPool(), slug);

  return exists ? NextResponse.next() : NextResponse.next({ status: 404 });
}

export const config = {
  matcher: "/clubs/:slug",
};
