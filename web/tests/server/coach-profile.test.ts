import { describe, expect, it } from "vitest";
import { parseCoachProfile } from "@/src/football/coach-profile";
import { coachCard, type CoachRow } from "@/src/football/coaches";
import { coachProfileFixture } from "../fixtures/coach-profile";

describe("Coaches API profile contract", () => {
  it("preserves raw biography, array order, unknown data and overlapping open careers without choosing a current Team", () => {
    const raw = coachProfileFixture(); const profile = parseCoachProfile(raw, 2914);
    expect(profile.providerName).toBe(raw.name); expect(profile.birthDate).toBe("1960-01-01");
    expect(profile.raw).toEqual(raw); expect(profile.career.map(p => p.team?.id)).toEqual([496, 489, 9999]);
    expect(profile.career.filter(p => p.end === null)).toHaveLength(2);
    expect(profile).not.toHaveProperty("currentClubId");
    expect(parseCoachProfile(coachProfileFixture(25878), 25878).providerCoachId).toBe(25878);
  });
  it("accepts explicit nullable biography/photo/team and an empty career without Lineups fallback", () => {
    const profile = parseCoachProfile({ ...coachProfileFixture(), firstname: null, lastname: null, age: null,
      birth: null, nationality: null, height: null, weight: null, photo: null, team: null, career: [] }, 2914);
    expect(profile.birthDate).toBeNull(); expect(profile.providerPhotoUrl).toBeNull(); expect(profile.career).toEqual([]);
  });
  it("rejects missing fields rather than replacing an accepted biography with implicit nulls", () => {
    const { firstname, ...incomplete } = coachProfileFixture(); void firstname;
    expect(() => parseCoachProfile(incomplete, 2914)).toThrow();
    expect(() => parseCoachProfile({ ...coachProfileFixture(), age: undefined }, 2914)).toThrow();
    expect(() => parseCoachProfile({ ...coachProfileFixture(), birth: { date: "1960-01-01" } }, 2914)).toThrow();
    expect(() => parseCoachProfile({ ...coachProfileFixture(), team: { id: 496 } }, 2914)).toThrow();
    expect(() => parseCoachProfile({ ...coachProfileFixture(), career: [{ team: null, start: null }] }, 2914)).toThrow();
  });
  it.each([{ id: 25878 }, { name: " " }, { age: -1 }, { age: "66" }, { birth: { date: "1960-02-31" } },
    { career: null }, { career: [{ team: { id: 496 }, start: "invalid", end: null }] }, { team: { id: 0 } }])("rejects unsafe/malformed profile %j", (change) => {
    expect(() => parseCoachProfile({ ...coachProfileFixture(), ...change }, 2914)).toThrow();
  });
  it("does not present legacy Lineups facts as a Coaches API profile and preserves reviewed-only Russian display", () => {
    const row = { id: "stable", provider: "api-football", provider_coach_id: 2914, provider_name: "Legacy name",
      provider_photo_url: "https://fixture.invalid/legacy", name_source_match_id: "legacy-match", photo_source_match_id: "legacy-match",
      name_ru: "Draft", name_ru_review_status: "unreviewed", localization_revision: 7, profile_observed_at: null } satisfies CoachRow;
    expect(coachCard(row)).toEqual({ id: "stable", displayName: "Coach #2914", providerPhotoUrl: null });
    expect(coachCard({ ...row, name_ru_review_status: "reviewed" }).displayName).toBe("Draft");
    expect(coachCard({ ...row, profile_observed_at: new Date(), provider_name: "API name" }).displayName).toBe("API name");
  });
});
