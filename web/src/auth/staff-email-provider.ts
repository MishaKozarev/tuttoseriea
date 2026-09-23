import "server-only";

import Nodemailer from "next-auth/providers/nodemailer";

export const STAFF_EMAIL_DELIVERY_ENV = "AUTH_STAFF_EMAIL_DELIVERY";
export const STAFF_EMAIL_SERVER_ENV = "AUTH_EMAIL_SERVER";
export const STAFF_EMAIL_FROM_ENV = "AUTH_EMAIL_FROM";

const DEFAULT_STAFF_EMAIL_FROM = "tuttoseriea.com <no-reply@tuttoseriea.com>";

export type StaffEmailDeliveryMode = "disabled" | "smtp";

export function getStaffEmailDeliveryMode(
  env: Record<string, string | undefined> = process.env,
): StaffEmailDeliveryMode {
  const value = env[STAFF_EMAIL_DELIVERY_ENV]?.trim().toLowerCase();

  if (!value || value === "disabled") {
    return "disabled";
  }

  if (value === "smtp") {
    return "smtp";
  }

  throw new Error(`${STAFF_EMAIL_DELIVERY_ENV} must be "disabled" or "smtp"`);
}

export function isStaffEmailDeliveryEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return getStaffEmailDeliveryMode(env) === "smtp";
}

function getStaffEmailServer(env: Record<string, string | undefined>): string {
  const deliveryMode = getStaffEmailDeliveryMode(env);
  const configuredServer = env[STAFF_EMAIL_SERVER_ENV]?.trim();

  if (deliveryMode === "smtp" && !configuredServer) {
    throw new Error(`${STAFF_EMAIL_SERVER_ENV} is required when staff email delivery is smtp`);
  }

  return configuredServer || "smtp://localhost:25";
}

export function createStaffEmailProvider(
  env: Record<string, string | undefined> = process.env,
) {
  const provider = Nodemailer({
    from: env[STAFF_EMAIL_FROM_ENV]?.trim() || DEFAULT_STAFF_EMAIL_FROM,
    server: getStaffEmailServer(env),
  });
  const sendVerificationRequest = provider.sendVerificationRequest;

  return {
    ...provider,
    async sendVerificationRequest(
      params: Parameters<typeof provider.sendVerificationRequest>[0],
    ) {
      if (!isStaffEmailDeliveryEnabled(env)) {
        throw new Error("Staff magic-link email delivery is disabled");
      }

      await sendVerificationRequest(params);
    },
  };
}
