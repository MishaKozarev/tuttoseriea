export function normalizeFootballSlugBase(providerName: string): string {
  return providerName
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/gu, "")
    .toLowerCase()
    .replace(/&/gu, " and ")
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .replace(/-{2,}/gu, "-");
}

export function createFootballEntitySlug(
  providerName: string,
  providerEntityId: number,
  fallbackPrefix: string,
): string {
  const base = normalizeFootballSlugBase(providerName);

  return `${base || fallbackPrefix}-${providerEntityId}`;
}

export function createPlayerSlug(
  providerName: string,
  providerPlayerId: number,
): string {
  return createFootballEntitySlug(providerName, providerPlayerId, "player");
}

export function createMatchSlug(
  homeProviderName: string,
  awayProviderName: string,
  providerFixtureId: number,
): string {
  const homeBase = normalizeFootballSlugBase(homeProviderName) || "home-club";
  const awayBase = normalizeFootballSlugBase(awayProviderName) || "away-club";

  return `${homeBase}-${awayBase}-${providerFixtureId}`;
}
