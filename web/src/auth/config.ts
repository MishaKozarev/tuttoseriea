export type AuthConfig = {
  origin: string;
  secret: string;
  writesEnabled: boolean;
  ipHeader: "x-real-ip" | "cf-connecting-ip" | null;
};

export function getAuthConfig(env: Record<string, string | undefined> = process.env): AuthConfig {
  const origin = new URL(env.AUTH_URL ?? "http://localhost:3000");
  if (origin.username || origin.password || origin.search || origin.hash || origin.pathname !== "/" ||
      !["http:", "https:"].includes(origin.protocol)) throw new Error("AUTH_URL must be a public origin");
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname);
  if (origin.protocol !== "https:" && !loopback) throw new Error("Authentication requires HTTPS");
  if (!env.AUTH_URL && env.NODE_ENV === "production") throw new Error("AUTH_URL is required");
  const secret = env.BETTER_AUTH_SECRET;
  if (!secret || secret.length < 32) throw new Error("BETTER_AUTH_SECRET must contain at least 32 characters");
  const ipHeader = env.AUTH_TRUSTED_IP_HEADER?.trim();
  if (ipHeader && ipHeader !== "x-real-ip" && ipHeader !== "cf-connecting-ip") throw new Error("Unsupported trusted IP header");
  if (env.AUTH_WRITES_ENABLED && !["true", "false"].includes(env.AUTH_WRITES_ENABLED)) throw new Error("Invalid AUTH_WRITES_ENABLED");
  return { origin: origin.origin, secret, writesEnabled: env.AUTH_WRITES_ENABLED !== "false", ipHeader: (ipHeader || null) as AuthConfig["ipHeader"] };
}

export function validStaffPassword(value: unknown): value is string {
  return typeof value === "string" && value.length >= 15 && value.length <= 128 && !value.includes("\0");
}
