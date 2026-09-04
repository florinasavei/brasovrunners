import { z } from "zod";
import type { StaffUser } from "@/db/schema/staff-users";
import type { Database } from "@/db/types";
import { DomainError } from "@/shared/errors/domain-error";
import { canManageStaff, STAFF_ROLES, type StaffRole } from "./domain/roles";
import {
  countAdministrators,
  deleteStaffUser,
  findStaffUserByEmail,
  findStaffUserById,
  insertStaffUser,
  listStaffUsers,
  normalizeStaffEmail,
  updateStaffUserRole,
} from "./repository";

/**
 * Staff administration: who exists, and what each of them may do (BR-REQ-060-01).
 *
 * There is no invitation email. There cannot be one yet — delivery to a real person needs the
 * club's sending domain, which is the same blocker registration waits on — and inventing a
 * message the club has not approved is forbidden by AGENTS.md §1.2. The row *is* the
 * invitation: an Administrator records the colleague's address and role, and the first time
 * that person signs in, the identity provider's subject is bound to the row that was waiting
 * for them. No row, no access, whatever a provider asserts.
 *
 * Every function takes the acting staff user explicitly rather than reading a session. The
 * server asserts authorization here, once, and the pages and actions above pass in whoever
 * the request actually belongs to — which is what makes these rules testable without a
 * browser (BR-REQ-060-01 criterion 4).
 */

export const staffInviteSchema = z.object({
  email: z.email().max(320),
  displayName: z.string().trim().min(1).max(200),
  role: z.enum(STAFF_ROLES),
  preferredLocale: z.enum(["ro", "en"]).default("ro"),
});

export type StaffInvite = z.infer<typeof staffInviteSchema>;

function assertAdministrator(actor: StaffUser): void {
  if (!canManageStaff(actor.role)) {
    throw new DomainError(
      "FORBIDDEN",
      `role ${actor.role} may not administer staff; AGENTS.md §10.2 reserves roles to ADMIN`,
    );
  }
}

export async function listStaff<T extends Record<string, unknown>>(
  db: Database<T>,
  actor: StaffUser,
): Promise<StaffUser[]> {
  assertAdministrator(actor);
  return listStaffUsers(db);
}

export async function inviteStaffUser<T extends Record<string, unknown>>(
  db: Database<T>,
  actor: StaffUser,
  input: unknown,
): Promise<StaffUser> {
  assertAdministrator(actor);

  const parsed = staffInviteSchema.safeParse(input);
  if (!parsed.success) {
    throw new DomainError("VALIDATION_ERROR", parsed.error.issues.map((i) => i.message).join("; "));
  }

  // Checked before inserting so the Administrator gets "this person is already staff" rather
  // than a unique-violation stack. The database constraint stays the authority: two requests
  // arriving together both pass this check and exactly one insert survives.
  const existing = await findStaffUserByEmail(db, parsed.data.email);
  if (existing) {
    throw new DomainError("CONFLICT", "a staff user with this email address already exists");
  }

  return insertStaffUser(db, { ...parsed.data, email: normalizeStaffEmail(parsed.data.email) });
}

export async function changeStaffRole<T extends Record<string, unknown>>(
  db: Database<T>,
  actor: StaffUser,
  targetId: string,
  role: StaffRole,
): Promise<StaffUser> {
  assertAdministrator(actor);

  const target = await findStaffUserById(db, targetId);
  if (!target) throw new DomainError("NOT_FOUND", "no such staff user");

  /**
   * Two refusals that exist to keep the club out of a locked backoffice.
   *
   * An Administrator cannot change their own role: the usual way this goes wrong is someone
   * "tidying up" their own account to EDITOR and discovering nobody can undo it. And the last
   * Administrator cannot be demoted, because staff administration is the only door back in.
   */
  if (target.id === actor.id) {
    throw new DomainError("FORBIDDEN", "an administrator cannot change their own role");
  }
  if (target.role === "ADMIN" && role !== "ADMIN" && (await countAdministrators(db)) <= 1) {
    throw new DomainError("CONFLICT", "the last administrator cannot be demoted");
  }

  const updated = await updateStaffUserRole(db, targetId, role);
  if (!updated) throw new DomainError("NOT_FOUND", "no such staff user");
  return updated;
}

/**
 * Remove someone's access.
 *
 * The row is deleted rather than flagged: it is the allowlist, and an allowlist entry that
 * means "not allowed" is a bug waiting for a query that forgets the flag. Everything they
 * authored survives — the attribution columns are `ON DELETE SET NULL`, so a departing
 * volunteer takes no event page with them.
 */
export async function revokeStaffUser<T extends Record<string, unknown>>(
  db: Database<T>,
  actor: StaffUser,
  targetId: string,
): Promise<void> {
  assertAdministrator(actor);

  const target = await findStaffUserById(db, targetId);
  if (!target) throw new DomainError("NOT_FOUND", "no such staff user");

  if (target.id === actor.id) {
    throw new DomainError("FORBIDDEN", "an administrator cannot remove their own access");
  }
  if (target.role === "ADMIN" && (await countAdministrators(db)) <= 1) {
    throw new DomainError("CONFLICT", "the last administrator cannot be removed");
  }

  await deleteStaffUser(db, targetId);
}
