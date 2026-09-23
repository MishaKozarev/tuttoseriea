"use server";

import { redirect } from "next/navigation";

import { signIn } from "@/auth";
import {
  DEFAULT_ADMIN_RETURN_PATH,
  resolveAdminReturnPath,
} from "@/src/identity/admin-return";
import { normalizeIdentityEmail } from "@/src/identity/email";
import { canUseStaffMagicLinkLogin } from "@/src/auth/staff-login-policy";

function createVerifyRequestPath(returnTo: string): string {
  const searchParams = new URLSearchParams({ returnTo });

  return `/admin/login/verify-request?${searchParams}`;
}

export async function requestStaffMagicLink(formData: FormData) {
  const returnTo = resolveAdminReturnPath(
    formData.get("returnTo") ?? DEFAULT_ADMIN_RETURN_PATH,
  );
  const email = normalizeIdentityEmail(formData.get("email"));

  if (!email) {
    redirect(`/admin/login?${new URLSearchParams({ returnTo, error: "invalid_email" })}`);
  }

  if (!(await canUseStaffMagicLinkLogin(email, true))) {
    redirect(createVerifyRequestPath(returnTo));
  }

  await signIn("nodemailer", {
    email,
    redirectTo: returnTo,
  });
}
