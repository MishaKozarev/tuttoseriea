import { normalizeIdentityEmail } from "@/src/identity/email";

type StaffLoginPolicyDependencies = {
  emailHasAdminAccess: (email: string) => Promise<boolean>;
  isEmailDeliveryEnabled: () => boolean;
};

export async function canUseStaffMagicLinkLoginWithDependencies(
  email: unknown,
  verificationRequest: boolean,
  dependencies: StaffLoginPolicyDependencies,
): Promise<boolean> {
  const normalizedEmail = normalizeIdentityEmail(email);

  if (!normalizedEmail) {
    return false;
  }

  if (!(await dependencies.emailHasAdminAccess(normalizedEmail))) {
    return false;
  }

  if (verificationRequest) {
    return dependencies.isEmailDeliveryEnabled();
  }

  return true;
}
