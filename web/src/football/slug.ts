export function createFootballEntitySlug(
  providerName: string,
  providerEntityId: number,
  fallbackPrefix: string,
): string {
  const base = providerName
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/gu, "")
    .toLowerCase()
    .replace(/&/gu, " and ")
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .replace(/-{2,}/gu, "-");

  return `${base || fallbackPrefix}-${providerEntityId}`;
}

export function createPlayerSlug(
  providerName: string,
  providerPlayerId: number,
): string {
  return createFootballEntitySlug(providerName, providerPlayerId, "player");
}
