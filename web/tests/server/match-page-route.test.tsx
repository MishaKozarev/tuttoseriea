import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCurrentSerieAMatchPageData: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/src/db", () => ({ getDbPool: vi.fn(() => ({ query: vi.fn() })) }));
vi.mock("@/src/football/match-page-repository", () => ({
  getCurrentSerieAMatchPageData: mocks.getCurrentSerieAMatchPageData,
}));
vi.mock("next/navigation", () => ({ notFound: mocks.notFound }));

import MatchDetailPage, {
  generateMetadata,
} from "@/app/(public)/matches/[slug]/page";
import { matchPageFixture } from "@/tests/fixtures/match-page";

describe("Match detail route", () => {
  it("renders a current Match and builds canonical indexable metadata", async () => {
    mocks.getCurrentSerieAMatchPageData.mockResolvedValue(matchPageFixture());

    await expect(
      MatchDetailPage({ params: Promise.resolve({ slug: "ac-milan-inter-12345" }) }),
    ).resolves.toBeTruthy();
    await expect(
      generateMetadata({ params: Promise.resolve({ slug: "ac-milan-inter-12345" }) }),
    ).resolves.toMatchObject({
      title: "Милан — Интер",
      alternates: { canonical: "/matches/ac-milan-inter-12345" },
      robots: { index: true, follow: true },
    });
  });

  it("returns the Next.js not-found boundary for an unknown or out-of-scope slug", async () => {
    mocks.getCurrentSerieAMatchPageData.mockResolvedValue(null);

    await expect(
      MatchDetailPage({ params: Promise.resolve({ slug: "not-a-real-match" }) }),
    ).rejects.toThrow("NEXT_NOT_FOUND");
    expect(mocks.notFound).toHaveBeenCalled();
  });
});
