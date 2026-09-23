export function normalizeIdentityEmail(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const email = value.normalize("NFKC").trim().toLowerCase();

  if (!email || email.includes('"')) {
    return null;
  }

  const parts = email.split("@");

  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    return null;
  }

  return email;
}
