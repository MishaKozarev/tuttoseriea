import { createHash } from "node:crypto";
import { Resend } from "resend";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

export type AuthEmail = { to: string; subject: string; text: string; deliveryId: string };
export type AuthEmailSender = (email: AuthEmail) => Promise<void>;

export class EmailDeliveryError extends Error {
  constructor(readonly code: string) { super("Email delivery unavailable"); }
}

export function createAuthEmailSender(
  env: Record<string, string | undefined> = process.env,
  send?: (message: { from: string; to: string; subject: string; text: string }, key: string, signal: AbortSignal) => Promise<void>,
): AuthEmailSender {
  return async (email) => {
    if (env.EMAIL_DELIVERY_MODE === "local-file") {
      if (!["localhost", "127.0.0.1"].includes(new URL(env.AUTH_URL ?? "http://localhost:3000").hostname)) throw new EmailDeliveryError("LOCAL_DELIVERY_FORBIDDEN");
      const directory = path.resolve(".next/local-auth-mail");
      await mkdir(directory, { recursive: true, mode: 0o700 });
      await writeFile(path.join(directory, createHash("sha256").update(email.deliveryId).digest("hex") + ".json"), JSON.stringify(email), { mode: 0o600 });
      return;
    }
    if (env.EMAIL_DELIVERY_MODE !== "resend") throw new EmailDeliveryError("EMAIL_DELIVERY_DISABLED");
    const from = env.RESEND_FROM?.trim();
    const sender = from?.match(/(?:<|^)([^<>\s]+@tuttoseriea\.com)>?$/i)?.[1];
    if (!from || !sender || /[\r\n]/.test(from) || !env.RESEND_API_KEY) throw new EmailDeliveryError("EMAIL_CONFIGURATION_INVALID");
    const recipients = (env.EMAIL_ALLOWED_RECIPIENTS ?? "").split(",").map(value => value.trim().toLowerCase()).filter(Boolean);
    const origin = new URL(env.AUTH_URL ?? "http://localhost:3000");
    if (origin.hostname !== "tuttoseriea.com" && recipients.length === 0) throw new EmailDeliveryError("EMAIL_RECIPIENT_ALLOWLIST_REQUIRED");
    if (recipients.length && !recipients.includes(email.to.toLowerCase())) throw new EmailDeliveryError("EMAIL_RECIPIENT_NOT_ALLOWED");
    const key = `auth/${createHash("sha256").update(`${origin.origin}/${email.deliveryId}`).digest("hex")}`;
    const deliver = send ?? (async (message, idempotencyKey, signal) => {
      const { error } = await new Resend(env.RESEND_API_KEY).emails.send(message, { idempotencyKey, signal });
      if (error) throw new EmailDeliveryError(error.name === "rate_limit_exceeded" ? "EMAIL_RATE_LIMITED" : "EMAIL_PROVIDER_REJECTED");
    });
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        await deliver({ from, to: email.to, subject: email.subject, text: email.text }, key, AbortSignal.timeout(10_000));
        return;
      } catch (error) {
        if (error instanceof EmailDeliveryError && error.code !== "EMAIL_RATE_LIMITED") throw error;
        if (attempt === 1) throw new EmailDeliveryError("EMAIL_PROVIDER_UNAVAILABLE");
      }
    }
  };
}
