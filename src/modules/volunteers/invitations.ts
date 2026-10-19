import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import { eventVolunteerInvitations, type EventVolunteerInvitation } from "@/db/schema/event-volunteer-invitations";
import { eventVolunteers } from "@/db/schema/event-volunteers";
import { events } from "@/db/schema/events";
import type { StaffUser } from "@/db/schema/staff-users";
import { staffUsers } from "@/db/schema/staff-users";
import type { Database, Transaction } from "@/db/types";
import type { Locale } from "@/i18n/routing";
import { recordAuditEvent } from "@/modules/audit/repository";
import { noticeDescribesVolunteerAgreement, noticeDescribesVolunteers, volunteerAgreementInForce } from "@/modules/legal-documents/repository";
import { enqueueEmail } from "@/modules/notifications/outbox";
import { canManageVolunteers } from "@/modules/staff-identity/domain/roles";
import { DomainError } from "@/shared/errors/domain-error";
import { isWrittenText, missingLanguage } from "@/shared/forms/both-languages";
import { isUuid } from "@/shared/ids";
import {
  invitationExpiry,
  invitationStandingOf,
  parseInvitationAddresses,
  VOLUNTEER_INVITATION_BATCH_MAX,
  VOLUNTEER_INVITATION_MESSAGE_MAX,
  VolunteerInvitationRefusal,
} from "./domain/access";
import { volunteerEventAhead, volunteerOfferClosedFor } from "./domain/volunteer";
import { readPublicVolunteerRoles } from "./volunteers";

/**
 * The club's invitations to volunteer (§NNN, amending §754 and §768; the registrations' invitations of §647 are the model, minus
 * everything that holds a place): «Invitații», the fold of the «Voluntari» card while «Cine se poate oferi» says «Doar cu invitație de
 * la club». Three verbs — send, send again, withdraw — and the read that lists them, each the Organizer's and the Administrators' to
 * make (`canManageVolunteers`, asserted here and in the Server Action behind each button; BR-REQ-060-01), each audited with the
 * invitation's id and never an address.
 *
 * **An invitation holds nothing and counts nothing.** It reserves no role's «needed» seat and no place of any race: the person
 * offers as anyone does, and the organizers give a role afterwards (§761). It is the door to the volunteers' page and nothing more
 * (`volunteers/domain/access.ts#volunteerDoorFor`); its link is minted when the email leaves and spent by the sign-up
 * (`invitation-link.ts`).
 *
 * **Nothing goes out that cannot work.** A send, and a «Retrimite», are refused while the offer itself is closed
 * (`volunteerOfferClosedFor`: not published, the event over or off, no role that needs people, the notice or the agreement in
 * force not describing volunteers): the link would lead to a page that answers 404. The card names the first condition missing.
 */

type Actor = Pick<StaffUser, "id" | "role">;

function assertMayManage(actor: Actor): void {
  if (!canManageVolunteers(actor.role)) throw new DomainError("FORBIDDEN", `role ${actor.role} may not invite volunteers`);
}

function assertId(id: string): void {
  if (!isUuid(id)) throw new DomainError("NOT_FOUND", "the event or the invitation is not there");
}

/** The event and what its offer says, read now (never from the public cache): the gate every verb asks. */
async function eventOfferClosed<T extends Record<string, unknown>>(db: Database<T> | Transaction<T>, eventId: string, now: Date) {
  const [event] = await db
    .select({
      id: events.id,
      eventStatus: events.eventStatus,
      editorialStatus: events.editorialStatus,
      membersOnly: events.membersOnly,
      acceptsVolunteers: events.acceptsVolunteers,
      volunteersAccess: events.volunteersAccess,
      startsAt: events.startsAt,
      endsAt: events.endsAt,
    })
    .from(events)
    .where(eq(events.id, eventId))
    .limit(1);
  if (!event) throw new DomainError("NOT_FOUND", "the event is not there");
  const offer = await readPublicVolunteerRoles(db as Database<T>, eventId);
  const closed = volunteerOfferClosedFor({
    acceptsVolunteers: event.acceptsVolunteers,
    standings: offer.roles,
    noticeDescribes: await noticeDescribesVolunteers(db as Database<T>, now),
    agreementInForce: await volunteerAgreementInForce(db as Database<T>, now),
    noticeDescribesAgreement: await noticeDescribesVolunteerAgreement(db as Database<T>, now),
    eventAhead: volunteerEventAhead(event, now),
    published: event.editorialStatus === "PUBLISHED",
    membersOnly: event.membersOnly,
  });
  return { event, closed };
}

