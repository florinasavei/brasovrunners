import { and, eq, isNull } from "drizzle-orm";
import { eventVolunteerInvitations, type EventVolunteerInvitation } from "@/db/schema/event-volunteer-invitations";
import { events } from "@/db/schema/events";
import type { Database, Transaction } from "@/db/types";
import { generateTokenSecret, hashTokenSecret, isWellFormedTokenSecret } from "@/modules/action-tokens/domain/token-secret";
import { recordAuditEvent } from "@/modules/audit/repository";
import { canonicalOrNull } from "./agreement";
import { type InviteReading, invitationStandingOf } from "./domain/access";
import { volunteerEventAhead } from "./domain/volunteer";

/**
 * The link of an invitation to volunteer (§NNN; the registrations' invitation, §647, is the model; AGENTS.md §12.8, BR-REQ-036-02):
 * the three primitives under the volunteers' page and the sign-up, kept apart from the verbs of `invitations.ts` so the sign-up
 * (`volunteers.ts`) can spend a link without importing the module that imports it.
 *
 * - **minted** when the email is rendered (`notifications/render.ts`), never when it is queued: the secret is in that email alone
 *   (§14.5), the row keeps its SHA-256, and a newer email replaces the older link in the same statement;
 * - **read** by the page's GET — a SELECT, nothing is written (GET never mutates);
 * - **spent** by the sign-up, in the same transaction that writes the volunteer, by one conditional UPDATE: of two presses at once
 *   only one wins, and a refusal anywhere after it takes the spend back with the rest.
 *
 * A link answers one generic «invalid» for an unknown secret, a malformed one, and one that belongs to another event (§13.2) — a
 * visitor learns nothing about which invitations exist. The secret is 256 random bits, so no per-secret attempt budget is spent
 * (the registrations' link spends one; there the table of tokens is shared with the whole system).
 */

/**
 * A fresh link for one invitation, minted when its email leaves. Null for an invitation that has been used or withdrawn, whose event is
 * called off or over (asked now, never from the deadline stored at the send: a race moved later keeps its links), or whose address is not the one the email goes to (`recipientEmail`, compared through the
 * canonicalizer, §10.4): nothing left to invite, and the email is withdrawn.
 */
export async function mintVolunteerInvitationLink<T extends Record<string, unknown>>(
  db: Database<T>,
  invitationId: string,
  recipientEmail: string,
  now: Date,
): Promise<{ secret: string } | null> {
  const recipient = canonicalOrNull(recipientEmail);
  if (recipient === null) return null;
  const [event] = await db
    .select({ eventStatus: events.eventStatus, startsAt: events.startsAt, endsAt: events.endsAt })
    .from(eventVolunteerInvitations)
    .innerJoin(events, eq(events.id, eventVolunteerInvitations.eventId))
    .where(eq(eventVolunteerInvitations.id, invitationId))
    .limit(1);
  if (!event || !volunteerEventAhead(event, now)) return null;
  const secret = generateTokenSecret();
  const [row] = await db
    .update(eventVolunteerInvitations)
    .set({ tokenHash: hashTokenSecret(secret) })
    .where(
      and(
        eq(eventVolunteerInvitations.id, invitationId),
        eq(eventVolunteerInvitations.canonicalEmail, recipient),
        isNull(eventVolunteerInvitations.usedAt),
        isNull(eventVolunteerInvitations.withdrawnAt),
      ),
    )
    .returning({ id: eventVolunteerInvitations.id });
  return row ? { secret } : null;
}

/** What a link read came to: the invitation it names (for a live one, or one whose state the page says), and the reading for the door. */
export type InvitationLinkRead = { reading: InviteReading; invitation: EventVolunteerInvitation | null };

/**
 * The page's read of `?invite=<secret>` for one event (GET: nothing is written). No secret in the address is no link at all
 * (`reading: null`); anything the table cannot match to this event is `invalid`.
 */
export async function readVolunteerInvitationLink<T extends Record<string, unknown>>(
  db: Database<T>,
  eventId: string,
  secret: string | null | undefined,
  now: Date,
): Promise<InvitationLinkRead> {
  if (secret === null || secret === undefined || secret === "") return { reading: null, invitation: null };
  if (!isWellFormedTokenSecret(secret)) return { reading: { standing: "invalid" }, invitation: null };
  const [found] = await db
    .select({ invitation: eventVolunteerInvitations, eventStatus: events.eventStatus, startsAt: events.startsAt, endsAt: events.endsAt })
    .from(eventVolunteerInvitations)
    .innerJoin(events, eq(events.id, eventVolunteerInvitations.eventId))
    .where(eq(eventVolunteerInvitations.tokenHash, hashTokenSecret(secret)))
    .limit(1);
  if (!found || found.invitation.eventId !== eventId) return { reading: { standing: "invalid" }, invitation: null };
  return { reading: { standing: invitationStandingOf(found.invitation, volunteerEventAhead(found, now)) }, invitation: found.invitation };
}

/**
 * Spends the link in the sign-up's own transaction: `used_at` and the volunteer it became, by one UPDATE that asks the invitation
 * open again (not used, not withdrawn, before its date) — so a link withdrawn between the page and the press, or pressed twice at
 * once, spends nowhere — nor for an event called off or over (asked now, §NNN). Returns false when nothing was spent; the caller then rolls the sign-up back. One audit row, no actor: the
 * person, from the link (the invitation's and the volunteer's ids, never an address).
 */
export async function spendVolunteerInvitation<T extends Record<string, unknown>>(
  tx: Transaction<T>,
  input: { invitationId: string; eventId: string; volunteerId: string; now: Date },
): Promise<boolean> {
  const [event] = await tx.select({ eventStatus: events.eventStatus, startsAt: events.startsAt, endsAt: events.endsAt }).from(events).where(eq(events.id, input.eventId)).limit(1);
  if (!event || !volunteerEventAhead(event, input.now)) return false;
  const [row] = await tx
    .update(eventVolunteerInvitations)
    .set({ usedAt: input.now, volunteerId: input.volunteerId })
    .where(
      and(
        eq(eventVolunteerInvitations.id, input.invitationId),
        isNull(eventVolunteerInvitations.usedAt),
        isNull(eventVolunteerInvitations.withdrawnAt),
      ),
    )
    .returning({ id: eventVolunteerInvitations.id });
  if (!row) return false;
  await recordAuditEvent(tx, {
    actorStaffUserId: null,
    action: "volunteer_invitation.used",
    entityType: "event",
    entityId: input.eventId,
    metadata: { invitationId: input.invitationId, volunteerId: input.volunteerId },
    now: input.now,
  });
  return true;
}
