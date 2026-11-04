import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { events } from "@/db/schema/events";
import type { Transaction } from "@/db/types";
import { enqueueEmail } from "@/modules/notifications/outbox";
import { canManageRegistrations } from "@/modules/staff-identity/domain/roles";
import { listStaffUsers } from "@/modules/staff-identity/repository";
import { computeOccupied } from "./domain/capacity";
import { placesAlertSentOf, placesAlertStep } from "./domain/places-alert";
import { countOccupied } from "./repository";

/**
 * «Anunță-mă când rămân N locuri» (§906), checked after an allocator write, in the caller's transaction and
 * under the event lock the caller already holds — so two writes cannot both see the crossing, and the email
 * and the memory commit with the place that crossed it, or not at all. Never a job of its own: every place
 * taken goes through `allocateOrWaitlist`, `fillAvailableSpots` or one of the staff's verbs, and each calls
 * this before its transaction ends.
 *
 * One read of the event's row when the setting is off (null), the common case; with it on, one count of the
 * occupied places (`countOccupied`, the allocator's own) and, on a crossing, one email per Administrator and
 * Superadministrator with an address, in their own language, through the outbox (`PLACES_ALERT`). Only a
 * scheduled event with a capacity is watched.
 */
export async function watchPlacesAlert<T extends Record<string, unknown>>(tx: Transaction<T>, eventId: string, now: Date): Promise<void> {
  const [row] = await tx
    .select({ capacity: events.capacity, alertAt: events.placesAlertAt, sent: events.placesAlertSent, eventStatus: events.eventStatus })
    .from(events)
    .where(eq(events.id, eventId))
    .limit(1);
  if (!row) return;
  const remembered = placesAlertSentOf(row.sent);
  if (row.alertAt === null) {
    // Off: forget the last crossing, so the setting switched on again starts afresh.
    if (remembered !== null) await rememberSent(tx, eventId, null);
    return;
  }
  if (row.capacity === null || row.eventStatus !== "SCHEDULED") return;
  const free = Math.max(row.capacity - computeOccupied(await countOccupied(tx, eventId, now)), 0);
  const step = placesAlertStep({ alertAt: row.alertAt, free, sent: remembered });
  // A memory column, not an edit: the row's `version` stays, so an editor open on the event is not told it changed.
  if (step.sent !== remembered) await rememberSent(tx, eventId, step.sent);
  if (step.send === null) return;

  const recipients = (await listStaffUsers(tx)).filter((member) => canManageRegistrations(member.role) && member.email.trim() !== "");
  /*
    Once per crossing is the memory column's, written above under the lock; the key only has to name this crossing
    apart from every other one — a later crossing may come at the same instant in a script or a test.
  */
  const crossing = randomUUID();
  for (const member of recipients) {
    await enqueueEmail(tx, {
      participantId: null,
      registrationId: null,
      messageType: "PLACES_ALERT",
      locale: member.preferredLocale,
      recipientEmail: member.email,
      payload: { displayName: member.displayName, eventId, stage: step.send, free, capacity: row.capacity, alertAt: row.alertAt },
      // Once per crossing and person.
      idempotencyKey: `places-alert:${eventId}:${step.send}:${crossing}:${member.id}`,
      now,
    });
  }
}

async function rememberSent<T extends Record<string, unknown>>(tx: Transaction<T>, eventId: string, sent: string | null): Promise<void> {
  await tx.update(events).set({ placesAlertSent: sent }).where(eq(events.id, eventId));
}
