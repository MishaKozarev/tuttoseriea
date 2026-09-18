import { DrizzleAdapter } from "@auth/drizzle-adapter";
import type { Adapter } from "next-auth/adapters";

import { getDb } from "@/src/db";
import { authTables } from "@/src/db/schema/auth";

let adapter: Adapter | undefined;

function getAuthAdapter(): Adapter {
  adapter ??= DrizzleAdapter(getDb(), authTables);
  return adapter;
}

function requireAdapterMethod<K extends keyof Adapter>(name: K): NonNullable<Adapter[K]> {
  const method = getAuthAdapter()[name];

  if (typeof method !== "function") {
    throw new Error(`Auth.js adapter method ${String(name)} is not available`);
  }

  return method as NonNullable<Adapter[K]>;
}

export const authAdapter: Adapter = {
  createUser: (...args) => requireAdapterMethod("createUser")(...args),
  getUser: (...args) => requireAdapterMethod("getUser")(...args),
  getUserByEmail: (...args) => requireAdapterMethod("getUserByEmail")(...args),
  getUserByAccount: (...args) => requireAdapterMethod("getUserByAccount")(...args),
  updateUser: (...args) => requireAdapterMethod("updateUser")(...args),
  deleteUser: (...args) => requireAdapterMethod("deleteUser")(...args),
  linkAccount: (...args) => requireAdapterMethod("linkAccount")(...args),
  unlinkAccount: (...args) => requireAdapterMethod("unlinkAccount")(...args),
  getAccount: (...args) => requireAdapterMethod("getAccount")(...args),
  createSession: (...args) => requireAdapterMethod("createSession")(...args),
  getSessionAndUser: (...args) => requireAdapterMethod("getSessionAndUser")(...args),
  updateSession: (...args) => requireAdapterMethod("updateSession")(...args),
  deleteSession: (...args) => requireAdapterMethod("deleteSession")(...args),
  createVerificationToken: (...args) =>
    requireAdapterMethod("createVerificationToken")(...args),
  useVerificationToken: (...args) => requireAdapterMethod("useVerificationToken")(...args),
  createAuthenticator: (...args) => requireAdapterMethod("createAuthenticator")(...args),
  getAuthenticator: (...args) => requireAdapterMethod("getAuthenticator")(...args),
  listAuthenticatorsByUserId: (...args) =>
    requireAdapterMethod("listAuthenticatorsByUserId")(...args),
  updateAuthenticatorCounter: (...args) =>
    requireAdapterMethod("updateAuthenticatorCounter")(...args),
};
