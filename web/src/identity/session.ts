import "server-only";

import { getStaffSession } from "@/src/auth/session";
import { getIdentityAccessByAuthUserId, type IdentityAccess } from "@/src/identity/repository";

export type CurrentIdentityAccess =
  | {
      authenticated: false;
      identityAccess: null;
    }
  | {
      authenticated: true;
      identityAccess: IdentityAccess | null;
      mfaRequired: boolean;
    };

export async function getCurrentIdentityAccess(): Promise<CurrentIdentityAccess> {
  const session = await getStaffSession();
  const authUserId = session?.user.userId;

  if (!authUserId) {
    return {
      authenticated: false,
      identityAccess: null,
    };
  }

  return {
    authenticated: true,
    identityAccess: await getIdentityAccessByAuthUserId(authUserId),
    mfaRequired: !session?.fullAccess,
  };
}
