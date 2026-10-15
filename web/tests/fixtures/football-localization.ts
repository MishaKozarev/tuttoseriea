import type { FootballLocalizationEntity } from "@/src/football/localization-management";

export function localizationFixture(kind: FootballLocalizationEntity["kind"] = "clubs"): FootballLocalizationEntity {
  return { kind, id: "248ff61d-0490-4a2d-9eee-6b7e476e1d98", slug: "fixture-club-123",
    provider: "api-football", providerName: "Fixture Club", nameRu: null, nameRuReviewStatus: null,
    localizationRevision: 0, displayName: "Fixture Club" };
}
