import type { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  currentSerieAPlayerSlugExists,
  getCurrentSerieAPlayerPageData,
  listCurrentSerieAEligiblePlayerSlugs,
} from "@/src/football/player-page-repository";

const scopeRow = {
  id: "player-1",
  slug: "rafael-leao-276",
  provider_name: "Rafael Leao",
  name_ru: "Рафаэл Леау",
  name_ru_review_status: "reviewed",
  firstname: "Rafael",
  lastname: "Leão",
  age: 27,
  birth_date: "1999-06-10",
  birth_place: "Almada",
  birth_country: "Portugal",
  nationality: "Portugal",
  height: "188 cm",
  weight: "81 kg",
  injured: false,
  provider_photo_url: null,
  season_id: "season-2026",
  season_display_label: "2026/27",
  competition_provider_name: "Serie A",
  competition_name_ru: "Серия А",
  competition_name_ru_review_status: "unreviewed",
};

const membershipRow = {
  membership_id: "membership-1",
  shirt_number: 10,
  position: "Attacker",
  club_id: "club-1",
  club_slug: "ac-milan-489",
  club_provider_name: "AC Milan",
  club_name_ru: "Милан",
  club_name_ru_review_status: "reviewed",
  club_logo_url: null,
};

const statisticsRow = {
  statistics_id: "statistics-1",
  club_id: "club-2",
  club_slug: "inter-505",
  club_provider_name: "Inter",
  club_name_ru: "Интер",
  club_name_ru_review_status: "unreviewed",
  club_logo_url: null,
  appearances: 0,
  lineups: null,
  minutes: null,
  rating: null,
  shots_total: null,
  shots_on: null,
  goals_total: 0,
  goals_assists: 0,
  passes_total: null,
  passes_key: null,
  passes_accuracy: null,
  tackles_total: null,
  tackles_blocks: null,
  tackles_interceptions: null,
  cards_yellow: 0,
  cards_yellow_red: 0,
  cards_red: 0,
};

function database(options: {
  scope?: unknown[];
  memberships?: unknown[];
  statistics?: unknown[];
  slugs?: unknown[];
} = {}) {
  const query = vi.fn(async (sql: string, values?: readonly unknown[]) => {
    void values;
    if (sql.includes("select p.slug") && !sql.includes("p.slug = $4")) {
      return { rows: options.slugs ?? [{ slug: "player-one-1" }] };
    }
    if (sql.includes("from football.players p")) {
      return { rows: options.scope ?? [scopeRow] };
    }
    if (sql.includes("from football.squad_memberships sm")) {
      return { rows: options.memberships ?? [membershipRow] };
    }
    if (sql.includes("from football.player_statistics ps")) {
      return { rows: options.statistics ?? [statisticsRow] };
    }

    throw new Error(`Unexpected Player Page query: ${sql}`);
  });

  return { pool: { query } as unknown as Pool, query };
}

describe("Player Page repository", () => {
  it("returns an eligible membership-only player with three fixed queries", async () => {
    const db = database({ statistics: [] });

    const result = await getCurrentSerieAPlayerPageData(
      db.pool,
      "rafael-leao-276",
    );

    expect(result).toMatchObject({
      player: { displayName: "Рафаэл Леау" },
      competition: { displayName: "Serie A" },
      memberships: [{ club: { displayName: "Милан" } }],
      statistics: [],
    });
    expect(db.query).toHaveBeenCalledTimes(3);
  });

  it("returns a statistics-only player without inferring a current membership", async () => {
    const db = database({ memberships: [] });

    const result = await getCurrentSerieAPlayerPageData(
      db.pool,
      "rafael-leao-276",
    );

    expect(result?.memberships).toEqual([]);
    expect(result?.statistics).toEqual([
      expect.objectContaining({
        club: expect.objectContaining({ displayName: "Inter" }),
        appearances: 0,
        minutes: null,
      }),
    ]);
  });

  it("returns null for an unknown or stale player without related reads", async () => {
    const db = database({ scope: [] });

    await expect(
      getCurrentSerieAPlayerPageData(db.pool, "stale-player-1"),
    ).resolves.toBeNull();
    expect(db.query).toHaveBeenCalledTimes(1);
  });

  it("uses the exact Serie A scope and independent membership/statistics eligibility", async () => {
    const db = database();

    await getCurrentSerieAPlayerPageData(db.pool, "rafael-leao-276");

    const [sql, values] = db.query.mock.calls[0] as [string, readonly unknown[]];
    expect(values).toEqual(["api-football", 135, 2026, "rafael-leao-276"]);
    expect(sql).toContain("from football.squad_memberships eligible_sm");
    expect(sql).toContain("from football.player_statistics eligible_ps");
    expect(sql).toContain("or exists");
  });

  it("keeps multiple memberships and multiple per-club statistics rows separate", async () => {
    const db = database({
      memberships: [membershipRow, { ...membershipRow, membership_id: "membership-2" }],
      statistics: [statisticsRow, { ...statisticsRow, statistics_id: "statistics-2" }],
    });

    const result = await getCurrentSerieAPlayerPageData(
      db.pool,
      "rafael-leao-276",
    );

    expect(result?.memberships).toHaveLength(2);
    expect(result?.statistics).toHaveLength(2);
  });

  it("lists eligible sitemap slugs in the explicit current scope", async () => {
    const db = database({
      slugs: [{ slug: "membership-only-1" }, { slug: "statistics-only-2" }],
    });

    await expect(listCurrentSerieAEligiblePlayerSlugs(db.pool)).resolves.toEqual([
      "membership-only-1",
      "statistics-only-2",
    ]);
    expect(db.query.mock.calls[0]?.[1]).toEqual(["api-football", 135, 2026]);
  });

  it("checks existence with the same eligibility rule", async () => {
    const known = database();
    const stale = database({ scope: [] });

    await expect(
      currentSerieAPlayerSlugExists(known.pool, "rafael-leao-276"),
    ).resolves.toBe(true);
    await expect(
      currentSerieAPlayerSlugExists(stale.pool, "stale-player-1"),
    ).resolves.toBe(false);
  });
});
