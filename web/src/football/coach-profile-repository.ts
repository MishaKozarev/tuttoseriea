import { randomUUID } from "node:crypto";
import type { CoachQueryable } from "./coaches-repository";
import { API_FOOTBALL_PROVIDER, SERIE_A_CURRENT_SEASON, SERIE_A_PROVIDER_LEAGUE_ID } from "./foundation";
import { parseCoachProfile, type CoachProfile } from "./coach-profile";

export async function getSerieACoachProfileIds(db: CoachQueryable): Promise<number[]> {
  const rows = (await db.query<{ provider_coach_id: number }>(`
    select distinct l.provider_coach_id from football.match_lineups l
    join football.matches m on m.id=l.match_id join football.seasons s on s.id=m.season_id
    join football.competitions c on c.id=s.competition_id
    where m.provider=$1 and s.provider=$1 and c.provider=$1 and c.provider_competition_id=$2
      and s.provider_season_year=$3 and l.provider_coach_id is not null
      and l.club_id in (m.home_club_id,m.away_club_id)
    order by l.provider_coach_id limit 761`,
  [API_FOOTBALL_PROVIDER, SERIE_A_PROVIDER_LEAGUE_ID, SERIE_A_CURRENT_SEASON])).rows;
  if (rows.length > 760) throw new Error("Coach profile scope exceeds current Serie A Match participants");
  return rows.map((row) => row.provider_coach_id);
}

// The caller owns the short transaction and execution fence. Match legacy provenance,
// UUID/created_at, snapshots and all application-owned localization are deliberately untouched.
export async function upsertCoachProfile(db: CoachQueryable, profile: CoachProfile, observedAt: Date): Promise<boolean> {
  if (!Number.isFinite(observedAt.getTime())) throw new Error("Invalid Coach profile observation time");
  const result = await db.query(`insert into football.coaches as existing
    (id,provider,provider_coach_id,provider_name,provider_photo_url,firstname,lastname,age,
     birth_date,birth_place,birth_country,nationality,height,weight,provider_raw,profile_observed_at)
    values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
    on conflict(provider,provider_coach_id) do update set
      provider_name=excluded.provider_name,provider_photo_url=excluded.provider_photo_url,
      firstname=excluded.firstname,lastname=excluded.lastname,age=excluded.age,birth_date=excluded.birth_date,
      birth_place=excluded.birth_place,birth_country=excluded.birth_country,nationality=excluded.nationality,
      height=excluded.height,weight=excluded.weight,provider_raw=excluded.provider_raw,
      profile_observed_at=excluded.profile_observed_at,updated_at=now()
    where existing.profile_observed_at is null or existing.profile_observed_at < excluded.profile_observed_at
    returning id`, [randomUUID(), API_FOOTBALL_PROVIDER, profile.providerCoachId, profile.providerName,
    profile.providerPhotoUrl, profile.firstname, profile.lastname, profile.age, profile.birthDate,
    profile.birthPlace, profile.birthCountry, profile.nationality, profile.height, profile.weight, profile.raw, observedAt]);
  return result.rows.length > 0;
}

export type StoredCoachProfile = Omit<CoachProfile, "raw"> & { observedAt: string };
export async function getStoredCoachProfile(db: CoachQueryable, id: string): Promise<StoredCoachProfile | null> {
  const row = (await db.query<{ provider_coach_id: number; provider_raw: unknown; profile_observed_at: Date }>(`
    select provider_coach_id,provider_raw,profile_observed_at from football.coaches
    where id=$1 and profile_observed_at is not null`, [id])).rows[0];
  if (!row) return null;
  const parsed = parseCoachProfile(row.provider_raw, row.provider_coach_id);
  // Never expose unprojected provider raw to Admin clients.
  const { raw: _raw, ...profile } = parsed;
  void _raw;
  return { ...profile, observedAt: row.profile_observed_at.toISOString() };
}
