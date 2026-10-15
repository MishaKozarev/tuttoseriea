import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { buildFootballOverview, overviewTime } from "@/src/admin/football-overview";
import { OVERVIEW_DATASETS } from "@/src/admin/football-overview-repository";
import { productionJobRegistry } from "@/src/jobs/registry";
import { footballOverviewFixture } from "../fixtures/football-overview";

describe("Football Overview evidence", () => {
  it("maps the existing eight jobs without adding job types", () => {
    expect(OVERVIEW_DATASETS.map((dataset) => dataset.jobType).sort()).toEqual([...productionJobRegistry.keys()].sort());
  });

  it("retains full persisted matches despite a failed synchronization", () => {
    const data = footballOverviewFixture();
    data.jobs = [{ type: "football.sync-serie-a-matches", pending: 0, retries: 0, running: 0,
      expired: 0, failed_scopes: 1, last_success_at: new Date("2026-10-01T12:00:00Z") }];
    const result = buildFootballOverview(data);
    const matches = result.datasets.find((dataset) => dataset.id === "matches")!;
    expect(matches.presence).toContain("380");
    expect(matches.completeness).toContain("ожидаемый объём сохранён");
    expect(matches.issues).toEqual(["Областей синхронизации с ошибкой последнего запуска: 1"]);
    expect(matches.observation).toEqual(data.facts.observations.matches);
  });

  it("accepts a confirmed zero-row Events snapshot", () => {
    const result = buildFootballOverview(footballOverviewFixture());
    const events = result.datasets.find((dataset) => dataset.id === "events")!;
    expect(events.presence).toContain("Событий: 0");
    expect(events.completeness).toContain("1 из 1");
    expect(events.issues).toEqual([]);
    expect(events.observation.oldest).toBeNull();
  });

  it("does not turn an empty successful Lineups job into two-sided completeness", () => {
    const data = footballOverviewFixture();
    data.finishedMatches[0].lineupsComplete = false;
    data.finishedMatches[0].statisticsComplete = false;
    data.facts.lineups = 1;
    data.jobs = [{ type: "football.sync-serie-a-match-lineups", pending: 0, retries: 0, running: 0,
      expired: 0, failed_scopes: 0, last_success_at: data.checkedAt }];
    const result = buildFootballOverview(data);
    expect(result.attention.map((dataset) => dataset.id)).toEqual(["lineups", "statistics"]);
    expect(result.datasets.find((dataset) => dataset.id === "lineups")!.completeness).toContain("0 из 1");
  });

  it("leaves match completeness unassessed when there are no finished Matches", () => {
    const data = footballOverviewFixture();
    data.finishedMatches = [];
    const result = buildFootballOverview(data);
    expect(result.datasets.find((dataset) => dataset.id === "events")!.completeness).toContain("полнота не оценивается");
    expect(result.attention).toEqual([]);
  });

  it("does not claim player-count completeness, or season freshness from one job", () => {
    const data = footballOverviewFixture();
    const result = buildFootballOverview(data);
    expect(result.datasets.find((dataset) => dataset.id === "squads")!.completeness).toContain("число игроков неизвестно");
    expect(result.datasets.find((dataset) => dataset.id === "player-statistics")!.completeness).toContain("не доказывает полноту");
    expect(result.datasets.find((dataset) => dataset.id === "matches")!.observation.oldest).not.toBe(
      data.facts.observations.matches.newest,
    );
  });

  it("reports expired leases independently of pending retries", () => {
    const data = footballOverviewFixture();
    data.jobs = [{ type: "football.sync-serie-a-matches", pending: 1, retries: 1, running: 1,
      expired: 1, failed_scopes: 0, last_success_at: null }];
    const matches = buildFootballOverview(data).datasets.find((dataset) => dataset.id === "matches")!;
    expect(matches.issues).toEqual(["Запусков с истёкшим сроком аренды: 1"]);
    expect(matches.job?.retries).toBe(1);
  });

  it("formats explicit UTC observations and unknown values", () => {
    expect(overviewTime("2026-10-15T12:00:00Z")).toContain("12:00:00 UTC");
    expect(overviewTime(null)).toBe("Нет сведений");
  });
});
