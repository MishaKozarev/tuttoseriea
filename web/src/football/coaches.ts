import { resolveFootballProperName } from "./localization";

export type CoachSnapshot = {
  providerCoachId: number | null;
  providerCoachName: string | null;
  providerCoachPhotoUrl: string | null;
};
export type CoachCard = { id: string; displayName: string; providerPhotoUrl: string | null };
export type CoachRow = {
  id: string; provider: string; provider_coach_id: number; provider_name: string;
  provider_photo_url: string | null; name_ru: string | null; name_ru_review_status: string | null;
  localization_revision: number; name_source_match_id: string; photo_source_match_id: string | null;
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
export function coachCard(row: CoachRow): CoachCard {
  return { id: row.id, displayName: resolveFootballProperName({ providerName: row.provider_name,
    nameRu: row.name_ru, reviewStatus: row.name_ru_review_status }), providerPhotoUrl: row.provider_photo_url };
}
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
// Profile evidence is independent of the finished-only Team projection.
export function mayReplaceCoachField(sourceId: string, incomingAt: Date | null,
  previousSourceId: string, previousAt: Date | null, sameValue: boolean): "replace" | "keep" | "conflict" {
  if (sourceId === previousSourceId) return "replace";
  if (incomingAt && (!previousAt || incomingAt.getTime() > previousAt.getTime())) return "replace";
  if ((!incomingAt && !previousAt || incomingAt?.getTime() === previousAt?.getTime()) && !sameValue) return "conflict";
  return "keep";
}

export type CoachProfileFacts = Pick<CoachRow, "provider_name" | "provider_photo_url" | "name_source_match_id" | "photo_source_match_id">;
// Shared by live persistence and the read-only reconciliation forecast.
export function projectCoachProfile(current: CoachProfileFacts, input: CoachSnapshot, matchId: string,
  incomingAt: Date | null, nameSourceAt: Date | null, photoSourceAt: Date | null) {
  const name = usableCoachName(input.providerCoachName), photo = usableCoachPhoto(input.providerCoachPhotoUrl);
  const nameDecision = name ? mayReplaceCoachField(matchId, incomingAt, current.name_source_match_id,
    nameSourceAt, name === current.provider_name) : "keep";
  const photoDecision = photo ? current.provider_photo_url === null ? "replace" : mayReplaceCoachField(matchId, incomingAt,
    current.photo_source_match_id!, photoSourceAt, photo === current.provider_photo_url) : "keep";
  return {
    facts: {
      provider_name: nameDecision === "replace" ? name! : current.provider_name,
      name_source_match_id: nameDecision === "replace" ? matchId : current.name_source_match_id,
      provider_photo_url: photoDecision === "replace" ? photo : current.provider_photo_url,
      photo_source_match_id: photoDecision === "replace" ? matchId : current.photo_source_match_id,
    },
    conflicts: [nameDecision === "conflict" ? "name" : null, photoDecision === "conflict" ? "photo" : null]
      .filter((field): field is "name" | "photo" => field !== null),
  };
}
