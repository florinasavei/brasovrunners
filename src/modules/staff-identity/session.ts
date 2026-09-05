import { cookies } from "next/headers";
import { auth } from "@/auth";
import { getDb } from "@/db/client";
import type { StaffUser } from "@/db/schema/staff-users";
import { DomainError } from "@/shared/errors/domain-error";
import { env } from "@/shared/config/env";
import { isDevStaffSwitcherEnabled } from "./dev-switcher";
import { type StaffRole, atLeast } from "./domain/roles";
import { findStaffUserById } from "./repository";

/**
 * Who is signing this request, and the three helpers AGENTS.md §13.1 names.
 *
 * This is the only place a session is read. Everything below it — the CMS service, staff
 * administration, the roles table — takes the staff user as an argument, which is what allows
 * the rules to be tested without a browser and prevents a "well, the page already checked"
 * shortcut from appearing in a service function.
 *
 * `next/headers` is what keeps this on the server: importing it from a Client Component is a
 * build error, so no bundle can contain this module by accident.
 *
 * With `STAFF_AUTH_MODE=disabled` — the default everywhere until an operator turns on
 * `provider` for that environment (DECISIONS.md §26) — `getCurrentStaffUser` returns null for
 * every request, so the backoffice answers nobody. That is the correct answer while the door
 * has no lock, and it is enforced here rather than by omitting the routes.
 */

/**
 * The development switcher's cookie. Holds a `staff_users.id`, nothing else, and is read only
 * while the switcher is enabled.
 *
 * It is not signed, and that is not an oversight: a value that only means anything in local
 * and test cannot be forged into authority anywhere it would matter, because the mode that
 * reads it fails at startup in qa and production. The real session arrives with Auth.js and
 * will be signed by it — hand-rolling one now is exactly what §13.1 forbids.
 */
export const DEV_STAFF_COOKIE = "br_dev_staff";

export async function getCurrentStaffUser(): Promise<StaffUser | null> {
  if (isDevStaffSwitcherEnabled()) {
    const id = (await cookies()).get(DEV_STAFF_COOKIE)?.value;
    if (!id) return null;

    // A cookie naming a staff user who has since been removed is not a session. Revoking
    // access has to take effect on the next request, not at the next sign-in.
    return (await findStaffUserById(getDb(), id)) ?? null;
  }

  if (env.STAFF_AUTH_MODE === "provider") {
    const session = await auth();
    if (!session?.staffUserId) return null;

    // Re-read the row rather than trusting the token: a role change or a revoked access
    // takes effect on the very next request, not when the session eventually expires.
    return (await findStaffUserById(getDb(), session.staffUserId)) ?? null;
  }

  return null;
}

export async function requireStaff(): Promise<StaffUser> {
  const staffUser = await getCurrentStaffUser();
  if (!staffUser) {
    throw new DomainError(
      "UNAUTHENTICATED",
      `no staff session; STAFF_AUTH_MODE=${env.STAFF_AUTH_MODE}`,
    );
  }
  return staffUser;
}

/**
 * A coarse gate: "at least this role".
 *
 * The hierarchy itself lives in `domain/roles.ts` and is imported rather than restated — this
 * file used to keep its own copy of the rank, which is one rule in two places and exactly the
 * thing §1.5 forbids. The interesting rules are conditional on the content itself ("their own
 * drafts") and live there too; every service consults them after this one has answered.
 */
export async function requireStaffRole(minimum: StaffRole): Promise<StaffUser> {
  const staffUser = await requireStaff();
  if (!atLeast(staffUser.role, minimum)) {
    throw new DomainError(
      "FORBIDDEN",
      `role ${staffUser.role} is below the required ${minimum}`,
    );
  }
  return staffUser;
}
