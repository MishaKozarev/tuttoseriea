import { NextRequest } from "next/server";
import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  currentSerieAClubSlugExists: vi.fn(),
  pool: { query: vi.fn() },
}));

vi.mock("server-only", () => ({}));
vi.mock("@/src/db", () => ({ getDbPool: vi.fn(() => mocks.pool) }));
vi.mock("@/src/football/club-page-repository", () => ({
  currentSerieAClubSlugExists: mocks.currentSerieAClubSlugExists,
}));

import { config, proxy } from "@/proxy";

describe("Club Page proxy", () => {
  it("continues a known current Club route normally", async () => {
    mocks.currentSerieAClubSlugExists.mockResolvedValue(true);

    const response = await proxy(
      new NextRequest("https://tuttoseriea.com/clubs/ac-milan-489"),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(mocks.currentSerieAClubSlugExists).toHaveBeenCalledWith(
      mocks.pool,
      "ac-milan-489",
    );
  });

  it("sets a real 404 before an unknown Club route starts streaming", async () => {
    mocks.currentSerieAClubSlugExists.mockResolvedValue(false);

    const response = await proxy(
      new NextRequest("https://tuttoseriea.com/clubs/unknown-club"),
    );

    expect(response.status).toBe(404);
    expect(response.headers.get("x-middleware-next")).toBe("1");
  });

  it("matches one Club slug segment only", () => {
    expect(config).toEqual({ matcher: "/clubs/:slug" });
    expect(
      unstable_doesMiddlewareMatch({
        config,
        nextConfig: {},
        url: "/clubs/ac-milan-489",
      }),
    ).toBe(true);
    expect(
      unstable_doesMiddlewareMatch({
        config,
        nextConfig: {},
        url: "/clubs",
      }),
    ).toBe(false);
    expect(
      unstable_doesMiddlewareMatch({
        config,
        nextConfig: {},
        url: "/clubs/ac-milan-489/extra",
      }),
    ).toBe(false);
  });
});
