import { and, eq, gt, isNotNull, isNull, lte } from "drizzle-orm";
import { events } from "@/db/schema/events";
import { participants } from "@/db/schema/participants";
import { registrations } from "@/db/schema/registrations";
import type { StaffUser } from "@/db/schema/staff-users";
import type { Database } from "@/db/types";
import { recordAuditEvent } from "@/modules/audit/repository";
import { canManageRegistrations } from "@/modules/staff-identity/domain/roles";
import { DomainError } from "@/shared/errors/domain-error";
import { enqueueEmail } from "./outbox";

/**
 * The two messages that are about the event rather than about a change of state
 * (`DECISIONS.md` §81, §82): the reminder two days before, and the thank-you afterwards.
 *
 * Neither moves a registration. Both go through the outbox with the idempotency discipline of
 * §16.1 — one key per registration per message — so a job that runs twice, or an organizer who
 * presses twice, produces one email.
 */

/** How long before the start the reminder goes: two days, measured on the event's own instant. */
export const REMINDER_HOURS_BEFORE = 48;

/**
 * Queue the reminder for every confirmed participant of every event that starts within the
 * next two days (`DECISIONS.md` §81). Called by the maintenance job, so the window is wide
 * open — "starts in the next 48 hours, has not started" — and the idempotency key is what
 * keeps a registration to one reminder across the runs that see it in that window.
 *
 * Confirmed only: a waiting-list entry has nothing to be reminded of, and a pending one has
 * its own email. Scheduled events only: a cancelled or completed event reminds nobody. Test
 * registrations are included — they behave as real ones everywhere (§12.6) and their
 * addresses go nowhere.
 */
export async function queueEventReminders<T extends Record<string, unknown>>(
  db: Database<T>,
  now: Date,
): Promise<number> {
  const horizon = new Date(now.getTime() + REMINDER_HOURS_BEFORE * 60 * 60_000);
  const rows = await db
    .select({
      registrationId: registrations.id,
      participantId: registrations.participantId,
      locale: registrations.locale,
      recipientEmail: participants.deliveryEmail,
    })
    .from(registrations)
    .innerJoin(events, eq(events.id, registrations.eventId))
    .innerJoin(participants, eq(participants.id, registrations.participantId))
    .where(
      and(
        eq(registrations.status, "CONFIRMED"),
        eq(events.eventStatus, "SCHEDULED"),
        eq(events.registrationMode, "INTERNAL"),
        gt(events.startsAt, now),
        lte(events.startsAt, horizon),
      ),
    );
  if (rows.length === 0) return 0;

  let queued = 0;
  await db.transaction(async (tx) => {
    for (const row of rows) {
      const inserted = await enqueueEmail(tx, {
        participantId: row.participantId,
        registrationId: row.registrationId,
        messageType: "EVENT_REMINDER",
        locale: row.locale,
        recipientEmail: row.recipientEmail,
        payload: {},
        // One per registration, ever: the second run in the window finds this key and inserts nothing.
        idempotencyKey: `registration:${row.registrationId}:reminder`,
        now,
      });
      if (inserted) queued += 1;
    }
  });
  return queued;
}

/**
 * The thank-you, sent once per event by an organizer to everyone who was checked in
 * (`DECISIONS.md` §82). Manual and never automatic; audited with the event and the count,
 * never the recipients; `events.thanks_sent_at` is what makes it once.
 */
export async function sendEventThanks<T extends Record<string, unknown>>(
  db: Database<T>,
  actor: Pick<StaffUser, "id" | "role">,
  input: { eventId: string; url?: string | null },
  now: Date,
): Promise<{ recipients: number }> {
  if (!canManageRegistrations(actor.role)) {
    throw new DomainError("FORBIDDEN", `role ${actor.role} may not send the thank-you`);
  }
  const url = input.url?.trim() || null;
  if (url && !url.startsWith("https://")) {
    throw new DomainError("VALIDATION_ERROR", "the link must start with https://");
  }

  return db.transaction(async (tx) => {
    // Claimed first, in the same transaction as the rows: two organizers pressing at once
    // means one of them finds `thanks_sent_at` already set.
    const [event] = await tx
      .update(events)
      .set({ thanksSentAt: now })
      .where(and(eq(events.id, input.eventId), isNull(events.thanksSentAt), lte(events.startsAt, now)))
      .returning({ id: events.id });
    if (!event) {
      throw new DomainError("CONFLICT", "the thank-you was already sent for this event, or the event has not started");
    }

    const rows = await tx
      .select({
        registrationId: registrations.id,
        participantId: registrations.participantId,
        locale: registrations.locale,
        recipientEmail: participants.deliveryEmail,
      })
      .from(registrations)
      .innerJoin(participants, eq(participants.id, registrations.participantId))
      .where(and(eq(registrations.eventId, input.eventId), isNotNull(registrations.checkedInAt)));

    for (const row of rows) {
      await enqueueEmail(tx, {
        participantId: row.participantId,
        registrationId: row.registrationId,
        messageType: "EVENT_THANKS",
        locale: row.locale,
        recipientEmail: row.recipientEmail,
        payload: url ? { url } : {},
        idempotencyKey: `registration:${row.registrationId}:thanks`,
        now,
      });
    }

    await recordAuditEvent(tx, {
      actorStaffUserId: actor.id,
      action: "event.thanks_sent",
      entityType: "event",
      entityId: input.eventId,
      // The count and the link, never who received it (§12.12).
      metadata: { recipients: rows.length, url },
      now,
    });

    return { recipients: rows.length };
  });
}
