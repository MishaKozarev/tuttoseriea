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
  season_id: "season-1",
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
  home_id: "club-home",
  home_slug: "ac-milan-489",
  home_provider_name: "AC Milan",
  home_name_ru: "Милан",
  home_name_ru_review_status: "reviewed",
  home_code: "MIL",
  home_logo_url: null,
  away_id: "club-away",
  away_slug: "inter-505",
  away_provider_name: "Inter",
  away_name_ru: "Интер",
  away_name_ru_review_status: "unreviewed",
  away_code: "INT",
  away_logo_url: null,
};

const eventRows = [
  {
    event_id: "event-1",
    provider_order: 0,
    elapsed: 68,
    extra: null,
    club_id: "club-home",
    provider_player_id: 17,
    provider_player_name: "Christian Pulisic",
    player_id: "player-17",
    player_slug: "c-pulisic-17",
    player_provider_name: "Christian Pulisic",
    player_name_ru: "Кристиан Пулишич",
    player_name_ru_review_status: "reviewed",
    provider_related_player_id: 18,
    provider_related_player_name: "Incoming Player",
    related_player_id: null,
    related_player_slug: null,
    related_player_provider_name: null,
    related_player_name_ru: null,
    related_player_name_ru_review_status: null,
    provider_type: "subst",
    provider_detail: "Substitution 1",
    comments: null,
  },
  {
    event_id: "event-2",
    provider_order: 1,
    elapsed: 90,
    extra: 6,
    club_id: "club-away",
    provider_player_id: 20,
    provider_player_name: "Resolved Player",
    player_id: "player-20",
    player_slug: null,
    player_provider_name: "Resolved Player",
    player_name_ru: null,
    player_name_ru_review_status: null,
    provider_related_player_id: null,
    provider_related_player_name: null,
    related_player_id: null,
    related_player_slug: null,
    related_player_provider_name: null,
    related_player_name_ru: null,
    related_player_name_ru_review_status: null,
    provider_type: "Goal",
    provider_detail: "Normal Goal",
    comments: "Provider comment",
  },
];

const lineupRows = [
  {
    lineup_id: "lineup-home",
    club_id: "club-home",
    formation: "4-3-3",
    provider_coach_name: "Home Coach",
    entry_id: "entry-home-starter",
    role: "starter",
    provider_order: 0,
    provider_player_id: 17,
    provider_player_name: "Christian Pulisic",
    player_id: "player-17",
    player_slug: "c-pulisic-17",
    player_provider_name: "Christian Pulisic",
    player_name_ru: "Кристиан Пулишич",
    player_name_ru_review_status: "reviewed",
    shirt_number: 11,
    provider_position: "M",
  },
  {
    lineup_id: "lineup-home",
    club_id: "club-home",
    formation: "4-3-3",
    provider_coach_name: "Home Coach",
    entry_id: "entry-home-substitute",
    role: "substitute",
    provider_order: 0,
    provider_player_id: 18,
    provider_player_name: "Incoming Player",
    player_id: null,
    player_slug: null,
    player_provider_name: null,
    player_name_ru: null,
    player_name_ru_review_status: null,
    shirt_number: null,
    provider_position: null,
  },
  {
    lineup_id: "lineup-away",
    club_id: "club-away",
    formation: null,
    provider_coach_name: null,
    entry_id: null,
    role: null,
    provider_order: null,
    provider_player_id: null,
    provider_player_name: null,
    player_id: null,
    player_slug: null,
    player_provider_name: null,
    player_name_ru: null,
    player_name_ru_review_status: null,
    shirt_number: null,
    provider_position: null,
  },
];

const statisticRows = [
  {
    statistics_id: "statistics-home",
    club_id: "club-home",
    scope: "full_match",
    item_id: "statistic-home-1",
    provider_type: "Shots on Goal",
    provider_value: 0,
    provider_order: 0,
  },
  {
    statistics_id: "statistics-home",
    club_id: "club-home",
    scope: "full_match",
    item_id: "statistic-home-2",
    provider_type: "Shots on Goal",
    provider_value: null,
    provider_order: 1,
  },
  {
    statistics_id: "statistics-away",
    club_id: "club-away",
    scope: "full_match",
    item_id: "statistic-away-1",
    provider_type: "Ball Possession",
    provider_value: "49%",
    provider_order: 0,
  },
];

