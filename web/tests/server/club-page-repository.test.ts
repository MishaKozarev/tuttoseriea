import type { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  currentSerieAClubSlugExists,
  getCurrentSerieAClubPageData,
  listCurrentSerieAClubSlugs,
} from "@/src/football/club-page-repository";

const scopeRow = {
  id: "club-1",
  slug: "ac-milan-489",
  provider_name: "AC Milan",
  name_ru: "Милан",
  name_ru_review_status: "reviewed",
  code: "MIL",
  country: "Italy",
  founded: 1899,
  provider_logo_url: null,
  season_id: "season-2026",
  season_display_label: "2026/27",
  competition_provider_name: "Serie A",
  competition_name_ru: "Серия А",
  competition_name_ru_review_status: "unreviewed",
};

const matchRow = {
  id: "match-1",
  provider_fixture_id: 1001,
  round: "Regular Season - 1",
  kickoff_at: new Date("2026-08-22T18:45:00.000Z"),
  status: "finished",
  provider_status_long: "Match Finished",
  provider_status_short: "FT",
  status_elapsed: 90,
  status_extra: null,
  home_goals: 2,
  away_goals: 1,
  home_provider_name: "AC Milan",
  home_name_ru: "Милан",
  home_name_ru_review_status: "reviewed",
  home_code: "MIL",
  home_logo_url: null,
  away_provider_name: "Inter",
  away_name_ru: "Интер",
  away_name_ru_review_status: "unreviewed",
  away_code: "INT",
  away_logo_url: null,
};

function database(options: {
  scope?: unknown[];
  standing?: unknown[];
  recent?: unknown[];
  upcoming?: unknown[];
  squad?: unknown[];
} = {}) {
  const query = vi.fn(async (sql: string, values?: readonly unknown[]) => {
    void values;
    if (sql.includes("and c.slug = $4")) {
      const rows = options.scope ?? [scopeRow];

      return { rows, rowCount: rows.length };
    }

    if (sql.includes("from football.standings")) {
      return { rows: options.standing ?? [] };
    }

    if (sql.includes("m.polling_category = 'TERMINAL'")) {
      return { rows: options.recent ?? [] };
    }

    if (sql.includes("m.polling_category in ('ACTIVE', 'WATCH')")) {
      return { rows: options.upcoming ?? [] };
    }

    if (sql.includes("from football.squad_memberships sm")) {
      return { rows: options.squad ?? [] };
    }

    if (sql.includes("select c.slug")) {
      return { rows: [{ slug: "ac-milan-489" }, { slug: "inter-505" }] };
    }

    throw new Error(`Unexpected Club Page query: ${sql}`);
  });

  return { pool: { query } as unknown as Pool, query };
}

describe("Club Page read model", () => {
  it("loads a known club in the exact current Serie A scope without N+1 reads", async () => {
    const db = database({
      standing: [
        {
          rank: 2,
          points: 61,
          goals_diff: 21,
          form: "WWDLW",
          description: "Champions League league stage",
          played: 28,
          wins: 18,
          draws: 7,
          losses: 3,
          goals_for: 52,
          goals_against: 31,
        },
      ],
      recent: [matchRow],
      upcoming: [{ ...matchRow, id: "match-2", status: "scheduled" }],
      squad: [
        {
          membership_id: "membership-1",
          shirt_number: 10,
          position: "Midfielder",
          player_id: "player-1",
          provider_name: "Player One",
          name_ru: "Игрок Один",
          name_ru_review_status: "reviewed",
          provider_photo_url: null,
          statistics_id: "statistics-1",
          appearances: 25,
          lineups: 22,
          minutes: 1940,
          goals_total: 8,
          goals_assists: 6,
          rating: "7.20",
        },
      ],
    });

    const result = await getCurrentSerieAClubPageData(db.pool, "ac-milan-489");

    expect(result).toMatchObject({
      club: { displayName: "Милан", slug: "ac-milan-489" },
      competition: { displayName: "Serie A" },
      season: { id: "season-2026", displayLabel: "2026/27" },
      standing: { rank: 2, points: 61 },
      recentMatches: [{ homeClub: { displayName: "Милан" }, awayClub: { displayName: "Inter" } }],
      squad: [{ displayName: "Игрок Один", statistics: { appearances: 25, goals: 8 } }],
    });
    expect(db.query).toHaveBeenCalledTimes(5);

    const scopeCall = db.query.mock.calls.find(([sql]) => sql.includes("and c.slug = $4"));
    expect(scopeCall?.[1]).toEqual(["api-football", 135, 2026, "ac-milan-489"]);

    const matchCalls = db.query.mock.calls.filter(([sql]) =>
      sql.includes("from football.matches m"),
    );
    expect(matchCalls).toHaveLength(2);
    expect(matchCalls.every(([, values]) =>
      JSON.stringify(values) === JSON.stringify(["season-2026", "club-1", 5]),
    )).toBe(true);

    const squadSql = String(
      db.query.mock.calls.find(([sql]) =>
        sql.includes("from football.squad_memberships sm"),
      )?.[0],
    );
    expect(squadSql).toContain("ps.season_id = $1");
    expect(squadSql).toContain("ps.club_id = sm.club_id");
    expect(squadSql).toContain("ps.player_id = sm.player_id");
  });

  it("returns null for an unknown or out-of-scope slug without related reads", async () => {
    const db = database({ scope: [] });

    await expect(
      getCurrentSerieAClubPageData(db.pool, "unknown-club"),
    ).resolves.toBeNull();
    expect(db.query).toHaveBeenCalledTimes(1);
  });

  it("tolerates missing standings and missing statistics for a current squad player", async () => {
    const db = database({
      standing: [],
      squad: [
        {
          membership_id: "membership-2",
          shirt_number: null,
          position: "Defender",
          player_id: "player-2",
          provider_name: "Player Two",
          name_ru: null,
          name_ru_review_status: null,
          provider_photo_url: null,
          statistics_id: null,
          appearances: null,
          lineups: null,
          minutes: null,
          goals_total: null,
          goals_assists: null,
          rating: null,
        },
      ],
    });

    const result = await getCurrentSerieAClubPageData(db.pool, "ac-milan-489");

    expect(result?.standing).toBeNull();
    expect(result?.squad).toEqual([
      expect.objectContaining({
        playerId: "player-2",
        displayName: "Player Two",
        statistics: null,
      }),
    ]);
  });

  it("lists sitemap slugs from persisted current-season participation", async () => {
    const db = database();

    await expect(listCurrentSerieAClubSlugs(db.pool)).resolves.toEqual([
      "ac-milan-489",
      "inter-505",
    ]);
    const call = db.query.mock.calls[0];
    expect(call?.[1]).toEqual(["api-football", 135, 2026]);
    expect(String(call?.[0])).toContain("join football.season_clubs");
  });

  it("checks slug existence in the same current Serie A scope", async () => {
    const known = database();
    const unknown = database({ scope: [] });

    await expect(
      currentSerieAClubSlugExists(known.pool, "ac-milan-489"),
    ).resolves.toBe(true);
    await expect(
      currentSerieAClubSlugExists(unknown.pool, "unknown-club"),
    ).resolves.toBe(false);
    expect(known.query.mock.calls[0]?.[1]).toEqual([
      "api-football",
      135,
      2026,
      "ac-milan-489",
    ]);
  });
});
