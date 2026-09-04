import type { DefaultSession } from "next-auth";
import type { DefaultJWT } from "next-auth/jwt";

/**
 * The only identity this application keeps in the token/session: a `staff_users.id`.
 * Everything else — role, email, display name — is re-read from the database on every
 * request (`getCurrentStaffUser`), so a revoked or demoted row takes effect immediately.
 */
declare module "next-auth" {
  interface Session extends DefaultSession {
    staffUserId?: string;
  }
}

declare module "next-auth/jwt" {
  interface JWT extends DefaultJWT {
    staffUserId?: string;
  }
}