export type VolunteerInvitationSendInput = {
  eventId: string;
  /** «Adrese (una pe rând)», as typed. */
  addresses: string;
  /**
   * «Mesaj (română)» and «Message (English)», optional: the club's line to every address of this press, in both languages or in
   * neither (§354) — each half of the email reads its own language's words, never the other's.
   */
  messageRo: string;
  messageEn: string;
  /** «Limba invitației»: the email's first half (both go out, §96). */
  locale: Locale;
};

export type VolunteerInvitationSendResult = {
  /** Invitations queued: new ones, and ones brought back that had been withdrawn or had run out. */
  sent: number;
  /** Addresses that already hold a live invitation: asked once, nothing sent again (that is «Retrimite»). */
  alreadyInvited: number;
  /** Addresses that already offered as volunteers at this event: there is nothing to invite them to. */
  alreadyOffered: number;
};

/**
 * «Trimite invitațiile»: one invitation per address, one email each. Refused whole — nothing written — when no address can be read
 * (`VINVITE_BAD_ADDRESS`, naming the pieces), there are none (`VINVITE_NOBODY`), more than a press may carry (`VINVITE_TOO_MANY`),
 * the line is too long or written in one language only (`VINVITE_MESSAGE_LONG`, `VINVITE_MESSAGE_ONE_LANGUAGE`), «Cine se poate oferi» is not «Doar cu invitație de la club» (`VINVITE_NOT_INVITED_ONLY`) or the offer is
 * closed (`VINVITE_EVENT_CLOSED`). Within an accepted list: an address with a live invitation is not sent a second one, one that has
 * already offered is not invited, and one whose invitation was withdrawn or ran out is brought back with the same row (the table
 * keeps one per address) — with its old link dead until the new email's is minted.
 */
