import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCurrentSerieAPlayerPageData: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/src/db", () => ({ getDbPool: vi.fn(() => ({ query: vi.fn() })) }));
vi.mock("@/src/football/player-page-repository", () => ({
  getCurrentSerieAPlayerPageData: mocks.getCurrentSerieAPlayerPageData,
}));
vi.mock("next/navigation", () => ({ notFound: mocks.notFound }));

import PlayerDetailPage, {
  generateMetadata,
} from "@/app/(public)/players/[slug]/page";
import { playerPageFixture } from "@/tests/fixtures/player-page";

describe("Player detail route", () => {
  it("renders an eligible player and builds canonical metadata", async () => {
    mocks.getCurrentSerieAPlayerPageData.mockResolvedValue(playerPageFixture());

    await expect(
      PlayerDetailPage({ params: Promise.resolve({ slug: "rafael-leao-276" }) }),
    ).resolves.toBeTruthy();
    await expect(
      generateMetadata({ params: Promise.resolve({ slug: "rafael-leao-276" }) }),
    ).resolves.toMatchObject({
      title: "Рафаэл Леау",
      alternates: { canonical: "/players/rafael-leao-276" },
    });
  });

  it("returns the Next.js not-found boundary for unknown and stale slugs", async () => {
    mocks.getCurrentSerieAPlayerPageData.mockResolvedValue(null);

    await expect(
      PlayerDetailPage({ params: Promise.resolve({ slug: "stale-player-1" }) }),
    ).rejects.toThrow("NEXT_NOT_FOUND");
    expect(mocks.notFound).toHaveBeenCalled();
  });
});
