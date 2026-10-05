import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const webRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

describe("Match normalized status transition marker", () => {
  it("adds one nullable timestamp without a historical backfill or default", () => {
    const migration = readFileSync(
      path.join(webRoot, "drizzle/0015_match_status_changed_at.sql"),
      "utf8",
    );

    expect(migration.trim()).toBe(
      'ALTER TABLE "football"."matches" ADD COLUMN "status_changed_at" timestamp with time zone;',
    );
    expect(migration).not.toMatch(/\bupdate\b|default|not null/iu);
  });
});
