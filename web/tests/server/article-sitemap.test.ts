import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ entries: vi.fn(), clubs: vi.fn(), players: vi.fn(), matches: vi.fn(), pool: {} }));
vi.mock("server-only", () => ({}));
vi.mock("@/src/db", () => ({ getDbPool: () => mocks.pool }));
vi.mock("@/src/articles/public-repository", () => ({ listPublishedArticleSitemapEntries: mocks.entries }));
vi.mock("@/src/football/club-page-repository", () => ({ listCurrentSerieAClubSlugs: mocks.clubs }));
vi.mock("@/src/football/player-page-repository", () => ({ listCurrentSerieAEligiblePlayerSlugs: mocks.players }));
vi.mock("@/src/football/match-page-repository", () => ({ listCurrentSerieAMatchSlugs: mocks.matches }));
import sitemap, { dynamic } from "@/app/sitemap";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.entries.mockResolvedValue([{ slug: "published-stable-slug", updatedAt: "2026-11-05T10:15:00.000Z" }]);
  mocks.clubs.mockResolvedValue(["milan"]); mocks.players.mockResolvedValue([]); mocks.matches.mockResolvedValue([]);
});
afterEach(() => vi.unstubAllEnvs());

describe("Article sitemap route", () => {
  it("passes publication update times through the actual sitemap loader", async () => {
    vi.stubEnv("AUTH_URL", "https://tuttoseriea.com");
    const result = await sitemap();
    expect(result.find(entry => entry.url.endsWith("/articles/published-stable-slug"))).toEqual({
      url: "https://tuttoseriea.com/articles/published-stable-slug", lastModified: "2026-11-05T10:15:00.000Z",
    });
    expect(mocks.entries).toHaveBeenCalledWith(mocks.pool);
    expect(result.find(entry => entry.url.endsWith("/clubs/milan"))).toEqual({ url: "https://tuttoseriea.com/clubs/milan" });
    expect(dynamic).toBe("force-dynamic");
  });
  it("skips Article sitemap reads on staging while retaining Football URLs", async () => {
    vi.stubEnv("AUTH_URL", "https://staging.tuttoseriea.com");
    const result = await sitemap();
    expect(result.some(entry => entry.url.includes("/articles"))).toBe(false);
    expect(mocks.entries).not.toHaveBeenCalled();
    expect(result.map(entry => entry.url)).toContain("https://staging.tuttoseriea.com/clubs/milan");
  });
});
