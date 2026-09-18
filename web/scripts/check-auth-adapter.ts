import crypto from "node:crypto";

import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { config } from "dotenv";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import type {
  AdapterAccount,
  AdapterAuthenticator,
  AdapterSession,
  AdapterUser,
  VerificationToken,
} from "next-auth/adapters";

import * as schema from "../src/db/schema";
import { authTables } from "../src/db/schema/auth";

const { Pool } = pg;

config({ path: ".env.local", quiet: true });
config({ path: ".env", quiet: true });

function requireEnv(name: string): string {
  const value = process.env[name];

  if (!value) {
    throw new Error(`${name} is required`);
  }

  return value;
}

function requireAdapterMethod<T>(
  method: T | undefined,
  name: string,
): NonNullable<T> {
  if (typeof method !== "function") {
    throw new Error(`Auth.js adapter method ${name} is not available`);
  }

  return method as NonNullable<T>;
}

function logError(error: unknown): void {
  if (error instanceof Error) {
    console.error(error.stack ?? error.message);
    return;
  }

  console.error(error);
}

function assertValue<T>(value: T | null | undefined, label: string): T {
  if (value == null) {
    throw new Error(`${label} returned no value`);
  }

  return value;
}

async function ignoreCleanupError(operation: () => unknown): Promise<void> {
  try {
    await operation();
  } catch {
    // Cleanup is best-effort. The first operation failure remains the useful signal.
  }
}

