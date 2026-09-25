import { and, eq, gt, isNotNull, isNull, lte, ne, sql } from "drizzle-orm";
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
 * Confirmed only: a waiting-list entry has nothing to be reminded of, and a registration that
 * still owes its declaration gets its own email from `queueDeclarationReminders` below, in
 * the same two days (§160). Scheduled events only: a cancelled or completed event reminds
 * nobody. Test registrations are included — they behave as real ones everywhere (§12.6) and
 * their addresses go nowhere. The number returned counts both messages.
 */
/**
 * "Confirm your participation" (`DECISIONS.md` §104): when an event's window opens, every
 * registration still waiting for its signature gets the declaration email again, once — the
 * link the first one carried is still valid until the deadline, but a week has passed and the
 * message is the reminder. The key holds across every run that sees the event inside the
 * window; a hold that lapses at the deadline is the maintenance job's ordinary work.
 */
export async function queueParticipationConfirmations<T extends Record<string, unknown>>(
  db: Database<T>,
  now: Date,
): Promise<number> {
  const day = 24 * 60 * 60_000;
  const rows = await db
    .select({
      registrationId: registrations.id,
      participantId: registrations.participantId,
      locale: registrations.locale,
      recipientEmail: participants.deliveryEmail,
      holdExpiresAt: registrations.holdExpiresAt,
    })
    .from(registrations)
    .innerJoin(events, eq(events.id, registrations.eventId))
    .innerJoin(participants, eq(participants.id, registrations.participantId))
    .where(
      and(
        eq(registrations.status, "PENDING_DECLARATION"),
        eq(events.eventStatus, "SCHEDULED"),
        eq(events.registrationMode, "INTERNAL"),
        gt(events.startsAt, now),
        // The window is open: the start is within `opens` days, and the deadline is ahead.
        sql`${events.confirmationOpensDaysBefore} > ${events.confirmationDeadlineDaysBefore}`,
        sql`${events.startsAt} <= ${now.toISOString()}::timestamptz + make_interval(days => ${events.confirmationOpensDaysBefore})`,
        sql`${events.startsAt} > ${now.toISOString()}::timestamptz + make_interval(days => ${events.confirmationDeadlineDaysBefore})`,
      ),
    );
  // Only the holds the window gave: a thirty-minute hold taken inside the window is a person
  // signing right now, not somebody to remind a week later.
  const waiting = rows.filter((row) => row.holdExpiresAt && row.holdExpiresAt.getTime() - now.getTime() > day);
  if (waiting.length === 0) return 0;

  let queued = 0;
  await db.transaction(async (tx) => {
    for (const row of waiting) {
      const inserted = await enqueueEmail(tx, {
        participantId: row.participantId,
        registrationId: row.registrationId,
        messageType: "COMPLETE_DECLARATION",
        locale: row.locale,
        recipientEmail: row.recipientEmail,
        payload: {},
        idempotencyKey: `registration:${row.registrationId}:confirm-participation`,
        now,
      });
      if (inserted) queued += 1;
    }
  });
  return queued;
}

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
        // Not to somebody confirmed in the last day (§126): the confirmation they just got
        // carries the same facts, the QR and the number; a second copy is the mail people
        // learn to ignore. Never confirmed on the row (older rows) counts as long ago.
        sql`(${registrations.confirmedAt} IS NULL OR ${registrations.confirmedAt} < ${new Date(now.getTime() - 24 * 60 * 60_000)})`,
      ),
    );

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
  return queued + (await queueDeclarationReminders(db, now, horizon));
}

/**
 * The last call to sign, inside the same two days (`DECISIONS.md` §160).
 *
 * §160 keeps the place of somebody who forgot — and the population it keeps it for is the one
 * population that then hears nothing more: the reminder above is for the confirmed, and the
 * participation confirmation of §104 stops once the deadline is behind. So the declaration
 * email goes once more, two days out, to every registration that still owes a signature. Not
 * a new message type: it is the same `COMPLETE_DECLARATION`, whose words already say the
 * registration is complete only with the declaration and that it can be signed on paper at
 * the desk on race day — and whose deadline line the renderer drops once the deadline is
 * behind, because the place is being kept rather than counted down.
 *
 * One per registration, ever, by its own key: somebody who registered inside the window and
 * signed nothing gets this and nothing else.
 */
async function queueDeclarationReminders<T extends Record<string, unknown>>(
  db: Database<T>,
  now: Date,
  horizon: Date,
): Promise<number> {
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
        eq(registrations.status, "PENDING_DECLARATION"),
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
        messageType: "COMPLETE_DECLARATION",
        locale: row.locale,
        recipientEmail: row.recipientEmail,
        payload: {},
        idempotencyKey: `registration:${row.registrationId}:sign-reminder`,
        now,
      });
      if (inserted) queued += 1;
    }
  });
  return queued;
}

/**
 * Who the thank-you reaches: everyone checked in at the event. One condition for the send below
 * and for the count the confirmation dialog states before the press (§NNN), so the number the
 * organizer reads is the number of rows the send writes.
 */
function thanksRecipientsOf(eventId: string) {
  return and(eq(registrations.eventId, eventId), isNotNull(registrations.checkedInAt));
}

/**
 * How many the thank-you would reach right now — the dialog's number, from the send's own
 * condition. Real and test apart: a test registration is written to like a real one and counted
 * in nothing the club is given (`AGENTS.md` §12.6), so the dialog states `real` and names the
 * test rows on a line of their own, as the notice and message dialogs do.
 */
export async function countEventThanksRecipients<T extends Record<string, unknown>>(db: Database<T>, eventId: string): Promise<{ real: number; test: number }> {
  const rows = await db
    .select({ kind: registrations.kind, count: sql<number>`count(*)::int` })
    .from(registrations)
    .where(thanksRecipientsOf(eventId))
    .groupBy(registrations.kind);
  return {
    real: rows.find((row) => row.kind === "REAL")?.count ?? 0,
    test: rows.find((row) => row.kind === "TEST")?.count ?? 0,
  };
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
    // Named, so the form's summary links to the box (`DECISIONS.md` §315).
    throw new DomainError("VALIDATION_ERROR", "the link must start with https://", ["url"]);
  }

  return db.transaction(async (tx) => {
    // Claimed first, in the same transaction as the rows: two organizers pressing at once
    // means one of them finds `thanks_sent_at` already set. Never for a cancelled event
    // (§331): "thank you for running with us" about a race that did not run.
    const [event] = await tx
      .update(events)
      .set({ thanksSentAt: now })
      .where(and(eq(events.id, input.eventId), isNull(events.thanksSentAt), lte(events.startsAt, now), ne(events.eventStatus, "CANCELLED")))
      .returning({ id: events.id });
    if (!event) {
      throw new DomainError("CONFLICT", "the thank-you was already sent for this event, the event has not started, or it was cancelled");
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
      .where(thanksRecipientsOf(input.eventId));

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
