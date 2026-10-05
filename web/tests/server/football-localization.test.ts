import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  FIXTURE_STATUS_LABELS_RU,
  PLAYER_STATISTICS_LABELS_RU,
  formatMatchEventMinute,
  formatMatchRound,
  formatStandingsForm,
  resolveMatchEventDetailLabel,
  resolveMatchEventTypeLabel,
  resolveMatchStatisticTypeLabel,
  resolveFixtureStatusLabel,
  resolveFootballGeography,
  resolveFootballProperName,
  resolvePlayerPosition,
  resolvePlayerStatisticsLabel,
  resolveStandingsDescription,
} from "@/src/football/localization";

describe("Football proper-name localization", () => {
  it.each(["Competition", "Team", "Player"])(
    "uses a reviewed Russian value for %s display",
    () => {
      expect(
        resolveFootballProperName({
          providerName: "Provider name",
          nameRu: "Русское имя",
          reviewStatus: "reviewed",
        }),
      ).toBe("Русское имя");
    },
  );

  it.each([
    { nameRu: "Русское имя", reviewStatus: "unreviewed" },
    { nameRu: null, reviewStatus: null },
    { nameRu: "Русское имя", reviewStatus: "unexpected" },
    { nameRu: "   ", reviewStatus: "reviewed" },
  ])("falls back to provider data for non-canonical state %#", (localization) => {
    expect(
      resolveFootballProperName({
        providerName: "Provider name",
        ...localization,
      }),
    ).toBe("Provider name");
  });
});

describe("Football geography localization", () => {
  it("normalizes an exact provider alias before using Russian CLDR display", () => {
    expect(resolveFootballGeography("Italy")).toBe("Италия");
  });

  it("normalizes the exact USA provider alias through a region key", () => {
    expect(resolveFootballGeography("USA")).toBe("США");
  });

  it("uses an explicit football identity override", () => {
    expect(resolveFootballGeography("England")).toBe("Англия");
  });

  it("does not interpret arbitrary provider values as region keys", () => {
    expect(resolveFootballGeography("IT")).toBe("IT");
    expect(resolveFootballGeography("Atlantis")).toBe("Atlantis");
  });

  it("preserves absent geography", () => {
    expect(resolveFootballGeography(null)).toBeNull();
    expect(resolveFootballGeography(undefined)).toBeNull();
  });
});

describe("Football bounded and semi-structured localization", () => {
  it("provides Russian labels for every supported normalized fixture status", () => {
    for (const [status, label] of Object.entries(FIXTURE_STATUS_LABELS_RU)) {
      expect(resolveFixtureStatusLabel(status, "English provider label")).toBe(label);
      expect(label).not.toBe("English provider label");
    }
  });

  it("falls back for an unknown fixture state", () => {
    expect(resolveFixtureStatusLabel("unknown", "Provider status")).toBe(
      "Provider status",
    );
  });

  it("formats known rounds and preserves unknown patterns", () => {
    expect(formatMatchRound("Regular Season - 12")).toBe("12-й тур");
    expect(formatMatchRound("Quarter-finals")).toBe("Quarter-finals");
  });

  it("resolves known standings descriptions and preserves unknown text", () => {
    expect(resolveStandingsDescription("  Champions League  ")).toBe("Лига чемпионов");
    expect(resolveStandingsDescription("Champions League league stage")).toBe(
      "Лига чемпионов",
    );
    expect(resolveStandingsDescription("Champions League something unexpected")).toBe(
      "Champions League something unexpected",
    );
    expect(resolveStandingsDescription("Custom provider note")).toBe(
      "Custom provider note",
    );
  });

  it("formats known standings form and safely preserves unknown tokens", () => {
    expect(formatStandingsForm("WWDLW")).toBe("ВВНПВ");
    expect(formatStandingsForm("WW?LW")).toBe("WW?LW");
  });

  it("resolves known player positions and preserves unknown values", () => {
    expect(resolvePlayerPosition("Midfielder")).toBe("Полузащитник");
    expect(resolvePlayerPosition("M")).toBe("Полузащитник");
    expect(resolvePlayerPosition("F")).toBe("F");
    expect(resolvePlayerPosition("Wing-back")).toBe("Wing-back");
  });

  it("formats Match Event minutes without interpreting provider data", () => {
    expect(formatMatchEventMinute(68, null)).toBe("68′");
    expect(formatMatchEventMinute(90, 6)).toBe("90+6′");
  });

  it("localizes only confirmed exact Match Event values", () => {
    expect(resolveMatchEventTypeLabel("Goal")).toBe("Гол");
    expect(resolveMatchEventTypeLabel("Card")).toBe("Карточка");
    expect(resolveMatchEventTypeLabel("subst")).toBe("Замена");
    expect(resolveMatchEventDetailLabel("Normal Goal")).toBe("Гол с игры");
    expect(resolveMatchEventDetailLabel("Yellow Card")).toBe("Жёлтая карточка");
    expect(resolveMatchEventDetailLabel("Substitution 1")).toBe("Замена");
    expect(resolveMatchEventTypeLabel("Goal review")).toBe("Goal review");
    expect(resolveMatchEventDetailLabel("Normal Goal review")).toBe(
      "Normal Goal review",
    );
  });

  it("localizes only confirmed exact Match Statistics values", () => {
    expect(resolveMatchStatisticTypeLabel("Shots on Goal")).toBe("Удары в створ");
    expect(resolveMatchStatisticTypeLabel("Ball Possession")).toBe(
      "Владение мячом",
    );
    expect(resolveMatchStatisticTypeLabel("expected_goals")).toBe(
      "Ожидаемые голы (xG)",
    );
    expect(resolveMatchStatisticTypeLabel("Blocked Shots")).toBe(
      "Заблокированные удары",
    );
    expect(resolveMatchStatisticTypeLabel("Corner Kicks")).toBe("Угловые");
    expect(resolveMatchStatisticTypeLabel("Fouls")).toBe("Фолы");
    expect(resolveMatchStatisticTypeLabel("Shots on Goal expected")).toBe(
      "Shots on Goal expected",
    );
  });

  it("defines a Russian label for every typed player-statistics field", () => {
    for (const field of Object.keys(PLAYER_STATISTICS_LABELS_RU) as Array<
      keyof typeof PLAYER_STATISTICS_LABELS_RU
    >) {
      expect(resolvePlayerStatisticsLabel(field)).toBe(PLAYER_STATISTICS_LABELS_RU[field]);
      expect(PLAYER_STATISTICS_LABELS_RU[field].length).toBeGreaterThan(0);
    }
  });
});

describe("Football localization migration", () => {
  const migration = readFileSync(
    new URL("../../drizzle/0009_swift_stature.sql", import.meta.url),
    "utf8",
  );

  it("backfills existing Competition and Team Russian values as unreviewed", () => {
    for (const table of ["competitions", "clubs"]) {
      const update = `UPDATE "football"."${table}"\nSET "name_ru_review_status" = 'unreviewed'\nWHERE "name_ru" IS NOT NULL`;
      const constraint = `ALTER TABLE "football"."${table}" ADD CONSTRAINT`;

      expect(migration).toContain(update);
      expect(migration.indexOf(update)).toBeLessThan(migration.indexOf(constraint));
    }

    expect(migration).not.toMatch(/SET "name_ru_review_status" = 'reviewed'/u);
  });
});
