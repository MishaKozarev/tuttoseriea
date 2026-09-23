import "server-only";

import { auth } from "@/auth";
import { getIdentityAccessByAuthUserId, type IdentityAccess } from "@/src/identity/repository";

export type CurrentIdentityAccess =
  | {
      authenticated: false;
      identityAccess: null;
    }
  | {
      authenticated: true;
      identityAccess: IdentityAccess | null;
    };

function getSessionAuthUserId(session: unknown): string | null {
  const userId = (session as { user?: { id?: unknown } } | null)?.user?.id;

  return typeof userId === "string" && userId ? userId : null;
}

export async function getCurrentIdentityAccess(): Promise<CurrentIdentityAccess> {
  const session = await auth();
  const authUserId = getSessionAuthUserId(session);

  if (!authUserId) {
    return {
      authenticated: false,
      identityAccess: null,
    };
  }

  return {
    authenticated: true,
    identityAccess: await getIdentityAccessByAuthUserId(authUserId),
  };
}
