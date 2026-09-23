import { z } from "zod";
import type { StaffUser } from "@/db/schema/staff-users";
import type { Database } from "@/db/types";
import { enqueueEmail } from "@/modules/notifications/outbox";
import { DomainError } from "@/shared/errors/domain-error";
import { canManageStaff, STAFF_ROLES, type StaffRole } from "./domain/roles";
import { STAFF_ROLE_LABEL } from "./domain/staff-labels";
import {
  countSuperadministrators,
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
 * The row *is* the invitation: an Administrator records the colleague's address and role, and
 * the first time that person signs in, the identity provider's subject is bound to the row
 * that was waiting for them. No row, no access, whatever a provider asserts. Since §141 the
 * platform also *tells* them — `STAFF_INVITATION`, queued in the same transaction as the row,
 * through the club's own outbox: who added them, as what, and the sign-in page. The Zitadel
 * account itself is created by the action when the club's key is set (§123), and otherwise by
 * the person at the sign-in page; either way the email is the same.
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
      `role ${actor.role} may not administer staff; AGENTS.md §10.2 reserves roles to SUPERADMIN`,
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
    throw new DomainError(
      "VALIDATION_ERROR",
      parsed.error.issues.map((i) => i.message).join("; "),
      // The boxes, so the form names them (§315) — the same names the form posts.
      [...new Set(parsed.error.issues.map((i) => i.path.join(".")).filter((path) => path !== ""))],
    );
  }

  // Checked before inserting so the Administrator gets "this person is already staff" rather
  // than a unique-violation stack. The database constraint stays the authority: two requests
  // arriving together both pass this check and exactly one insert survives.
  const existing = await findStaffUserByEmail(db, parsed.data.email);
  if (existing) {
    throw new DomainError("CONFLICT", "a staff user with this email address already exists");
  }

  const now = new Date();
  return db.transaction(async (tx) => {
    const member = await insertStaffUser(tx, { ...parsed.data, email: normalizeStaffEmail(parsed.data.email) });
    await enqueueStaffInvitation(tx, actor, member, now);
    return member;
  });
}

/** The invitation again (§123, §141): a new row with its own key — a resend is a new trigger. */
export async function resendStaffInvitation<T extends Record<string, unknown>>(
  db: Database<T>,
  actor: StaffUser,
  email: string,
  now = new Date(),
): Promise<StaffUser> {
  assertAdministrator(actor);
  const member = await findStaffUserByEmail(db, email);
  if (!member) throw new DomainError("NOT_FOUND", "no such staff user");
  if (member.firstSignedInAt) throw new DomainError("CONFLICT", "this person has signed in already; there is nothing to invite them to");
  await db.transaction((tx) => enqueueStaffInvitation(tx, actor, member, now, true));
  return member;
}

async function enqueueStaffInvitation<T extends Record<string, unknown>>(
  tx: Parameters<typeof enqueueEmail<T>>[0],
  actor: StaffUser,
  member: StaffUser,
  now: Date,
  isManualResend = false,
): Promise<void> {
  await enqueueEmail(tx, {
    participantId: null,
    registrationId: null,
    messageType: "STAFF_INVITATION",
    locale: member.preferredLocale,
    recipientEmail: member.email,
    payload: { displayName: member.displayName, role: STAFF_ROLE_LABEL[member.role], inviterName: actor.displayName },
    idempotencyKey: `staff:${member.id}:invitation:${now.toISOString()}`,
    requestedByStaffUserId: actor.id,
    isManualResend,
    now,
  });
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
   * "tidying up" their own account to MODERATOR and discovering nobody can undo it. And the last
   * Administrator cannot be demoted, because staff administration is the only door back in.
   */
  if (target.id === actor.id) {
    throw new DomainError("FORBIDDEN", "an administrator cannot change their own role");
  }
  if (
    target.role === "SUPERADMIN" &&
    role !== "SUPERADMIN" &&
    (await countSuperadministrators(db)) <= 1
  ) {
    throw new DomainError("CONFLICT", "the last superadministrator cannot be demoted");
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
  if (target.role === "SUPERADMIN" && (await countSuperadministrators(db)) <= 1) {
    throw new DomainError("CONFLICT", "the last superadministrator cannot be removed");
  }

  await deleteStaffUser(db, targetId);
}
