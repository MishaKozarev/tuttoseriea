import NextAuth from "next-auth";

import { authAdapter } from "@/src/auth/adapter";

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: authAdapter,
  providers: [],
  session: {
    strategy: "database",
  },
});
