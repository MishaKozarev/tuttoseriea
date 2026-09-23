import "server-only";

import { canUseStaffMagicLinkLoginWithDependencies } from "@/src/auth/staff-login-policy-core";
import { emailHasPermission } from "@/src/identity/repository";
import { PERMISSION_IDS } from "@/src/identity/rbac";
import { isStaffEmailDeliveryEnabled } from "@/src/auth/staff-email-provider";

export async function canUseStaffMagicLinkLogin(
  email: unknown,
  verificationRequest: boolean,
): Promise<boolean> {
  return canUseStaffMagicLinkLoginWithDependencies(email, verificationRequest, {
    emailHasAdminAccess: (value) => emailHasPermission(value, PERMISSION_IDS.adminAccess),
    isEmailDeliveryEnabled: isStaffEmailDeliveryEnabled,
  });
}
