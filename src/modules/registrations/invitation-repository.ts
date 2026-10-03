import { and, asc, desc, eq, gt, lte, min, type SQL, sql } from "drizzle-orm";
import { type EventInvitation, eventInvitations } from "@/db/schema/event-invitations";
import { events } from "@/db/schema/events";
import { staffUsers } from "@/db/schema/staff-users";
import type { Database, Transaction } from "@/db/types";
import { recordAuditEvent } from "@/modules/audit/repository";

/**
 * The SQL of the invitations' held places (§647), beside the allocator's own counts: the bucket
 * `repository.ts#countOccupied` adds, the sweep that ends an invitation at its deadline, and the reads
 * the maintenance job and the backoffice make. No decision is taken here; `invitations.ts` decides,
 * under the event lock, and the allocator's formula (`domain/capacity.ts#computeOccupied`) adds.
 */

/** Not accepted, not withdrawn, not stamped expired: the invitation is still the club's open word. */
export function invitationOpen(): SQL {
  return sql`(${eventInvitations.acceptedAt} is null and ${eventInvitations.withdrawnAt} is null and ${eventInvitations.expiredAt} is null)`;
}

/**
 * The count of an event's invitations that hold a counted place now (§647, `AGENTS.md` §10.6): open,
 * before their deadline, and not «În afara locurilor» (§643). The deadline is compared here, on every
 * read, whatever the sweep has stamped — a place is free the instant the deadline passes. A scalar
 * subquery for `countOccupied`.
 */
export function invitationHoldsCount(eventId: string, now: Date): SQL<number> {
  return sql<number>`(select count(*)::int from ${eventInvitations} where ${eventInvitations.eventId} = ${eventId} and ${eventInvitations.outsideCapacity} = false and ${eventInvitations.expiresAt} > ${now} and ${invitationOpen()})`;
}

/**
 * Invitations past their deadline, stamped expired (§647): under the caller's event lock, inside
 * `expireStaleHolds`, so every capacity-changing transaction ends them first, as it does a lapsed
 * offer. The place each held was already free in the count from its deadline; the stamp ends the
 * invitation for the backoffice, its link's page and the one-live-invitation index, and writes one
 * audit row each (`event.invitation_expired`, the invitation's id, never a name). Returns how many
 * held a counted place, so the caller tells the public cache.
 */
export async function expireLapsedInvitations<T extends Record<string, unknown>>(db: Transaction<T>, eventId: string, now: Date): Promise<number> {
  const lapsed = await db
    .update(eventInvitations)
    .set({ expiredAt: now })
    .where(and(eq(eventInvitations.eventId, eventId), lte(eventInvitations.expiresAt, now), invitationOpen()))
    .returning({ id: eventInvitations.id, outsideCapacity: eventInvitations.outsideCapacity, participantId: eventInvitations.participantId });
  for (const row of lapsed) {
    await recordAuditEvent(db, {
      actorStaffUserId: null,
      participantId: null,
      action: "event.invitation_expired",
      entityType: "event",
      entityId: eventId,
      metadata: { invitationId: row.id, outsideCapacity: row.outsideCapacity },
      now,
    });
  }
  return lapsed.filter((row) => !row.outsideCapacity).length;
}

/**
 * The scheduled events with an open invitation past its deadline (§647), for the maintenance job: the
 * sweep stamps it and offers the place it held to the line (`fillAvailableSpots`). A liveness read,
 * like `findEventsNeedingMaintenance`: the count already treats the place as free.
 */
export async function eventsWithLapsedInvitations<T extends Record<string, unknown>>(db: Database<T>, now: Date): Promise<string[]> {
  const rows = await db
    .selectDistinct({ eventId: eventInvitations.eventId })
    .from(eventInvitations)
    .innerJoin(events, eq(events.id, eventInvitations.eventId))
    .where(and(sql`${events.eventStatus} = 'SCHEDULED'`, lte(eventInvitations.expiresAt, now), invitationOpen()));
  return rows.map((row) => row.eventId);
}

