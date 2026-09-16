import NextAuth from "next-auth";
import Zitadel from "next-auth/providers/zitadel";
import { getDb } from "@/db/client";
import { resolveStaffUserId, resolveZitadelSignIn } from "@/modules/staff-identity/auth-callbacks";

/**
 * Auth.js, configured with the Zitadel OAuth provider (AGENTS.md §13.1, DECISIONS.md §26).
 *
 * No adapter and no `accounts`/`sessions` tables: the JWT session strategy needs neither, and
 * `staff_users` stays the only persisted identity state, exactly as it did under the
 * development switcher. `AUTH_ZITADEL_ID`/`AUTH_ZITADEL_SECRET`/`AUTH_ZITADEL_ISSUER` are read
 * by Auth.js's own environment-variable inference — verified against the current Auth.js
 * documentation before this was written — so the provider needs no explicit config object here.
 *
 * The allowlist gate and the first-sign-in binding are pure functions in
 * `modules/staff-identity/auth-callbacks.ts`; this file is wiring over them, kept thin so the
 * decision logic is testable without constructing a NextAuth instance.
 */
export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [Zitadel],
  session: { strategy: "jwt" },
  callbacks: {
    async signIn({ account, profile }) {
      if (account?.provider !== "zitadel" || !account.providerAccountId) return false;

      return resolveZitadelSignIn(
        getDb(),
        {
          subject: account.providerAccountId,
          email: typeof profile?.email === "string" ? profile.email : null,
          emailVerified: profile?.email_verified,
        },
        new Date(),
      );
    },

    /** Carries only the row id. Role and email are re-read from `staff_users` on every
     * request (`getCurrentStaffUser`), so a revoked or demoted row takes effect immediately
     * rather than waiting for the token to expire. */
    async jwt({ token, account, profile }) {
      if (account?.provider === "zitadel" && account.providerAccountId) {
        const staffUserId = await resolveStaffUserId(getDb(), {
          subject: account.providerAccountId,
          email: typeof profile?.email === "string" ? profile.email : null,
        });
        if (staffUserId) token.staffUserId = staffUserId;
      }
      return token;
    },

    async session({ session, token }) {
      if (typeof token.staffUserId === "string") {
        session.staffUserId = token.staffUserId;
      }
      return session;
    },
  },
});
