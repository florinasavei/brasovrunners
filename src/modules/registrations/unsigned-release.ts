import { and, eq, sql } from "drizzle-orm";
import { events } from "@/db/schema/events";
import type { Transaction } from "@/db/types";
import { recordAuditEvent } from "@/modules/audit/repository";
import { enqueueEmail } from "@/modules/notifications/outbox";
import { revalidatePublicContent } from "@/modules/public-cache/cache";
import { canManageRegistrations } from "@/modules/staff-identity/domain/roles";
import { listStaffUsers } from "@/modules/staff-identity/repository";

/**
 * Who is told about the places of an event (§906, §NNN): every Administrator and Superadministrator with an address,
 * in their own language — the audience of «Anunță-mă când rămân N locuri» (`places-alert.ts`) and of the deadline's
 * release below. One read of the team.
 */
export async function placesAlertRecipients<T extends Record<string, unknown>>(tx: Transaction<T>) {
  return (await listStaffUsers(tx)).filter((member) => canManageRegistrations(member.role) && member.email.trim() !== "");
}

/** What the release counted under the lock, after the holds went (`repository.ts#expireStaleHolds`). */
export type DeadlineReleaseCounts = {
  /** The capacity it was measured against. */
  capacity: number;
  /** The places taken after the release (`computeOccupied`). */
  occupied: number;
  /** The people in the waiting list's line (`countEligibleWaitlisted`). */
  waiting: number;
  /** Real declaration holds still unsigned after it — a special guest's, one whose first email is queued, one whose own deadline is later. */
  unsigned: number;
};

/**
 * The rest of «Eliberează singur locurile nesemnate la termen» (§NNN), in the transaction that released the holds and
 * under the same event lock — so the release, its memory and its messages commit together or not at all:
 *
 * 1. the memory: `unsigned_released_for` = the deadline, without moving `version` (like `places_alert_sent`), so a
 *    second run for the same deadline finds nothing to do and an editor open on the event is not told it changed;
 * 2. «Locurile libere le dau doar eu» ticked when it is not — `version` + 1 and its own trail row
 *    (`event.free_places_by_offer_only_changed`, `via: "deadline"`, no actor) — so nobody is given a freed place by the
 *    site or the line: from now on the staff give every free place («fără să le primească cineva automat»);
 * 3. the trail `event.unsigned_released`, with the counts and no actor;
 * 4. one `UNSIGNED_RELEASED` to each Administrator and Superadministrator with an address — only when something was
 *    released or something is left unsigned: a deadline with nothing to say emails nobody — keyed on the event, the
 *    deadline and the person, so it is queued once per deadline whatever runs it again.
 *
 * `released` are the rows the release moved to `EXPIRED`, real and test apart: the summary counts the real ones and
 * names the test ones separately (never in production, §30).
 */
export async function completeDeadlineRelease<T extends Record<string, unknown>>(
  tx: Transaction<T>,
  params: {
    eventId: string;
    deadline: Date;
    released: readonly { id: string; kind: "REAL" | "TEST" }[];
    counts: DeadlineReleaseCounts;
    offerOnlyBefore: boolean;
    now: Date;
  },
): Promise<void> {
  const { eventId, deadline, released, counts, offerOnlyBefore, now } = params;
  // The memory, as a memory column: `version` stays.
  await tx.update(events).set({ unsignedReleasedFor: deadline }).where(eq(events.id, eventId));

  const offerOnlyTicked = !offerOnlyBefore;
  if (offerOnlyTicked) {
    await tx
      .update(events)
      .set({ freePlacesByOfferOnly: true, version: sql`${events.version} + 1`, updatedAt: now })
      .where(and(eq(events.id, eventId), eq(events.freePlacesByOfferOnly, false)));
    await recordAuditEvent(tx, {
      actorStaffUserId: null,
      action: "event.free_places_by_offer_only_changed",
      entityType: "event",
      entityId: eventId,
      metadata: { from: false, to: true, via: "deadline" },
      now,
    });
  }

  const real = released.filter((row) => row.kind === "REAL").length;
  const test = released.length - real;
  const free = Math.max(counts.capacity - counts.occupied, 0);
  const facts = { released: real, test, unsigned: counts.unsigned, free, waiting: counts.waiting, offerOnlyTicked };
  await recordAuditEvent(tx, {
    actorStaffUserId: null,
    action: "event.unsigned_released",
    entityType: "event",
    entityId: eventId,
    metadata: { deadline: deadline.toISOString(), ...facts, via: "deadline" },
    now,
  });

  if (released.length > 0 || counts.unsigned > 0) {
    for (const member of await placesAlertRecipients(tx)) {
      await enqueueEmail(tx, {
        participantId: null,
        registrationId: null,
        messageType: "UNSIGNED_RELEASED",
        locale: member.preferredLocale,
        recipientEmail: member.email,
        payload: { displayName: member.displayName, eventId, deadline: deadline.toISOString(), capacity: counts.capacity, ...facts },
        // Once per deadline and person.
        idempotencyKey: `unsigned-released:${eventId}:${deadline.toISOString()}:${member.id}`,
        now,
      });
    }
  }

  // The places these holds held are free (the sweep says so itself); the tick changes the public door too.
  revalidatePublicContent(...(offerOnlyTicked ? (["places", "events"] as const) : (["places"] as const)));
}