function pageDatabase(options: {
  matchRows?: unknown[];
  events?: unknown[];
  lineups?: unknown[];
  statistics?: unknown[];
} = {}) {
  const query = vi.fn(async (sql: string) => {
    if (sql.includes("from football.match_events")) {
      const rows = options.events ?? eventRows;
      return { rows, rowCount: rows.length };
    }

    if (sql.includes("from football.match_lineups")) {
      const rows = options.lineups ?? lineupRows;
      return { rows, rowCount: rows.length };
    }

    if (sql.includes("from football.match_statistics")) {
      const rows = options.statistics ?? statisticRows;
      return { rows, rowCount: rows.length };
    }

    const rows = options.matchRows ?? [matchRow];
    return { rows, rowCount: rows.length };
  });

  return { pool: { query } as unknown as Pool, query };
}

function database(rows: unknown[]) {
  const query = vi.fn(async (_sql: string, _values?: readonly unknown[]) => {
    void _sql;
    void _values;

    return { rows, rowCount: rows.length };
  });
  return { pool: { query } as unknown as Pool, query };
}

describe("Match Page read model", () => {
  it("loads the base Match and all persisted sections with four fixed queries", async () => {
    const db = pageDatabase();

    const result = await getCurrentSerieAMatchPageData(db.pool, "ac-milan-inter-12345");

    expect(result).toMatchObject({
      match: {
        id: "match-1",
        slug: "ac-milan-inter-12345",
        score: { home: 2, away: 1 },
        halftimeScore: { home: 1, away: 0 },
      },
      competition: { displayName: "Серия А" },
      season: { id: "season-1", displayLabel: "2026/27" },
      homeClub: { id: "club-home", slug: "ac-milan-489", displayName: "Милан" },
      awayClub: { id: "club-away", slug: "inter-505", displayName: "Inter" },
      events: [
        {
          id: "event-1",
          providerOrder: 0,
          player: { resolvedPlayerId: "player-17", publicSlug: "c-pulisic-17" },
          relatedPlayer: {
            resolvedPlayerId: null,
            displayName: "Incoming Player",
            publicSlug: null,
          },
        },
        {
          id: "event-2",
          providerOrder: 1,
          extra: 6,
          player: { resolvedPlayerId: "player-20", publicSlug: null },
        },
      ],
      lineups: [
        {
          id: "lineup-home",
          formation: "4-3-3",
          starters: [{ id: "entry-home-starter", providerOrder: 0 }],
          substitutes: [{ id: "entry-home-substitute", providerOrder: 0 }],
        },
        {
          id: "lineup-away",
          formation: null,
          starters: [],
          substitutes: [],
        },
      ],
      statistics: [
        {
          id: "statistics-home",
          items: [
            { providerOrder: 0, providerType: "Shots on Goal", providerValue: 0 },
            { providerOrder: 1, providerType: "Shots on Goal", providerValue: null },
          ],
        },
        {
          id: "statistics-away",
          items: [{ providerType: "Ball Possession", providerValue: "49%" }],
        },
      ],
    });
    expect(result?.match.kickoffAt).toBeInstanceOf(Date);
    expect(result?.match.kickoffAt?.toISOString()).toBe("2026-11-08T19:45:00.000Z");
    expect(db.query).toHaveBeenCalledTimes(4);

    const calls = db.query.mock.calls as unknown as [string, unknown[]][];
    expect(calls[0]?.[1]).toEqual(["api-football", 135, 2026, "ac-milan-inter-12345"]);
    expect(calls[1]?.[0]).toContain("order by me.provider_order");
    expect(calls[1]?.[1]).toEqual(["match-1", "season-1", "api-football"]);
    expect(calls[2]?.[0]).toContain("with eligible_players as");
    expect(calls[2]?.[0]).toContain("player.provider = $3");
    expect(calls[2]?.[0]).toContain("left join football.match_lineup_entries");
    expect(calls[2]?.[1]).toEqual(["match-1", "season-1", "api-football"]);
    expect(calls[3]?.[0]).toContain("statistics.scope = 'full_match'");
    expect(calls.every(([sql]) => !sql.includes("provider_raw"))).toBe(true);
    expect(calls.every(([sql]) => !sql.includes("observed_at"))).toBe(true);
  });

  it("returns null before section queries for an unknown or out-of-scope slug", async () => {
    const db = pageDatabase({ matchRows: [] });

    await expect(
      getCurrentSerieAMatchPageData(db.pool, "not-a-real-match"),
    ).resolves.toBeNull();
    expect(db.query).toHaveBeenCalledTimes(1);
  });

  it("preserves nullable base facts and supports completely absent sections", async () => {
    const db = pageDatabase({
      matchRows: [{
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
      }],
      events: [],
      lineups: [],
      statistics: [],
    });

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
      events: [],
      lineups: [],
      statistics: [],
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
