import { describe, expect, it } from "vitest";

import {
  SERIE_A_FOUNDATION_IDEMPOTENCY_KEY,
  SERIE_A_FOUNDATION_JOB_TYPE,
} from "@/src/football/foundation";
import { createClubSlug } from "@/src/football/repository";
import { syncSerieAFoundationJob } from "@/src/jobs/football-sync";
import { listJobTypes, productionJobRegistry } from "@/src/jobs/registry";

describe("Football foundation", () => {
  it("registers the bounded Serie A sync job in the production registry", () => {
    expect(listJobTypes(productionJobRegistry)).toEqual([SERIE_A_FOUNDATION_JOB_TYPE]);
  });

  it("uses a canonical idempotency key and rejects arbitrary job arguments", () => {
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

  it("creates stable one-time club slugs from provider identity", () => {
    expect(createClubSlug("AC Milan", 489)).toBe("ac-milan-489");
    expect(createClubSlug("Internazionale & Friends", 505)).toBe(
      "internazionale-and-friends-505",
    );
  });
});
