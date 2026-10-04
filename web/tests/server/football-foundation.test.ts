import { describe, expect, it } from "vitest";

import {
  SERIE_A_FOUNDATION_IDEMPOTENCY_KEY,
  SERIE_A_FOUNDATION_JOB_TYPE,
  SERIE_A_MATCHES_IDEMPOTENCY_KEY,
  SERIE_A_MATCHES_JOB_TYPE,
  SERIE_A_MATCH_EVENTS_JOB_TYPE,
  SERIE_A_MATCH_LINEUPS_JOB_TYPE,
  SERIE_A_PLAYER_STATISTICS_IDEMPOTENCY_KEY,
  SERIE_A_PLAYER_STATISTICS_JOB_TYPE,
  SERIE_A_SQUADS_IDEMPOTENCY_KEY,
  SERIE_A_SQUADS_JOB_TYPE,
  SERIE_A_STANDINGS_IDEMPOTENCY_KEY,
  SERIE_A_STANDINGS_JOB_TYPE,
  createSerieAMatchEventsIdempotencyKey,
  createSerieAMatchLineupsIdempotencyKey,
} from "@/src/football/foundation";
import { createClubSlug } from "@/src/football/repository";
import {
  syncSerieAFoundationJob,
  syncSerieAMatchEventsJob,
  syncSerieAMatchLineupsJob,
  syncSerieAMatchesJob,
  syncSerieAPlayerStatisticsJob,
  syncSerieASquadsJob,
  syncSerieAStandingsJob,
} from "@/src/jobs/football-sync";
import { listJobTypes, productionJobRegistry } from "@/src/jobs/registry";

