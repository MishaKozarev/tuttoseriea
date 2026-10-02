import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { createMatchSlug } from "@/src/football/slug";

describe("Match slug contract", () => {
  it("normalizes both persisted provider Club names and keeps the fixture id", () => {
    expect(createMatchSlug("  AC Mílan & Co. ", "Inter / Milano", 12345)).toBe(
      "ac-milan-and-co-inter-milano-12345",
    );
  });

  it("uses deterministic per-side fallbacks for unusable provider names", () => {
    expect(createMatchSlug("Ж", "Ю", 67890)).toBe(
      "home-club-away-club-67890",
    );
  });

  it("backfills before enforcing non-null and global uniqueness with SQL/TS parity", () => {
    const migration = readFileSync(
      new URL("../../drizzle/0011_brief_random.sql", import.meta.url),
      "utf8",
    );

    const addIndex = migration.indexOf('ADD COLUMN "slug" text');
    const backfillIndex = migration.indexOf('UPDATE "football"."matches"');
    const notNullIndex = migration.indexOf('ALTER COLUMN "slug" SET NOT NULL');
    const uniqueIndex = migration.indexOf('CREATE UNIQUE INDEX "matches_slug_unique"');

    expect(addIndex).toBeGreaterThanOrEqual(0);
    expect(backfillIndex).toBeGreaterThan(addIndex);
    expect(notNullIndex).toBeGreaterThan(backfillIndex);
    expect(uniqueIndex).toBeGreaterThan(notNullIndex);
    expect(migration.match(/normalize\("(?:home|away)_club"\."provider_name", NFKD\)/g)).toHaveLength(2);
    expect(migration).toContain("'home-club'");
    expect(migration).toContain("'away-club'");
    expect(migration).toContain('"match"."provider_fixture_id"::text');
  });
});
