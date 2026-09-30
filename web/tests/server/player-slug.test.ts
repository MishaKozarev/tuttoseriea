import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { createFootballEntitySlug, createPlayerSlug } from "@/src/football/slug";

describe("Player slug contract", () => {
  it("normalizes provider names deterministically and keeps the provider player id", () => {
    expect(createPlayerSlug("  João Félix & Co.  ", 123)).toBe(
      "joao-felix-and-co-123",
    );
    expect(createPlayerSlug("Rafael Leao", 276)).toBe("rafael-leao-276");
  });

  it("uses a deterministic provider-identity fallback for unusable names", () => {
    expect(createPlayerSlug("Ж", 456)).toBe("player-456");
    expect(createFootballEntitySlug("Ж", 789, "club")).toBe("club-789");
  });

  it("backfills before enforcing the non-null and globally unique contract", () => {
    const migration = readFileSync(
      new URL("../../drizzle/0010_aberrant_colleen_wing.sql", import.meta.url),
      "utf8",
    );

    const addIndex = migration.indexOf('ADD COLUMN "slug" text');
    const backfillIndex = migration.indexOf('UPDATE "football"."players"');
    const notNullIndex = migration.indexOf('ALTER COLUMN "slug" SET NOT NULL');
    const uniqueIndex = migration.indexOf('CREATE UNIQUE INDEX "players_slug_unique"');

    expect(addIndex).toBeGreaterThanOrEqual(0);
    expect(backfillIndex).toBeGreaterThan(addIndex);
    expect(notNullIndex).toBeGreaterThan(backfillIndex);
    expect(uniqueIndex).toBeGreaterThan(notNullIndex);
    expect(migration).toContain("normalize(\"provider_name\", NFKD)");
    expect(migration).toContain("'player'");
  });
});
