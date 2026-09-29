import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCurrentSerieAClubPageData: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/src/db", () => ({ getDbPool: vi.fn(() => ({ query: vi.fn() })) }));
vi.mock("@/src/football/club-page-repository", () => ({
  getCurrentSerieAClubPageData: mocks.getCurrentSerieAClubPageData,
}));
vi.mock("next/navigation", () => ({ notFound: mocks.notFound }));

import ClubDetailPage, {
  generateMetadata,
} from "@/app/(public)/clubs/[slug]/page";
import { clubPageFixture } from "@/tests/fixtures/club-page";

describe("Club detail route", () => {
  it("renders a known club and builds its canonical metadata", async () => {
    mocks.getCurrentSerieAClubPageData.mockResolvedValue(clubPageFixture());

    await expect(
      ClubDetailPage({ params: Promise.resolve({ slug: "ac-milan-489" }) }),
    ).resolves.toBeTruthy();
    await expect(
      generateMetadata({ params: Promise.resolve({ slug: "ac-milan-489-metadata" }) }),
    ).resolves.toMatchObject({
      title: "Милан",
      alternates: { canonical: "/clubs/ac-milan-489" },
    });
  });

  it("returns the Next.js not-found boundary for an unknown slug", async () => {
    mocks.getCurrentSerieAClubPageData.mockResolvedValue(null);

    await expect(
      ClubDetailPage({ params: Promise.resolve({ slug: "unknown-club" }) }),
    ).rejects.toThrow("NEXT_NOT_FOUND");
    expect(mocks.notFound).toHaveBeenCalled();
  });
});
