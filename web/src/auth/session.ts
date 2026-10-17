import "server-only";
import { headers } from "next/headers";
import { getDb, getDbPool } from "../db/client";
import { createStaffAuth } from "./foundation";
import { getAuthConfig } from "./config";
import { AuthSecurityStore, activeStaff, fullStaffSession } from "./security-store";

export async function getStaffSession() {
  const requestHeaders = await headers();
  const config = getAuthConfig();
  if (!config.writesEnabled) return null;
  const store = new AuthSecurityStore(getDbPool(), config.secret);
  const result = await createStaffAuth(getDb(), store, config).api.getSession({
    headers: requestHeaders, query: { disableRefresh: true, disableCookieCache: true },
  });
  if (!result) return null;
  const [user, session] = await Promise.all([store.user(result.user.id), store.session(result.session.token)]);
  if (!activeStaff(user) || !session || session.securityRevision !== user.securityRevision || !user.emailVerified) return null;
  return { user, session, fullAccess: fullStaffSession(user, session) };
}
