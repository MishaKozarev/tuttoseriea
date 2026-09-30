import type { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  getCurrentSerieAStatisticsPageData,
  listCurrentSerieAPlayerAggregates,
  rankSeasonPlayerAggregates,
  type SeasonPlayerAggregate,
} from "@/src/football/statistics-page-repository";

const aggregateRow = {
  player_id: "player-1",
  provider_player_id: 101,
  slug: "player-one-101",
  provider_name: "Player One",
  name_ru: "Игрок Один",
  name_ru_review_status: "reviewed",
  contributing_clubs: [
    {
      id: "club-1",
      slug: "club-one-1",
      providerClubId: 1,
      providerName: "Club One",
      nameRu: "Клуб Один",
      nameRuReviewStatus: "reviewed",
    },
    {
      id: "club-2",
      slug: "club-two-2",
      providerClubId: 2,
      providerName: "Club Two",
      nameRu: "Черновик клуба",
      nameRuReviewStatus: "unreviewed",
    },
  ],
  goals: 5,
  assists: null,
  appearances: 8,
  minutes: 0,
};

const standingRow = {
  id: "standing-1",
  rank: 1,
  group_name: "Serie A",
  points: 10,
  goals_diff: 4,
  form: "WW",
  provider_status: "same",
  description: null,
  played: 4,
  wins: 3,
  draws: 1,
  losses: 0,
  goals_for: 8,
  goals_against: 4,
  home_played: 2,
  home_wins: 2,
  home_draws: 0,
  home_losses: 0,
  home_goals_for: 5,
  home_goals_against: 1,
  away_played: 2,
  away_wins: 1,
  away_draws: 1,
  away_losses: 0,
  away_goals_for: 3,
  away_goals_against: 3,
  club_id: "club-1",
  club_slug: "club-one-1",
  provider_name: "Club One",
  name_ru: "Клуб Один",
  name_ru_review_status: "reviewed",
  code: "ONE",
  provider_logo_url: null,
};

function database(options: { aggregates?: unknown[]; standings?: unknown[] } = {}) {
  const query = vi.fn(async (sql: string, values?: readonly unknown[]) => {
    void values;

    if (sql.includes("jsonb_agg")) {
      return { rows: options.aggregates ?? [aggregateRow] };
    }

    if (sql.includes("join football.standings st")) {
      return { rows: options.standings ?? [standingRow] };
    }

    throw new Error(`Unexpected General Statistics query: ${sql}`);
  });

  return { pool: { query } as unknown as Pool, query };
}

function playerAggregate(
  providerPlayerId: number,
  values: Partial<Pick<SeasonPlayerAggregate, "goals" | "assists" | "appearances" | "minutes">>,
): SeasonPlayerAggregate {
  return {
    player: {
      id: `player-${providerPlayerId}`,
      providerPlayerId,
      slug: `player-${providerPlayerId}`,
      displayName: `Player ${providerPlayerId}`,
    },
    clubs: [
      { id: "club-1", slug: "club-one-1", displayName: "Club One" },
    ],
    goals: 0,
    assists: 0,
    appearances: 0,
    minutes: 0,
    ...values,
  };
}

describe("General Statistics repository", () => {
  it("uses one explicit season aggregate query with conservative NULL semantics", async () => {
    const db = database();

    const result = await listCurrentSerieAPlayerAggregates(db.pool);

    expect(result).toEqual([
      expect.objectContaining({
        player: expect.objectContaining({ displayName: "Игрок Один" }),
        clubs: [
          expect.objectContaining({ displayName: "Клуб Один" }),
          expect.objectContaining({ displayName: "Club Two" }),
        ],
        goals: 5,
        assists: null,
        appearances: 8,
        minutes: 0,
      }),
    ]);

    const [sql, values] = db.query.mock.calls[0] as [string, readonly unknown[]];
    expect(values).toEqual(["api-football", 135, 2026]);
    expect(sql).toContain("count(ps.goals_total) = count(*)");
    expect(sql).toContain("count(ps.goals_assists) = count(*)");
    expect(sql).toContain("count(ps.appearances) = count(*)");
    expect(sql).toContain("count(ps.minutes) = count(*)");
    expect(sql).toContain("jsonb_agg");
    expect(sql).not.toContain("squad_memberships");
    expect(db.query).toHaveBeenCalledTimes(1);
  });

  it("builds all sections with exactly one aggregate and one standings query", async () => {
    const db = database();

    const result = await getCurrentSerieAStatisticsPageData(db.pool);

    expect(db.query).toHaveBeenCalledTimes(2);
    expect(result.leaderboards.goals).toHaveLength(1);
    expect(result.leaderboards.assists).toEqual([]);
    expect(result.leaderboards.appearances).toHaveLength(1);
    expect(result.leaderboards.minutes[0]?.value).toBe(0);
    expect(result.standings[0]?.club).toMatchObject({
      slug: "club-one-1",
      displayName: "Клуб Один",
    });
  });

  it("uses competition ranks and deterministic provider identity ordering inside ties", () => {
    const result = rankSeasonPlayerAggregates(
      [
        playerAggregate(40, { goals: 3 }),
        playerAggregate(30, { goals: 8 }),
        playerAggregate(20, { goals: 8 }),
        playerAggregate(10, { goals: 10 }),
      ],
      "goals",
    );

    expect(result.map((row) => [row.player.providerPlayerId, row.value, row.rank])).toEqual([
      [10, 10, 1],
      [20, 8, 2],
      [30, 8, 2],
      [40, 3, 4],
    ]);
  });

  it("excludes unknown and non-positive goal/assist values without coercing known zero", () => {
    const aggregates = [
      playerAggregate(1, { goals: null, assists: null, appearances: null }),
      playerAggregate(2, { goals: 0, assists: 0, appearances: 0 }),
      playerAggregate(3, { goals: 2, assists: 1, appearances: 0 }),
    ];

    expect(rankSeasonPlayerAggregates(aggregates, "goals").map((row) => row.value)).toEqual([
      2,
    ]);
    expect(rankSeasonPlayerAggregates(aggregates, "assists").map((row) => row.value)).toEqual([
      1,
    ]);
    expect(
      rankSeasonPlayerAggregates(aggregates, "appearances").map((row) => row.value),
    ).toEqual([0, 0]);
  });

  it("limits each leaderboard to twenty stable rows", () => {
    const aggregates = Array.from({ length: 25 }, (_, index) =>
      playerAggregate(index + 1, { minutes: 100 }),
    );

    const result = rankSeasonPlayerAggregates(aggregates, "minutes");

    expect(result).toHaveLength(20);
    expect(result.every((row) => row.rank === 1)).toBe(true);
    expect(result.map((row) => row.player.providerPlayerId)).toEqual(
      Array.from({ length: 20 }, (_, index) => index + 1),
    );
  });
});