describe("Football foundation", () => {
  it("registers bounded Serie A sync jobs in the production registry", () => {
    expect(listJobTypes(productionJobRegistry)).toEqual([
      SERIE_A_FOUNDATION_JOB_TYPE,
      SERIE_A_MATCH_EVENTS_JOB_TYPE,
      SERIE_A_MATCH_LINEUPS_JOB_TYPE,
      SERIE_A_MATCHES_JOB_TYPE,
      SERIE_A_PLAYER_STATISTICS_JOB_TYPE,
      SERIE_A_SQUADS_JOB_TYPE,
      SERIE_A_STANDINGS_JOB_TYPE,
    ]);
  });

  it("uses a canonical Match-scoped Events key and rejects unbounded arguments", () => {
    const matchId = "11111111-1111-4111-8111-111111111111";

    expect(
      syncSerieAMatchEventsJob.parseArguments(["--match-id", matchId]),
    ).toEqual({
      idempotencyKey: createSerieAMatchEventsIdempotencyKey(matchId),
      payload: {
        provider: "api-football",
        leagueId: 135,
        season: 2026,
        scope: "match-events",
        matchId,
      },
    });

    for (const invalidArgs of [
      [],
      ["--fixture", "1550114"],
      ["--match-id", "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA"],
      ["--match-id", matchId, "extra"],
      ["--match-id", "not-a-uuid"],
    ]) {
      expect(() => syncSerieAMatchEventsJob.parseArguments(invalidArgs)).toThrow(
        /requires exactly --match-id <lowercase-uuid>/,
      );
    }
  });

  it("uses a canonical Match-scoped Lineups key and rejects unbounded arguments", () => {
    const matchId = "11111111-1111-4111-8111-111111111111";

    expect(
      syncSerieAMatchLineupsJob.parseArguments(["--match-id", matchId]),
    ).toEqual({
      idempotencyKey: createSerieAMatchLineupsIdempotencyKey(matchId),
      payload: {
        provider: "api-football",
        leagueId: 135,
        season: 2026,
        scope: "match-lineups",
        matchId,
      },
    });

    for (const invalidArgs of [
      [],
      ["--fixture", "1550114"],
      ["--match-id", "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA"],
      ["--match-id", matchId, "extra"],
      ["--match-id", "not-a-uuid"],
    ]) {
      expect(() => syncSerieAMatchLineupsJob.parseArguments(invalidArgs)).toThrow(
        /requires exactly --match-id <lowercase-uuid>/,
      );
    }
  });

  it("uses a canonical idempotency key for the player statistics job and rejects arbitrary arguments", () => {
    expect(syncSerieAPlayerStatisticsJob.parseArguments([])).toEqual({
      idempotencyKey: SERIE_A_PLAYER_STATISTICS_IDEMPOTENCY_KEY,
      payload: {
        provider: "api-football",
        leagueId: 135,
        season: 2026,
        scope: "player-statistics",
      },
    });

    expect(() =>
      syncSerieAPlayerStatisticsJob.parseArguments(["--page", "2"]),
    ).toThrow(/does not accept job arguments/);
  });

  it("uses a canonical idempotency key for the squads job and rejects arbitrary arguments", () => {
    expect(syncSerieASquadsJob.parseArguments([])).toEqual({
      idempotencyKey: SERIE_A_SQUADS_IDEMPOTENCY_KEY,
      payload: {
        provider: "api-football",
        leagueId: 135,
        season: 2026,
        scope: "squads",
      },
    });

    expect(() => syncSerieASquadsJob.parseArguments(["--team", "489"])).toThrow(
      /does not accept job arguments/,
    );
  });

  it("uses a canonical idempotency key for the standings job and rejects arbitrary arguments", () => {
    expect(syncSerieAStandingsJob.parseArguments([])).toEqual({
      idempotencyKey: SERIE_A_STANDINGS_IDEMPOTENCY_KEY,
      payload: {
        provider: "api-football",
        leagueId: 135,
        season: 2026,
        scope: "standings",
      },
    });

    expect(() => syncSerieAStandingsJob.parseArguments(["--group", "Serie A"])).toThrow(
      /does not accept job arguments/,
    );
  });

  it("uses a canonical idempotency key for the foundation job and rejects arbitrary arguments", () => {
    expect(syncSerieAFoundationJob.parseArguments([])).toEqual({
      idempotencyKey: SERIE_A_FOUNDATION_IDEMPOTENCY_KEY,
      payload: {
        provider: "api-football",
        leagueId: 135,
        season: 2026,
      },
    });

    expect(() => syncSerieAFoundationJob.parseArguments(["--season", "2025"])).toThrow(
      /does not accept job arguments/,
    );
  });

  it("uses a canonical idempotency key for the matches job and rejects arbitrary arguments", () => {
    expect(syncSerieAMatchesJob.parseArguments([])).toEqual({
      idempotencyKey: SERIE_A_MATCHES_IDEMPOTENCY_KEY,
      payload: {
        provider: "api-football",
        leagueId: 135,
        season: 2026,
        scope: "matches",
      },
    });

    expect(() => syncSerieAMatchesJob.parseArguments(["--round", "1"])).toThrow(
      /does not accept job arguments/,
    );
  });

  it("creates stable one-time club slugs from provider identity", () => {
    const legacyCreateClubSlug = (providerName: string, providerClubId: number) => {
      const base = providerName
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/gu, "")
        .toLowerCase()
        .replace(/&/gu, " and ")
        .replace(/[^a-z0-9]+/gu, "-")
        .replace(/^-+|-+$/gu, "")
        .replace(/-{2,}/gu, "-");

      return `${base || "club"}-${providerClubId}`;
    };
    const representativeClubs = [
      ["AC Milan", 489],
      ["Internazionale & Friends", 505],
      ["  Hellas Vérona / FC  ", 504],
      ["Ж", 777],
    ] as const;

    for (const [providerName, providerClubId] of representativeClubs) {
      expect(createClubSlug(providerName, providerClubId)).toBe(
        legacyCreateClubSlug(providerName, providerClubId),
      );
    }

    expect(createClubSlug("AC Milan", 489)).toBe("ac-milan-489");
    expect(createClubSlug("Internazionale & Friends", 505)).toBe(
      "internazionale-and-friends-505",
    );
  });
});
