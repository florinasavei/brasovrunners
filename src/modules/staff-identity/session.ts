import { cookies } from "next/headers";
import { getDb } from "@/db/client";
import type { StaffUser } from "@/db/schema/staff-users";
import { DomainError } from "@/shared/errors/domain-error";
import { env } from "@/shared/config/env";
import { isDevStaffSwitcherEnabled } from "./dev-switcher";
import { type StaffRole } from "./domain/roles";
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
 * There is no real staff login yet (DECISIONS.md §24). With `STAFF_AUTH_MODE=disabled` — every
 * environment except local and test — `getCurrentStaffUser` returns null for every request,
 * so the backoffice answers nobody. That is the correct answer while the door has no lock,
 * and it is enforced here rather than by omitting the routes.
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
  if (!isDevStaffSwitcherEnabled()) return null;

  const id = (await cookies()).get(DEV_STAFF_COOKIE)?.value;
  if (!id) return null;

  // A cookie naming a staff user who has since been removed is not a session. Revoking
  // access has to take effect on the next request, not at the next sign-in.
  const staffUser = await findStaffUserById(getDb(), id);
  return staffUser ?? null;
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
 * Rank order, and why it is a rank at all.
 *
 * §10.2 describes three roles whose powers nest: an Editor may do everything an Author may,
 * an Administrator everything an Editor may. So `requireStaffRole("EDITOR")` means "at least
 * an Editor". It is a coarse gate — the interesting rules are conditional on the content
 * itself ("their own drafts") and live in `domain/roles.ts`, which every service consults
 * after this one has answered.
 */
const RANK: Record<StaffRole, number> = { AUTHOR: 0, EDITOR: 1, ADMIN: 2 };

export async function requireStaffRole(minimum: StaffRole): Promise<StaffUser> {
  const staffUser = await requireStaff();
  if (RANK[staffUser.role] < RANK[minimum]) {
    throw new DomainError(
      "FORBIDDEN",
      `role ${staffUser.role} is below the required ${minimum}`,
    );
  }
  return staffUser;
}
