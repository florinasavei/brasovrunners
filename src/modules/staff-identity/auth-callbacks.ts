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
 * Why a sign-in was refused — for the server log, never for the screen.
 *
 * `NO_EMAIL_CLAIM` is the one that actually happens, and it happened twice: the Zitadel
 * application's "Include user's profile info in the ID Token" is off, so the token carries no
 * `email` and the gate has nothing to match. It is indistinguishable on screen from an
 * uninvited account, which is the point of the screen and was the whole cost of diagnosing it.
 */
export type SignInRefusal = "NO_EMAIL_CLAIM" | "EMAIL_NOT_VERIFIED" | "NOT_INVITED" | "EMAIL_BOUND_ELSEWHERE";

function refuse(reason: SignInRefusal): false {
  /**
   * The reason, and nothing that identifies a person: no address, no subject, no display name
   * (§14.5, §19.2). Which of the four it is narrows the cause to one action, and none of them
   * needs to know *who* was refused — the four reasons are a property of the configuration or
   * of the allowlist, not of the human at the keyboard.
   */
  console.warn(`staff sign-in refused: ${reason} (AGENTS.md §13.1)`);
  return false;
}

/**
 * Whether this Zitadel account may sign in at all — steps 1-3 of §13.1.
 *
 * `true` covers two cases: a subject already bound to a `staff_users` row, or the first
 * sign-in from an invited-but-unbound row, which this function also binds as a side effect.
 * Every other case — no verified email, an uninvited address, an address already bound to a
 * different subject — returns `false` **identically to the caller**, so a stranger learns
 * nothing about which. The difference goes to the server log alone, because "Access Denied"
 * with no other record leaves an administrator guessing between a missing checkbox in an
 * identity provider and a row nobody inserted.
 */
export async function resolveZitadelSignIn<T extends Record<string, unknown>>(
  db: Database<T>,
  profile: ZitadelProfile,
  now: Date,
): Promise<boolean> {
  if (!profile.email) return refuse("NO_EMAIL_CLAIM");
  if (!profile.emailVerified) return refuse("EMAIL_NOT_VERIFIED");

  const bySubject = await findStaffUserByZitadelSubject(db, profile.subject);
  if (bySubject) return true;

  const invited = await findStaffUserByEmail(db, profile.email);
  if (!invited) return refuse("NOT_INVITED");
  if (invited.zitadelSubject !== null) return refuse("EMAIL_BOUND_ELSEWHERE");

  await recordFirstSignIn(db, invited.id, profile.subject, now);
  return true;
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
