import type { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  currentSerieAMatchSlugExists,
  getCurrentSerieAMatchPageData,
  listCurrentSerieAMatchSlugs,
} from "@/src/football/match-page-repository";

const matchRow = {
  id: "match-1",
  slug: "ac-milan-inter-12345",
  provider_fixture_id: 12345,
  round: "Regular Season - 12",
  kickoff_at: new Date("2026-11-08T19:45:00.000Z"),
  status: "finished",
  provider_status_long: "Match Finished",
  provider_status_short: "FT",
  status_elapsed: 90,
  status_extra: null,
  home_goals: 2,
  away_goals: 1,
  halftime_home: 1,
  halftime_away: 0,
  fulltime_home: 2,
  fulltime_away: 1,
  extratime_home: null,
  extratime_away: null,
  penalty_home: null,
  penalty_away: null,
  venue_name: "San Siro",
  venue_city: "Milano",
  referee: "Marco Rossi",
  competition_provider_name: "Serie A",
  competition_name_ru: "Серия А",
  competition_name_ru_review_status: "reviewed",
  season_display_label: "2026/27",
  home_slug: "ac-milan-489",
  home_provider_name: "AC Milan",
  home_name_ru: "Милан",
  home_name_ru_review_status: "reviewed",
  home_code: "MIL",
  home_logo_url: null,
  away_slug: "inter-505",
  away_provider_name: "Inter",
  away_name_ru: "Интер",
  away_name_ru_review_status: "unreviewed",
  away_code: "INT",
  away_logo_url: null,
};

function database(rows: unknown[] = [matchRow]) {
  const query = vi.fn(async (sql: string, values?: readonly unknown[]) => {
    void sql;
    void values;

    return { rows, rowCount: rows.length };
  });

  return { pool: { query } as unknown as Pool, query };
}

describe("Match Page read model", () => {
  it("loads one current Serie A Match with both Club identities in one query", async () => {
    const db = database();

    const result = await getCurrentSerieAMatchPageData(
      db.pool,
      "ac-milan-inter-12345",
    );

    expect(result).toMatchObject({
      match: {
        id: "match-1",
        slug: "ac-milan-inter-12345",
        score: { home: 2, away: 1 },
        halftimeScore: { home: 1, away: 0 },
      },
      competition: { displayName: "Серия А" },
      homeClub: { slug: "ac-milan-489", displayName: "Милан" },
      awayClub: { slug: "inter-505", displayName: "Inter" },
    });
    expect(result?.match.kickoffAt).toBeInstanceOf(Date);
    expect(result?.match.kickoffAt?.toISOString()).toBe(
      "2026-11-08T19:45:00.000Z",
    );
    expect(db.query).toHaveBeenCalledTimes(1);
    const [sql, values] = db.query.mock.calls[0] as unknown as [string, unknown[]];
    expect(sql).toContain("join football.clubs home");
    expect(sql).toContain("join football.clubs away");
    expect(sql).not.toContain("provider_raw");
    expect(values).toEqual(["api-football", 135, 2026, "ac-milan-inter-12345"]);
  });

  it("returns null for an unknown or out-of-scope slug", async () => {
    const db = database([]);

    await expect(
      getCurrentSerieAMatchPageData(db.pool, "not-a-real-match"),
    ).resolves.toBeNull();
    expect(db.query).toHaveBeenCalledTimes(1);
  });

  it("preserves nullable kickoff, score phases and optional details", async () => {
    const db = database([
      {
        ...matchRow,
        kickoff_at: null,
        home_goals: null,
        away_goals: null,
        halftime_home: null,
        halftime_away: null,
        fulltime_home: null,
        fulltime_away: null,
        venue_name: null,
        venue_city: null,
        referee: null,
      },
    ]);

    await expect(
      getCurrentSerieAMatchPageData(db.pool, "ac-milan-inter-12345"),
    ).resolves.toMatchObject({
      match: {
        kickoffAt: null,
        score: { home: null, away: null },
        halftimeScore: { home: null, away: null },
        fulltimeScore: { home: null, away: null },
        venueName: null,
        venueCity: null,
        referee: null,
      },
    });
  });

  it("checks eligibility and lists sitemap slugs in the exact same scope", async () => {
    const existsDb = database([{ slug: "ac-milan-inter-12345" }]);
    const sitemapDb = database([
      { slug: "ac-milan-inter-12345" },
      { slug: "juventus-roma-12346" },
    ]);

    await expect(
      currentSerieAMatchSlugExists(existsDb.pool, "ac-milan-inter-12345"),
    ).resolves.toBe(true);
    await expect(listCurrentSerieAMatchSlugs(sitemapDb.pool)).resolves.toEqual([
      "ac-milan-inter-12345",
      "juventus-roma-12346",
    ]);
    expect(existsDb.query.mock.calls[0]?.[1]).toEqual([
      "api-football",
      135,
      2026,
      "ac-milan-inter-12345",
    ]);
    expect(sitemapDb.query.mock.calls[0]?.[1]).toEqual([
      "api-football",
      135,
      2026,
    ]);
    const sitemapSql = String(sitemapDb.query.mock.calls[0]?.[0]);
    expect(sitemapSql).not.toContain("m.status");
    expect(new Set(await listCurrentSerieAMatchSlugs(sitemapDb.pool)).size).toBe(2);
  });
});
