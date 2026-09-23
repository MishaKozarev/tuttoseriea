import NextAuth from "next-auth";

import { authAdapter } from "@/src/auth/adapter";
import { createStaffEmailProvider } from "@/src/auth/staff-email-provider";
import { canUseStaffMagicLinkLogin } from "@/src/auth/staff-login-policy";
import { resolveAdminAuthRedirectUrl } from "@/src/identity/admin-return";

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: authAdapter,
  providers: [createStaffEmailProvider()],
  pages: {
    error: "/admin/login",
    signIn: "/admin/login",
    verifyRequest: "/admin/login/verify-request",
  },
  session: {
    strategy: "database",
  },
  callbacks: {
    async redirect({ url, baseUrl }) {
      return resolveAdminAuthRedirectUrl(url, baseUrl);
    },
    async session({ session, user }) {
      if (session.user && user.id) {
        (session.user as typeof session.user & { id: string }).id = user.id;
      }

      return session;
    },
    async signIn({ email, user }) {
      return canUseStaffMagicLinkLogin(
        user.email,
        email?.verificationRequest === true,
      );
    },
  },
});
