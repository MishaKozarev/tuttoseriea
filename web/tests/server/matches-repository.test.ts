import type { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";

import { listCurrentSerieAMatches } from "@/src/football/matches-repository";

describe("Current Serie A matches repository", () => {
  it("maps canonical home and away Club slugs from the existing joined query", async () => {
    const query = vi.fn(async () => ({
      rows: [
        {
          id: "match-1",
          provider_fixture_id: 12345,
          round: "Regular Season - 1",
          kickoff_at: new Date("2026-08-22T18:45:00.000Z"),
          venue_name: "San Siro",
          venue_city: "Milano",
          status: "scheduled",
          polling_category: "WATCH",
          provider_status_long: "Not Started",
          provider_status_short: "NS",
          status_elapsed: null,
          status_extra: null,
          home_goals: null,
          away_goals: null,
          home_slug: "ac-milan-489",
          home_provider_name: "AC Milan",
          away_slug: "inter-505",
          away_provider_name: "Inter",
          home_name_ru: "Милан",
          away_name_ru: null,
          home_name_ru_review_status: "reviewed",
          away_name_ru_review_status: null,
          home_code: "MIL",
          away_code: "INT",
          home_logo_url: null,
          away_logo_url: null,
        },
      ],
    }));
    const pool = { query } as unknown as Pool;

    const matches = await listCurrentSerieAMatches(pool);

    expect(matches).toEqual([
      expect.objectContaining({
        homeClub: expect.objectContaining({ slug: "ac-milan-489", displayName: "Милан" }),
        awayClub: expect.objectContaining({ slug: "inter-505", displayName: "Inter" }),
      }),
    ]);
    expect(query).toHaveBeenCalledTimes(1);
    const [sql, values] = query.mock.calls[0] as unknown as [string, readonly unknown[]];
    expect(sql).toContain("home.slug as home_slug");
    expect(sql).toContain("away.slug as away_slug");
    expect(values).toEqual(["api-football", 135, 2026]);
  });
});