async function main(): Promise<void> {
  const pool = new Pool({
    connectionString: requireEnv("DATABASE_URL"),
    max: 1,
  });
  const db = drizzle(pool, { schema });
  const adapter = DrizzleAdapter(db, authTables);

  const createUser = requireAdapterMethod(adapter.createUser, "createUser");
  const getUser = requireAdapterMethod(adapter.getUser, "getUser");
  const getUserByEmail = requireAdapterMethod(adapter.getUserByEmail, "getUserByEmail");
  const updateUser = requireAdapterMethod(adapter.updateUser, "updateUser");
  const deleteUser = requireAdapterMethod(adapter.deleteUser, "deleteUser");
  const linkAccount = requireAdapterMethod(adapter.linkAccount, "linkAccount");
  const getAccount = requireAdapterMethod(adapter.getAccount, "getAccount");
  const getUserByAccount = requireAdapterMethod(adapter.getUserByAccount, "getUserByAccount");
  const unlinkAccount = requireAdapterMethod(adapter.unlinkAccount, "unlinkAccount");
  const createSession = requireAdapterMethod(adapter.createSession, "createSession");
  const getSessionAndUser = requireAdapterMethod(
    adapter.getSessionAndUser,
    "getSessionAndUser",
  );
  const updateSession = requireAdapterMethod(adapter.updateSession, "updateSession");
  const deleteSession = requireAdapterMethod(adapter.deleteSession, "deleteSession");
  const createVerificationToken = requireAdapterMethod(
    adapter.createVerificationToken,
    "createVerificationToken",
  );
  const consumeVerificationToken = requireAdapterMethod(
    adapter.useVerificationToken,
    "useVerificationToken",
  );
  const createAuthenticator = requireAdapterMethod(
    adapter.createAuthenticator,
    "createAuthenticator",
  );
  const getAuthenticator = requireAdapterMethod(adapter.getAuthenticator, "getAuthenticator");
  const listAuthenticatorsByUserId = requireAdapterMethod(
    adapter.listAuthenticatorsByUserId,
    "listAuthenticatorsByUserId",
  );
  const updateAuthenticatorCounter = requireAdapterMethod(
    adapter.updateAuthenticatorCounter,
    "updateAuthenticatorCounter",
  );

  const suffix = crypto.randomUUID();
  const email = `auth-check-${suffix}@example.invalid`;
  const provider = "auth-js-foundation-check";
  const providerAccountId = `provider-account-${suffix}`;
  const sessionToken = `session-${suffix}`;
  const verificationIdentifier = `verification-${suffix}`;
  const verificationTokenValue = `token-${suffix}`;
  const credentialID = `credential-${suffix}`;

  let user: AdapterUser | null = null;
  let sessionCreated = false;
  let accountLinked = false;
  let verificationTokenCreated = false;

  try {
    user = assertValue(
      await createUser({
        id: suffix,
        name: "Auth.js Foundation Check",
        email,
        emailVerified: null,
        image: null,
      }),
      "createUser",
    ) as AdapterUser;

    const fetchedUser = assertValue(await getUser(user.id), "getUser");

    if (fetchedUser.email !== email) {
      throw new Error("getUser returned an unexpected user");
    }

    const fetchedByEmail = assertValue(await getUserByEmail(email), "getUserByEmail");

    if (fetchedByEmail.id !== user.id) {
      throw new Error("getUserByEmail returned an unexpected user");
    }

    user = assertValue(
      await updateUser({
        id: user.id,
        name: "Auth.js Foundation Check Updated",
      }),
      "updateUser",
    ) as AdapterUser;

    const account: AdapterAccount = {
      userId: user.id,
      type: "oauth",
      provider,
      providerAccountId,
    };

    await linkAccount(account);
    accountLinked = true;

    const fetchedAccount = assertValue(
      await getAccount(providerAccountId, provider),
      "getAccount",
    );

    if (fetchedAccount.userId !== user.id) {
      throw new Error("getAccount returned an unexpected account");
    }

    const accountUser = assertValue(
      await getUserByAccount({ provider, providerAccountId }),
      "getUserByAccount",
    );

    if (accountUser.id !== user.id) {
      throw new Error("getUserByAccount returned an unexpected user");
    }

    await unlinkAccount({ provider, providerAccountId });
    accountLinked = false;

    const session: AdapterSession = {
      sessionToken,
      userId: user.id,
      expires: new Date(Date.now() + 60 * 60 * 1000),
    };

    const createdSession = assertValue(await createSession(session), "createSession");
    sessionCreated = true;

    if (createdSession.userId !== user.id) {
      throw new Error("createSession returned an unexpected session");
    }

    const sessionAndUser = assertValue(
      await getSessionAndUser(sessionToken),
      "getSessionAndUser",
    );

    if (sessionAndUser.user.id !== user.id) {
      throw new Error("getSessionAndUser returned an unexpected user");
    }

    const updatedSession = assertValue(
      await updateSession({
        sessionToken,
        expires: new Date(Date.now() + 2 * 60 * 60 * 1000),
      }),
      "updateSession",
    );

    if (updatedSession.sessionToken !== sessionToken) {
      throw new Error("updateSession returned an unexpected session");
    }

    await deleteSession(sessionToken);
    sessionCreated = false;

    const verificationToken: VerificationToken = {
      identifier: verificationIdentifier,
      token: verificationTokenValue,
      expires: new Date(Date.now() + 60 * 60 * 1000),
    };

    const createdVerificationToken = assertValue(
      await createVerificationToken(verificationToken),
      "createVerificationToken",
    );
    verificationTokenCreated = true;

    if (createdVerificationToken.token !== verificationTokenValue) {
      throw new Error("createVerificationToken returned an unexpected token");
    }

    const usedVerificationToken = assertValue(
      await consumeVerificationToken({
        identifier: verificationIdentifier,
        token: verificationTokenValue,
      }),
      "useVerificationToken",
    );
    verificationTokenCreated = false;

    if (usedVerificationToken.identifier !== verificationIdentifier) {
      throw new Error("useVerificationToken returned an unexpected token");
    }

    const authenticator: AdapterAuthenticator = {
      credentialID,
      userId: user.id,
      providerAccountId,
      credentialPublicKey: "auth-js-foundation-public-key",
      counter: 0,
      credentialDeviceType: "singleDevice",
      credentialBackedUp: false,
      transports: "usb",
    };

    const createdAuthenticator = assertValue(
      await createAuthenticator(authenticator),
      "createAuthenticator",
    );

    if (createdAuthenticator.credentialID !== credentialID) {
      throw new Error("createAuthenticator returned an unexpected authenticator");
    }

    const fetchedAuthenticator = assertValue(
      await getAuthenticator(credentialID),
      "getAuthenticator",
    );

    if (fetchedAuthenticator.userId !== user.id) {
      throw new Error("getAuthenticator returned an unexpected authenticator");
    }

    const userAuthenticators = await listAuthenticatorsByUserId(user.id);

    if (!userAuthenticators.some((entry) => entry.credentialID === credentialID)) {
      throw new Error("listAuthenticatorsByUserId did not include the test authenticator");
    }

    const updatedAuthenticator = assertValue(
      await updateAuthenticatorCounter(credentialID, 1),
      "updateAuthenticatorCounter",
    );

    if (updatedAuthenticator.counter !== 1) {
      throw new Error("updateAuthenticatorCounter returned an unexpected counter");
    }
  } finally {
    if (verificationTokenCreated) {
      await ignoreCleanupError(() =>
        consumeVerificationToken({
          identifier: verificationIdentifier,
          token: verificationTokenValue,
        }),
      );
    }

    if (sessionCreated) {
      await ignoreCleanupError(() => deleteSession(sessionToken));
    }

    if (accountLinked) {
      await ignoreCleanupError(() => unlinkAccount({ provider, providerAccountId }));
    }

    if (user) {
      const userId = user.id;

      await ignoreCleanupError(() => deleteUser(userId));
    }

    await pool.end();
  }

  console.log("Auth.js Drizzle adapter lifecycle check passed.");
  console.log("auth_adapter_create_user=true");
  console.log("auth_adapter_sessions=true");
  console.log("auth_adapter_accounts=true");
  console.log("auth_adapter_verification_tokens=true");
  console.log("auth_adapter_authenticators=true");
  console.log("auth_adapter_cleanup=true");
}

main().catch((error: unknown) => {
  logError(error);
  process.exitCode = 1;
});