export async function sendVolunteerInvitations<T extends Record<string, unknown>>(
  db: Database<T>,
  actor: Actor,
  input: VolunteerInvitationSendInput,
  now: Date,
): Promise<VolunteerInvitationSendResult> {
  assertMayManage(actor);
  assertId(input.eventId);
  const messageRo = input.messageRo.trim();
  const messageEn = input.messageEn.trim();
  if (messageRo.length > VOLUNTEER_INVITATION_MESSAGE_MAX || messageEn.length > VOLUNTEER_INVITATION_MESSAGE_MAX) throw new VolunteerInvitationRefusal("VINVITE_MESSAGE_LONG");
  // Both languages or neither (§354): one written alone would be said to the other half of the email as it stands.
  if (missingLanguage({ ro: messageRo, en: messageEn }, isWrittenText) !== null) throw new VolunteerInvitationRefusal("VINVITE_MESSAGE_ONE_LANGUAGE");
  const line = messageRo === "" ? { messageRo: null, messageEn: null } : { messageRo, messageEn };
  const parsed = parseInvitationAddresses(input.addresses);
  if (parsed.unread.length > 0) throw new VolunteerInvitationRefusal("VINVITE_BAD_ADDRESS", parsed.unread);
  if (parsed.addresses.length === 0) throw new VolunteerInvitationRefusal("VINVITE_NOBODY");
  if (parsed.addresses.length > VOLUNTEER_INVITATION_BATCH_MAX) throw new VolunteerInvitationRefusal("VINVITE_TOO_MANY");

  return db.transaction(async (tx) => {
    // Two sends for one event take turns (NO KEY UPDATE conflicts with itself, not with a sign-up's foreign-key check): the same address typed
    // in both is then asked once, not refused by the table's unique key halfway through.
    await tx.select({ id: events.id }).from(events).where(eq(events.id, input.eventId)).for("no key update").limit(1);
    const { event, closed } = await eventOfferClosed(tx, input.eventId, now);
    if (event.volunteersAccess !== "INVITED") throw new VolunteerInvitationRefusal("VINVITE_NOT_INVITED_ONLY");
    if (closed) throw new VolunteerInvitationRefusal("VINVITE_EVENT_CLOSED");
    const canonical = parsed.addresses.map((address) => address.canonicalEmail);
    const offered = new Set(
      (await tx.select({ email: eventVolunteers.canonicalEmail }).from(eventVolunteers).where(and(eq(eventVolunteers.eventId, event.id), inArray(eventVolunteers.canonicalEmail, canonical)))).map(
        (row) => row.email,
      ),
    );
    const invited = new Map(
      (await tx.select().from(eventVolunteerInvitations).where(and(eq(eventVolunteerInvitations.eventId, event.id), inArray(eventVolunteerInvitations.canonicalEmail, canonical)))).map((row) => [
        row.canonicalEmail,
        row,
      ]),
    );
    const expiresAt = invitationExpiry(event, now);
    const result: VolunteerInvitationSendResult = { sent: 0, alreadyInvited: 0, alreadyOffered: 0 };
    for (const address of parsed.addresses) {
      if (offered.has(address.canonicalEmail)) {
        result.alreadyOffered += 1;
        continue;
      }
      const existing = invited.get(address.canonicalEmail);
      // The event is ahead here (a send for one that is not is refused above), so a row neither used nor withdrawn is open.
      if (existing && invitationStandingOf(existing, true) === "open") {
        result.alreadyInvited += 1;
        continue;
      }
      // A used link means the person offered (caught above unless the row was deleted since): nothing to bring back.
      if (existing?.usedAt) {
        result.alreadyOffered += 1;
        continue;
      }
      let invitationId: string;
      if (existing) {
        // Withdrawn or run out: the same row, alive again. Its old link stays dead until the new email's is minted.
        await tx
          .update(eventVolunteerInvitations)
          .set({ withdrawnAt: null, withdrawnByStaffUserId: null, expiresAt, resentAt: now, tokenHash: null, ...line, locale: input.locale, deliveryEmail: address.deliveryEmail, invitedByStaffUserId: actor.id })
          .where(eq(eventVolunteerInvitations.id, existing.id));
        invitationId = existing.id;
      } else {
        const [row] = await tx
          .insert(eventVolunteerInvitations)
          .values({
            eventId: event.id,
            deliveryEmail: address.deliveryEmail,
            canonicalEmail: address.canonicalEmail,
            canonicalizationVersion: address.canonicalizationVersion,
            locale: input.locale,
            ...line,
            invitedByStaffUserId: actor.id,
            sentAt: now,
            expiresAt,
          })
          .returning({ id: eventVolunteerInvitations.id });
        invitationId = row.id;
      }
      await queueInvitationEmail(tx, { invitationId, eventId: event.id, locale: input.locale, recipient: address.deliveryEmail, key: "sent", now, actorId: null });
      await recordAuditEvent(tx, {
        actorStaffUserId: actor.id,
        action: "volunteer_invitation.sent",
        entityType: "event",
        entityId: event.id,
        metadata: { invitationId, ...(existing ? { revived: true } : {}) },
        now,
      });
      result.sent += 1;
    }
    return result;
  });
}

/** One `VOLUNTEER_INVITATION` in the outbox: the invitation and the event by id and nothing else (§12.12) — the words and the link are made at the send. */
async function queueInvitationEmail<T extends Record<string, unknown>>(
  tx: Transaction<T>,
  input: { invitationId: string; eventId: string; locale: Locale; recipient: string; key: "sent" | "resent"; now: Date; actorId: string | null },
): Promise<void> {
  await enqueueEmail(tx, {
    participantId: null,
    registrationId: null,
    messageType: "VOLUNTEER_INVITATION",
    locale: input.locale,
    recipientEmail: input.recipient,
    payload: { eventId: input.eventId, invitationId: input.invitationId },
    idempotencyKey: `volunteer-invitation:${input.invitationId}:${input.key}:${input.now.toISOString()}`,
    ...(input.key === "resent" ? { requestedByStaffUserId: input.actorId, isManualResend: true } : {}),
    now: input.now,
  });
}

