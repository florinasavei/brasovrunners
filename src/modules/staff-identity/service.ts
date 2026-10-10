import { z } from "zod";
import type { StaffUser } from "@/db/schema/staff-users";
import type { Database } from "@/db/types";
import { recordAuditEvent } from "@/modules/audit/repository";
import { drainOutboxRowsAfterResponse } from "@/modules/notifications/drain";
import { type DeliveryChoice, markedForNow } from "@/modules/notifications/domain/send-at-once";
import { enqueueEmail } from "@/modules/notifications/outbox";
import { assertRoomToSendNow, outboxIdsForKey } from "@/modules/notifications/send-at-once";
import { DomainError } from "@/shared/errors/domain-error";
import {
  canAssignRole,
  canGrantPermission,
  canHoldPermission,
  canManageMember,
  canManageStaff,
  isBackofficeRole,
  isSuperadmin,
  STAFF_PERMISSIONS,
  STAFF_ROLES,
  type StaffPermission,
  type StaffRole,
} from "./domain/roles";
import { MEMBER_ROWS_MAX, type MemberRow } from "./domain/member-rows";
import { STAFF_ROLE_LABEL } from "./domain/staff-labels";
import {
  countSuperadministrators,
  deleteStaffPermissions,
  deleteStaffUser,
  findStaffUserByEmail,
  findStaffUserById,
  findStaffUsersAmong,
  insertStaffPermission,
  insertStaffUser,
  listStaffPermissions,
  listStaffUsers,
  normalizeStaffEmail,
  type StaffAccount,
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

function assertAdministrator(actor: Pick<StaffUser, "role">): void {
  if (!canManageStaff(actor.role)) {
    throw new DomainError("FORBIDDEN", `role ${actor.role} may not administer staff; the team is the Administrator's (§450)`);
  }
}

/** Giving `role` — an invitation or a role change: a Superadministrator only by another (§450). */
function assertMayAssign(actor: Pick<StaffUser, "role">, role: StaffRole): void {
  if (!canAssignRole(actor.role, role)) {
    throw new DomainError("FORBIDDEN", `role ${actor.role} may not give the role ${role}; only a Superadministrator makes another (§450)`);
  }
}

/** Acting on a colleague's row: a Superadministrator's row is a Superadministrator's (§450). */
function assertMayManage(actor: Pick<StaffUser, "role">, target: Pick<StaffUser, "role">): void {
  if (!canManageMember(actor.role, target.role)) {
    throw new DomainError("FORBIDDEN", `role ${actor.role} may not act on a ${target.role}'s access; only a Superadministrator does (§450)`);
  }
}

/**
 * The account verbs at the provider — the password link and switching an account off or on
 * (§171) — asked of the team's own row first (§450).
 *
 * They reach Zitadel, not `staff_users`, and used to ask only for a role at the door: the page
 * offered them on the team's rows, and the action took whatever address the form posted. Now the
 * address must be a colleague on the list, and one the actor may manage — an Administrator
 * cannot switch a Superadministrator's account off, which would lock the platform's settings
 * away from everybody while the row still said they were staff.
 */
export async function assertMayManageAccount<T extends Record<string, unknown>>(
  db: Database<T>,
  actor: Pick<StaffUser, "role">,
  email: string,
): Promise<StaffUser> {
  assertAdministrator(actor);
  const member = await findStaffUserByEmail(db, email);
  if (!member) throw new DomainError("NOT_FOUND", "no such staff user");
  assertMayManage(actor, member);
  return member;
}

/** The team, each row with the permissions granted to that person (§NNN) — «Echipa»'s ticks and chips. */
export async function listStaff<T extends Record<string, unknown>>(
  db: Database<T>,
  actor: StaffUser,
): Promise<StaffAccount[]> {
  assertAdministrator(actor);
  const [rows, grants] = await Promise.all([listStaffUsers(db), listStaffPermissions(db)]);
  return rows.map((row) => ({ ...row, permissions: grants.get(row.id) ?? new Set<StaffPermission>() }));
}

/**
 * «Gestionează magazinul» ticked or unticked on a colleague's row of «Echipa» (§NNN).
 *
 * Asserted here whatever the page offered (BR-REQ-060-01): the team is the actor's to manage
 * (`canManageStaff`), the colleague's row is theirs to touch and the colleague's role may hold the
 * permission (`canGrantPermission` — never a club member, never an Administrator, who has it by
 * rank, never a Superadministrator's row for an Administrator), and never the actor's own row, as a
 * role change is not. Idempotent: a second grant is the row already there and audits nothing; a
 * revoke of a grant that is not there is nothing done and audits nothing. Each change that happened
 * is one audit row — the colleague's id and the permission, never a name or an address.
 */
export async function setStaffPermission<T extends Record<string, unknown>>(
  db: Database<T>,
  actor: StaffUser,
  input: { targetId: string; permission: StaffPermission; on: boolean; now?: Date },
): Promise<{ changed: boolean }> {
  assertAdministrator(actor);
  const target = await findStaffUserById(db, input.targetId);
  if (!target) throw new DomainError("NOT_FOUND", "no such staff user");
  if (target.id === actor.id) throw new DomainError("FORBIDDEN", "an administrator cannot change their own permissions");
  if (!canGrantPermission(actor, target.role, input.permission)) {
    throw new DomainError("FORBIDDEN", `role ${actor.role} may not give ${input.permission} to a ${target.role} (§NNN)`);
  }
  const now = input.now ?? new Date();
  return db.transaction(async (tx) => {
    const changed = input.on
      ? await insertStaffPermission(tx, { staffUserId: target.id, permission: input.permission, grantedByStaffUserId: actor.id, now })
      : (await deleteStaffPermissions(tx, target.id, input.permission)).length > 0;
    if (changed) {
      await recordAuditEvent(tx, {
        actorStaffUserId: actor.id,
        action: input.on ? "staff.permission.granted" : "staff.permission.revoked",
        entityType: "staff_user",
        entityId: target.id,
        metadata: input.on ? { staffUserId: target.id, permission: input.permission } : { staffUserId: target.id, permission: input.permission, reason: "tick" },
        now,
      });
    }
    return { changed };
  });
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
  // Before the address is looked up: whether this actor may give this role at all (§450).
  assertMayAssign(actor, parsed.data.role);

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

/**
 * «Adaugă mai mulți membri» (§524): several club members in one press, each a `MEMBER` row with its
 * own invitation — the whole list or nobody.
 *
 * Every row is validated before any is inserted (§457's rule for a list of addresses): one row that
 * is not an address, one address already on the team with a backoffice role, or more than
 * `MEMBER_ROWS_MAX` rows, and the press adds nobody. The refusal names the box, `members`; the
 * action names the rows. The inserts and the invitations are one transaction, so a failure half-way
 * leaves no half of the list.
 *
 * An address that is already a **member** is not a refusal but `existing` (§524): pressing again
 * with the addresses whose sign-in account the provider refused is how they are retried. Such a row
 * gets no second row and no second platform invitation — only the account step the action runs
 * after the transaction.
 *
 * The existing-address check is a courtesy, as in `inviteStaffUser`: the unique index is the
 * authority, and a colleague adding the same person at the same moment rolls the whole press back.
 */
export async function inviteMembers<T extends Record<string, unknown>>(
  db: Database<T>,
  actor: StaffUser,
  input: { rows: readonly MemberRow[]; preferredLocale: "ro" | "en" },
): Promise<{ added: StaffUser[]; existing: StaffUser[] }> {
  assertAdministrator(actor);
  assertMayAssign(actor, "MEMBER");

  if (input.rows.length === 0) throw new DomainError("VALIDATION_ERROR", "no member rows", ["members"]);
  if (input.rows.length > MEMBER_ROWS_MAX) throw new DomainError("VALIDATION_ERROR", `more than ${MEMBER_ROWS_MAX} member rows`, ["members"]);
  const parsed = input.rows.map((row) =>
    staffInviteSchema.safeParse({ email: row.email, displayName: row.displayName, role: "MEMBER", preferredLocale: input.preferredLocale }),
  );
  if (parsed.some((result) => !result.success)) {
    throw new DomainError("VALIDATION_ERROR", "a member row is not an address", ["members"]);
  }
  const invites = parsed.map((result) => result.data as StaffInvite);
  const known = await findStaffUsersAmong(
    db,
    invites.map((invite) => invite.email),
  );
  if (known.some((row) => isBackofficeRole(row.role))) {
    throw new DomainError("CONFLICT", "some addresses are already on the team", ["members"]);
  }
  const existing = new Set(known.map((row) => row.email));

  const now = new Date();
  const added = await db.transaction(async (tx) => {
    const members: StaffUser[] = [];
    for (const invite of invites) {
      const email = normalizeStaffEmail(invite.email);
      if (existing.has(email)) continue;
      const member = await insertStaffUser(tx, { ...invite, email });
      await enqueueStaffInvitation(tx, actor, member, now);
      members.push(member);
    }
    return members;
  });
  return { added, existing: known };
}

/** The invitation again (§123, §141): a new row with its own key — a resend is a new trigger. */
export async function resendStaffInvitation<T extends Record<string, unknown>>(
  db: Database<T>,
  actor: StaffUser,
  email: string,
  now = new Date(),
  /**
   * «now» sends it after this response, past the scheduled pass (§540), as a registration's resend
   * does; «queue», the default, leaves it to «Când pleacă emailurile».
   */
  delivery: DeliveryChoice = "queue",
): Promise<StaffUser> {
  assertAdministrator(actor);
  const member = await findStaffUserByEmail(db, email);
  if (!member) throw new DomainError("NOT_FOUND", "no such staff user");
  assertMayManage(actor, member);
  if (member.firstSignedInAt) throw new DomainError("CONFLICT", "this person has signed in already; there is nothing to invite them to");
  // Inside the day's allowance, asked before anything is queued (§80, §540): a refusal leaves nothing.
  if (delivery === "now") await assertRoomToSendNow(db, [invitationMessageType(member)], now);
  const key = await db.transaction(async (tx) => {
    const queued = await enqueueStaffInvitation(tx, actor, member, now, true, delivery);
    // The press on the audit trail (§540): who, which message, and that it passed the round.
    if (delivery === "now" && queued.id) {
      await recordAuditEvent(tx, {
        actorStaffUserId: actor.id,
        action: "staff.invitation_sent_now",
        entityType: "staff_user",
        entityId: member.id,
        metadata: { outboxId: queued.id, messageType: invitationMessageType(member), bypassedSchedule: true },
        now,
      });
    }
    return queued.key;
  });
  // The invitation, after this response, whatever «Când pleacă emailurile» says (§540).
  if (delivery === "now") drainOutboxRowsAfterResponse(await outboxIdsForKey(db, key));
  return member;
}

/** A club member is invited to the members' zone, never to "the team that runs the site" (§524). */
function invitationMessageType(member: StaffUser): "STAFF_INVITATION" | "MEMBER_INVITATION" {
  return isBackofficeRole(member.role) ? "STAFF_INVITATION" : "MEMBER_INVITATION";
}

async function enqueueStaffInvitation<T extends Record<string, unknown>>(
  tx: Parameters<typeof enqueueEmail<T>>[0],
  actor: StaffUser,
  member: StaffUser,
  now: Date,
  isManualResend = false,
  delivery: DeliveryChoice = "queue",
): Promise<{ id: string | null; key: string }> {
  const key = `staff:${member.id}:invitation:${now.toISOString()}`;
  const queued = await enqueueEmail(tx, {
    participantId: null,
    registrationId: null,
    // The same row, the same sign-in, its own words (§524).
    messageType: invitationMessageType(member),
    locale: member.preferredLocale,
    recipientEmail: member.email,
    // Marked for the queue panel's «Pleacă acum» on a press that sends now (§540).
    payload: markedForNow({ displayName: member.displayName, role: STAFF_ROLE_LABEL[member.role], inviterName: actor.displayName }, delivery),
    idempotencyKey: key,
    requestedByStaffUserId: actor.id,
    isManualResend,
    now,
    // Sent now by the press's own drain after the transaction (§540), not by the timing's.
    drainAfter: delivery !== "now",
  });
  return { id: queued?.id ?? null, key };
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
   * Superadministrator cannot be demoted, because only a Superadministrator makes another (§450)
   * and the platform's settings would have nobody left who may change them.
   */
  if (target.id === actor.id) {
    throw new DomainError("FORBIDDEN", "an administrator cannot change their own role");
  }
  // A Superadministrator's row, and the Superadministrator's role, are a Superadministrator's
  // to touch (§450): an Administrator neither demotes the owner nor promotes a colleague to it.
  assertMayManage(actor, target);
  assertMayAssign(actor, role);
  if (
    isSuperadmin(target.role) &&
    !isSuperadmin(role) &&
    (await countSuperadministrators(db)) <= 1
  ) {
    throw new DomainError("CONFLICT", "the last superadministrator cannot be demoted");
  }

  /*
    The person's grants go with a role that may not hold them (§NNN), in the same transaction as the
    role: a colleague made a club member keeps no grant (a member is no staff, §524), and one made an
    Administrator has the permission by rank — a grant left behind would come back, unseen, on a
    later demotion. Each removal is audited with the reason `role_change`.
  */
  const now = new Date();
  return db.transaction(async (tx) => {
    const updated = await updateStaffUserRole(tx, targetId, role);
    if (!updated) throw new DomainError("NOT_FOUND", "no such staff user");
    for (const permission of STAFF_PERMISSIONS) {
      if (canHoldPermission(role, permission)) continue;
      const removed = await deleteStaffPermissions(tx, targetId, permission);
      if (removed.length === 0) continue;
      await recordAuditEvent(tx, {
        actorStaffUserId: actor.id,
        action: "staff.permission.revoked",
        entityType: "staff_user",
        entityId: targetId,
        metadata: { staffUserId: targetId, permission, reason: "role_change" },
        now,
      });
    }
    return updated;
  });
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
  assertMayManage(actor, target);
  if (isSuperadmin(target.role) && (await countSuperadministrators(db)) <= 1) {
    throw new DomainError("CONFLICT", "the last superadministrator cannot be removed");
  }

  await deleteStaffUser(db, targetId);
}