/** The nearest deadline of an open invitation on a scheduled event (§334): when the job next has work. */
export async function nextInvitationLapse<T extends Record<string, unknown>>(db: Database<T>, now: Date): Promise<Date | null> {
  const [row] = await db
    .select({ next: min(eventInvitations.expiresAt) })
    .from(eventInvitations)
    .innerJoin(events, eq(events.id, eventInvitations.eventId))
    .where(and(sql`${events.eventStatus} = 'SCHEDULED'`, gt(eventInvitations.expiresAt, now), invitationOpen()));
  return row?.next ?? null;
}

/** An event's invitations still waiting for an answer (open, before the deadline): the editor's «invitații în așteptare: N». */
export async function countPendingInvitations<T extends Record<string, unknown>>(db: Database<T>, eventId: string, now: Date): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(eventInvitations)
    .where(and(eq(eventInvitations.eventId, eventId), gt(eventInvitations.expiresAt, now), invitationOpen()));
  return Number(row?.count ?? 0);
}

/** One invitation, by id. */
export async function findInvitationById<T extends Record<string, unknown>>(db: Database<T>, id: string): Promise<EventInvitation | undefined> {
  const [row] = await db.select().from(eventInvitations).where(eq(eventInvitations.id, id)).limit(1);
  return row;
}

/** The open invitation of an address at an event, if any (the one-live index's own question). */
export async function findOpenInvitation<T extends Record<string, unknown>>(
  db: Database<T>,
  eventId: string,
  canonicalEmail: string,
): Promise<EventInvitation | undefined> {
  const [row] = await db
    .select()
    .from(eventInvitations)
    .where(and(eq(eventInvitations.eventId, eventId), eq(eventInvitations.canonicalEmail, canonicalEmail), invitationOpen()))
    .limit(1);
  return row;
}

/**
 * The invitation still open, before its deadline, of the address a registration belongs to (§647):
 * the one that registration takes over when it reaches its place by another route than the link —
 * the public form's confirmation, a staff entry, the desk, a restart, «Dă-i un loc acum» — so no place
 * stays held in a seated person's name until the deadline. By the participant row the invitation was
 * sent to: the address's one row, which every registration of that address carries. The deadline is
 * compared here, whatever the sweep has stamped (§10.6).
 */
export async function findLiveInvitationOfParticipant<T extends Record<string, unknown>>(
  db: Database<T>,
  eventId: string,
  participantId: string,
  now: Date,
): Promise<EventInvitation | undefined> {
  const [row] = await db
    .select()
    .from(eventInvitations)
    .where(and(eq(eventInvitations.eventId, eventId), eq(eventInvitations.participantId, participantId), gt(eventInvitations.expiresAt, now), invitationOpen()))
    .limit(1);
  return row;
}

/**
 * The invitation a registration came from (§647), for its page's facts: «Înscriere pe invitație —
 * trimisă de {who}, {when}». The accepted invitation naming the registration, whether by its link or
 * taken over by another route; who sent it is a staff name, or null once that row is gone.
 */
export async function findInvitationOfRegistration<T extends Record<string, unknown>>(
  db: Database<T>,
  registrationId: string,
): Promise<{ sentAt: Date; invitedByName: string | null } | undefined> {
  const [row] = await db
    .select({ sentAt: eventInvitations.sentAt, invitedByName: staffUsers.displayName })
    .from(eventInvitations)
    .leftJoin(staffUsers, eq(staffUsers.id, eventInvitations.invitedByStaffUserId))
    .where(eq(eventInvitations.acceptedRegistrationId, registrationId))
    .limit(1);
  return row ? { sentAt: row.sentAt, invitedByName: row.invitedByName ?? null } : undefined;
}

/** An event's invitations, the newest first, for the backoffice's «Invitații», each with who sent it (a staff name, or null once that row is gone). */
export async function listEventInvitations<T extends Record<string, unknown>>(db: Database<T>, eventId: string): Promise<(EventInvitation & { invitedByName: string | null })[]> {
  const rows = await db
    .select({ invitation: eventInvitations, invitedByName: staffUsers.displayName })
    .from(eventInvitations)
    .leftJoin(staffUsers, eq(staffUsers.id, eventInvitations.invitedByStaffUserId))
    .where(eq(eventInvitations.eventId, eventId))
    .orderBy(desc(eventInvitations.createdAt), asc(eventInvitations.id));
  return rows.map((row) => ({ ...row.invitation, invitedByName: row.invitedByName ?? null }));
}
