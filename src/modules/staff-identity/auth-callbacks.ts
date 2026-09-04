import type { Database } from "@/db/types";
import { findStaffUserByEmail, findStaffUserByZitadelSubject, recordFirstSignIn } from "./repository";

/**
 * The allowlist gate and the first-sign-in binding (AGENTS.md §13.1, DECISIONS.md §26).
 *
 * Pulled out of `src/auth.ts` so it is testable without constructing a NextAuth instance or a
 * real Zitadel exchange — the same reasoning `staff-identity/domain/roles.ts` gives for keeping
 * authorization rules as plain functions the server re-checks. `src/auth.ts` is thin wiring
 * over these two functions and nothing else.
 */

export type ZitadelProfile = {
  /** The provider's immutable subject claim (`account.providerAccountId`). */
  subject: string;
  email: string | null;
  emailVerified: boolean | null | undefined;
};

/**
 * Whether this Zitadel account may sign in at all — steps 1-3 of §13.1.
 *
 * `true` covers two cases: a subject already bound to a `staff_users` row, or the first
 * sign-in from an invited-but-unbound row, which this function also binds as a side effect.
 * Every other case — no verified email, an uninvited address, an address already bound to a
 * different subject — returns `false` identically, so a stranger learns nothing about which.
 */
export async function resolveZitadelSignIn<T extends Record<string, unknown>>(
  db: Database<T>,
  profile: ZitadelProfile,
  now: Date,
): Promise<boolean> {
  if (!profile.emailVerified || !profile.email) return false;

  const bySubject = await findStaffUserByZitadelSubject(db, profile.subject);
  if (bySubject) return true;

  const invited = await findStaffUserByEmail(db, profile.email);
  if (invited && invited.zitadelSubject === null) {
    await recordFirstSignIn(db, invited.id, profile.subject, now);
    return true;
  }

  return false;
}

/** The `staff_users.id` this Zitadel account maps to, once `resolveZitadelSignIn` has allowed it. */
export async function resolveStaffUserId<T extends Record<string, unknown>>(
  db: Database<T>,
  profile: { subject: string; email: string | null },
): Promise<string | undefined> {
  const bySubject = await findStaffUserByZitadelSubject(db, profile.subject);
  if (bySubject) return bySubject.id;

  if (profile.email) {
    const byEmail = await findStaffUserByEmail(db, profile.email);
    return byEmail?.id;
  }

  return undefined;
}
