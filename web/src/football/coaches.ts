import { resolveFootballProperName } from "./localization";

export type CoachSnapshot = {
  providerCoachId: number | null;
  providerCoachName: string | null;
  providerCoachPhotoUrl: string | null;
};
export type CoachCard = { id: string; displayName: string; providerPhotoUrl: string | null };
export type CoachRow = {
  id: string; provider: string; provider_coach_id: number; provider_name: string | null;
  provider_photo_url: string | null; name_ru: string | null; name_ru_review_status: string | null;
  localization_revision: number; name_source_match_id: string | null; photo_source_match_id: string | null;
  profile_observed_at: Date | string | null;
};
export type CoachSource = {
  matchId: string; kickoffAt: string; lineupObservedAt: string;
  providerCoachName: string | null; providerCoachPhotoUrl: string | null;
};
export type CoachCandidate = {
  provider: string; providerCoachId: number; coach: CoachCard | null; sources: CoachSource[];
};
export type LastKnownTeamCoach = { chronologyIncomplete: boolean } & (
  | { kind: "known"; candidate: CoachCandidate & { coach: CoachCard } }
  | { kind: "unresolved"; candidate: CoachCandidate }
  | { kind: "ambiguous"; candidates: CoachCandidate[] }
  | { kind: "unknown" }
);
export function coachCard(row: Pick<CoachRow, "id" | "provider_coach_id" | "provider_name" | "provider_photo_url" | "name_ru" | "name_ru_review_status" | "profile_observed_at">): CoachCard {
  return { id: row.id, displayName: resolveFootballProperName({
    providerName: row.profile_observed_at && row.provider_name ? row.provider_name : coachIdentityLabel(row.provider_coach_id),
    nameRu: row.name_ru, reviewStatus: row.name_ru_review_status }),
    providerPhotoUrl: row.profile_observed_at ? usableCoachPhoto(row.provider_photo_url) : null };
}
export const coachIdentityLabel = (providerCoachId: number) => `Coach #${providerCoachId}`;
export function usableCoachName(value: string | null): string | null {
  return value?.trim() || null;
}
export function usableCoachPhoto(value: string | null): string | null {
  if (!value?.trim()) return null;
  try {
    const url = new URL(value.trim());
    return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}