/** An open invitation, asked again under the press: unknown is `VINVITE_NOT_FOUND`, one no longer open `VINVITE_NOT_OPEN`. */
async function openInvitation<T extends Record<string, unknown>>(tx: Transaction<T>, invitationId: string, now: Date): Promise<EventVolunteerInvitation> {
  const [row] = await tx.select().from(eventVolunteerInvitations).where(eq(eventVolunteerInvitations.id, invitationId)).for("update").limit(1);
  if (!row) throw new VolunteerInvitationRefusal("VINVITE_NOT_FOUND");
  // «Expirat» is the event's own state now, not the deadline stored at the send (§NNN): a race moved later keeps its invitations open.
  const [event] = await tx.select({ eventStatus: events.eventStatus, startsAt: events.startsAt, endsAt: events.endsAt }).from(events).where(eq(events.id, row.eventId)).limit(1);
  if (invitationStandingOf(row, event ? volunteerEventAhead(event, now) : false) !== "open") throw new VolunteerInvitationRefusal("VINVITE_NOT_OPEN");
  return row;
}

/**
 * «Retrimite»: another email to the same address, with a new link — the one the earlier email carried stops working at the press
 * (its fingerprint is cleared; the new email's is minted when it is rendered). Refused for an invitation that is no longer open
 * (the event's own state, not a stored deadline), and while the offer is closed.
 */
export async function resendVolunteerInvitation<T extends Record<string, unknown>>(db: Database<T>, actor: Actor, invitationId: string, now: Date): Promise<void> {
  assertMayManage(actor);
  assertId(invitationId);
  await db.transaction(async (tx) => {
    const invitation = await openInvitation(tx, invitationId, now);
    const { closed } = await eventOfferClosed(tx, invitation.eventId, now);
    if (closed) throw new VolunteerInvitationRefusal("VINVITE_EVENT_CLOSED");
    // The earlier link dies at the press, not when the new email is rendered: the paced outbox may hold the message a while (§12.8).
    await tx.update(eventVolunteerInvitations).set({ resentAt: now, tokenHash: null }).where(eq(eventVolunteerInvitations.id, invitation.id));
    await queueInvitationEmail(tx, { invitationId: invitation.id, eventId: invitation.eventId, locale: invitation.locale, recipient: invitation.deliveryEmail, key: "resent", now, actorId: actor.id });
    await recordAuditEvent(tx, {
      actorStaffUserId: actor.id,
      action: "volunteer_invitation.resent",
      entityType: "event",
      entityId: invitation.eventId,
      metadata: { invitationId: invitation.id },
      now,
    });
  });
}

/**
 * «Retrage»: the invitation ends now and its link says so (the page reads «Invitația a fost retrasă»). The row stays — so the same
 * address is not asked again by accident, and so the link can say what happened — and goes with the rest of the event's volunteers.
 */
export async function withdrawVolunteerInvitation<T extends Record<string, unknown>>(db: Database<T>, actor: Actor, invitationId: string, now: Date): Promise<void> {
  assertMayManage(actor);
  assertId(invitationId);
  await db.transaction(async (tx) => {
    const invitation = await openInvitation(tx, invitationId, now);
    await tx
      .update(eventVolunteerInvitations)
      .set({ withdrawnAt: now, withdrawnByStaffUserId: actor.id })
      .where(and(eq(eventVolunteerInvitations.id, invitation.id), isNull(eventVolunteerInvitations.usedAt), isNull(eventVolunteerInvitations.withdrawnAt)));
    await recordAuditEvent(tx, {
      actorStaffUserId: actor.id,
      action: "volunteer_invitation.withdrawn",
      entityType: "event",
      entityId: invitation.eventId,
      metadata: { invitationId: invitation.id },
      now,
    });
  });
}

/** One row of the card's list: the invitation as stored, and who sent it (a staff name, or null once that account is gone). */
export type VolunteerInvitationItem = EventVolunteerInvitation & { invitedByName: string | null };

/** An event's invitations, the newest first, for the card's «Invitații». Backoffice only: it holds addresses. */
export async function listVolunteerInvitations<T extends Record<string, unknown>>(db: Database<T>, actor: Actor, eventId: string): Promise<VolunteerInvitationItem[]> {
  assertMayManage(actor);
  assertId(eventId);
  const rows = await db
    .select({ invitation: eventVolunteerInvitations, invitedByName: staffUsers.displayName })
    .from(eventVolunteerInvitations)
    .leftJoin(staffUsers, eq(staffUsers.id, eventVolunteerInvitations.invitedByStaffUserId))
    .where(eq(eventVolunteerInvitations.eventId, eventId))
    .orderBy(desc(eventVolunteerInvitations.sentAt), asc(eventVolunteerInvitations.id));
  return rows.map((row) => ({ ...row.invitation, invitedByName: row.invitedByName ?? null }));
}
