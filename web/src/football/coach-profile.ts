import { usableCoachPhoto } from "./coaches";

export type CoachProfileTeam = { id: number | null; name: string | null; logo: string | null };
export type CoachCareerPeriod = { team: CoachProfileTeam | null; start: string | null; end: string | null };
export type CoachProfile = {
  providerCoachId: number; providerName: string; firstname: string | null; lastname: string | null;
  age: number | null; birthDate: string | null; birthPlace: string | null; birthCountry: string | null;
  nationality: string | null; height: string | null; weight: string | null; providerPhotoUrl: string | null;
  team: CoachProfileTeam | null; career: CoachCareerPeriod[]; raw: Record<string, unknown>;
};
export class CoachProfileValidationError extends Error {
  constructor() { super("Invalid API-Football Coach profile"); }
}
const invalid = (): never => { throw new CoachProfileValidationError(); };
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const hasFields = (value: Record<string, unknown>, fields: string[]) => fields.every(key => Object.hasOwn(value, key) && value[key] !== undefined);
function text(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") return invalid();
  return value.trim() || null;
}
function integer(value: unknown, positive = false): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "number" || !Number.isInteger(value) || value < (positive ? 1 : 0) || value > 2_147_483_647) return invalid();
  return value;
}
function date(value: unknown): string | null {
  const parsed = text(value);
  if (parsed === null) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(parsed)) return invalid();
  const at = new Date(`${parsed}T00:00:00Z`);
  if (!Number.isFinite(at.getTime()) || at.toISOString().slice(0, 10) !== parsed) return invalid();
  return parsed;
}
function team(value: unknown): CoachProfileTeam | null {
  if (value === null) return null;
  if (!record(value) || !hasFields(value, ["id", "name", "logo"])) return invalid();
  return { id: integer(value.id, true), name: text(value.name), logo: usableCoachPhoto(text(value.logo)) };
}
// The complete provider object, including unknown fields and ordered career entries, is
// retained separately from these display projections. Neither team nor career implies employment.
export function parseCoachProfile(raw: unknown, expectedId: number): CoachProfile {
  if (!record(raw) || !hasFields(raw, ["id", "name", "firstname", "lastname", "age", "birth", "nationality", "height", "weight", "photo", "team", "career"])
    || integer(raw.id, true) !== expectedId || !Array.isArray(raw.career)) return invalid();
  const providerName = text(raw.name);
  if (!providerName || (raw.birth !== null && (!record(raw.birth) || !hasFields(raw.birth, ["date", "place", "country"])))) return invalid();
  const birth = raw.birth ?? {};
  const career = raw.career.map((period): CoachCareerPeriod => {
    if (!record(period) || !hasFields(period, ["team", "start", "end"])) return invalid();
    return { team: team(period.team), start: date(period.start), end: date(period.end) };
  });
  return { providerCoachId: expectedId, providerName, firstname: text(raw.firstname), lastname: text(raw.lastname),
    age: integer(raw.age), birthDate: date(birth.date), birthPlace: text(birth.place), birthCountry: text(birth.country),
    nationality: text(raw.nationality), height: text(raw.height), weight: text(raw.weight),
    providerPhotoUrl: usableCoachPhoto(text(raw.photo)), team: team(raw.team), career, raw };
}
