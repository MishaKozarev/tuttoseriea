import { NextRequest } from "next/server";
import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  currentSerieAClubSlugExists: vi.fn(),
  currentSerieAMatchSlugExists: vi.fn(),
  currentSerieAPlayerSlugExists: vi.fn(),
  pool: { query: vi.fn() },
}));

vi.mock("server-only", () => ({}));
vi.mock("@/src/db", () => ({ getDbPool: vi.fn(() => mocks.pool) }));
vi.mock("@/src/football/club-page-repository", () => ({
  currentSerieAClubSlugExists: mocks.currentSerieAClubSlugExists,
}));
vi.mock("@/src/football/player-page-repository", () => ({
  currentSerieAPlayerSlugExists: mocks.currentSerieAPlayerSlugExists,
}));
vi.mock("@/src/football/match-page-repository", () => ({
  currentSerieAMatchSlugExists: mocks.currentSerieAMatchSlugExists,
}));

import { config, proxy } from "@/proxy";

describe("Football detail Page proxy", () => {
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

  it("continues an eligible Player route normally", async () => {
    mocks.currentSerieAPlayerSlugExists.mockResolvedValue(true);

    const response = await proxy(
      new NextRequest("https://tuttoseriea.com/players/rafael-leao-276"),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(mocks.currentSerieAPlayerSlugExists).toHaveBeenCalledWith(
      mocks.pool,
      "rafael-leao-276",
    );
  });

  it("sets a real 404 for unknown and stale Player routes", async () => {
    mocks.currentSerieAPlayerSlugExists.mockResolvedValue(false);

    const response = await proxy(
      new NextRequest("https://tuttoseriea.com/players/stale-player-1"),
    );

    expect(response.status).toBe(404);
    expect(response.headers.get("x-middleware-next")).toBe("1");
  });

  it("continues a known current Match route normally", async () => {
    mocks.currentSerieAMatchSlugExists.mockResolvedValue(true);

    const response = await proxy(
      new NextRequest("https://tuttoseriea.com/matches/ac-milan-inter-12345"),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(mocks.currentSerieAMatchSlugExists).toHaveBeenCalledWith(
      mocks.pool,
      "ac-milan-inter-12345",
    );
  });

  it("sets a real 404 before an unknown Match route starts streaming", async () => {
    mocks.currentSerieAMatchSlugExists.mockResolvedValue(false);

    const response = await proxy(
      new NextRequest("https://tuttoseriea.com/matches/not-a-real-match"),
    );

    expect(response.status).toBe(404);
    expect(response.headers.get("x-middleware-next")).toBe("1");
  });

  it("matches exactly one Club, Player or Match slug segment", () => {
    expect(config).toEqual({
      matcher: ["/clubs/:slug", "/players/:slug", "/matches/:slug"],
    });
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
    expect(
      unstable_doesMiddlewareMatch({
        config,
        nextConfig: {},
        url: "/players/rafael-leao-276",
      }),
    ).toBe(true);
    expect(
      unstable_doesMiddlewareMatch({
        config,
        nextConfig: {},
        url: "/players",
      }),
    ).toBe(false);
    expect(
      unstable_doesMiddlewareMatch({
        config,
        nextConfig: {},
        url: "/players/rafael-leao-276/extra",
      }),
    ).toBe(false);
    expect(
      unstable_doesMiddlewareMatch({
        config,
        nextConfig: {},
        url: "/matches/ac-milan-inter-12345",
      }),
    ).toBe(true);
    expect(
      unstable_doesMiddlewareMatch({
        config,
        nextConfig: {},
        url: "/matches",
      }),
    ).toBe(false);
    expect(
      unstable_doesMiddlewareMatch({
        config,
        nextConfig: {},
        url: "/matches/ac-milan-inter-12345/extra",
      }),
    ).toBe(false);
  });
});
