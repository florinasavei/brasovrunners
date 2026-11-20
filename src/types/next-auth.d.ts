import type { DefaultSession } from "next-auth";
import type { DefaultJWT } from "next-auth/jwt";

/**
 * The only identity this application keeps in the token/session: a `staff_users.id`.
 * Everything else — role, email, display name — is re-read from the database on every
 * request (`getCurrentStaffUser`), so a revoked or demoted row takes effect immediately.
 *
 * Beside it, since §1026, the moment the session was signed in (`signedInAt`, milliseconds since
 * the epoch): written by the `jwt` callback at a sign-in and only then (`staffTokenAt`), kept as
 * the token is refreshed — the team's undertaking is owed once per sign-in. A token issued before
 * §1026 carries none.
 */
declare module "next-auth" {
  interface Session extends DefaultSession {
    staffUserId?: string;
    signedInAt?: number;
  }
}

declare module "next-auth/jwt" {
  interface JWT extends DefaultJWT {
    staffUserId?: string;
    signedInAt?: number;
  }
}
