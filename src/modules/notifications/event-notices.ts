import { and, eq, inArray, sql } from "drizzle-orm";
import { participants } from "@/db/schema/participants";
import { type RegistrationStatus, registrations } from "@/db/schema/registrations";
import type { Database, Transaction } from "@/db/types";
import type { EventChangeKind } from "@/modules/events/domain/event-changes";
import type { BilingualText } from "@/shared/forms/both-languages";
import { enqueueEmail } from "./outbox";

/**
 * The two messages about an event that go to everybody registered for it (`DECISIONS.md` §331):
 * "details updated" when the organizer asks for it on a save that changed something, and "the
 * event is cancelled", with the organizer's reason.
 *
 * §9 drew the line this sits on: an operational notice to the people registered for an event,
 * about that event, is transactional — it comes from the registration relationship and needs no
 * consent of its own. Nothing here writes to anyone who is not registered for *this* event, and
 * nothing here is automatic: the editor's save calls it only when the organizer ticked the box
 * (or cancelled, where the box starts ticked).
 *
 * ## Who is told
 *
 * The registrations that hold a place or are waiting for one: `PENDING_DECLARATION`,
 * `WAITLIST_OFFERED`, `CONFIRMED` and `WAITLISTED`. Not `PENDING_EMAIL_CONFIRMATION`: that
 * address has not been confirmed, so nothing says it belongs to the person who typed it, and a
 * message to it would be the one mail this platform sends to an address nobody has vouched for
 * besides the confirmation itself. Every message that address receives after confirming reads the
 * event as it then stands, so they miss nothing. Not `CANCELLED` or `EXPIRED`: those people are
 * no longer coming (§9: "never sent to cancelled or expired registrations").
 *
 * A `TEST` registration is told like a real one, because it behaves like one everywhere
 * (`AGENTS.md` §12.6) and its `@test.invalid` address goes nowhere — and it is left out of every
 * number returned here, which is what the organizer is shown, and gets no club copy
 * (`enqueueEmail` already refuses one for a test row, §320).
 *
 * One outbox row per registration, in the registration's own language (and the organizer's own
 * words in both, §354 — the row's language decides which half reads first), inside the caller's
 * transaction: the save and its messages commit together or not at all (BR-REQ-080-02). The key
 * names the save — the event that was saved and the version the save gave it — and the
 * registration, so a retried request queues nothing twice, and the next save that asks is a new
 * message.
 */
export const EVENT_NOTICE_STATUSES = [
  "PENDING_DECLARATION",
  "WAITLIST_OFFERED",
  "CONFIRMED",
  "WAITLISTED",
] as const satisfies readonly RegistrationStatus[];

/** How many people a notice about this event would reach — real ones for the number shown, test ones apart. */
export async function countEventNoticeRecipients<T extends Record<string, unknown>>(
  db: Database<T>,
  eventId: string,
): Promise<{ real: number; test: number }> {
  const rows = await db
    .select({ kind: registrations.kind, count: sql<number>`count(*)::int` })
    .from(registrations)
    .where(and(eq(registrations.eventId, eventId), inArray(registrations.status, [...EVENT_NOTICE_STATUSES])))
    .groupBy(registrations.kind);
  return {
    real: rows.find((row) => row.kind === "REAL")?.count ?? 0,
    test: rows.find((row) => row.kind === "TEST")?.count ?? 0,
  };
}

/**
 * The real recipients of each of several dates, for a series save's dialog (§331, §NNN): a save
 * with the notice ticked tells every date it reaches, so "an email will be sent to N" is the sum
 * over the dates ticked, and each date's number is this — the same condition as the one above.
 * A date with nobody is absent. The caller leaves out a date already run: `announceSave` tells it
 * nothing.
 */
export async function countRealNoticeRecipientsByEvent<T extends Record<string, unknown>>(
  db: Database<T>,
  eventIds: readonly string[],
): Promise<Record<string, number>> {
  if (eventIds.length === 0) return {};
  const rows = await db
    .select({ eventId: registrations.eventId, count: sql<number>`count(*)::int` })
    .from(registrations)
    .where(and(inArray(registrations.eventId, [...eventIds]), eq(registrations.kind, "REAL"), inArray(registrations.status, [...EVENT_NOTICE_STATUSES])))
    .groupBy(registrations.eventId);
  return Object.fromEntries(rows.map((row) => [row.eventId, row.count]));
}

type NoticeInput = {
  eventId: string;
  /** The save this notice belongs to: `<saved event id>:v<its new version>`. */
  saveKey: string;
  actorStaffUserId: string;
  now: Date;
};

async function queueToEveryone<T extends Record<string, unknown>>(
  tx: Transaction<T>,
  input: NoticeInput & { messageType: "EVENT_UPDATE_NOTICE" | "EVENT_CANCELLED"; keyPrefix: string; payload: Record<string, unknown> },
): Promise<number> {
  const rows = await tx
    .select({
      registrationId: registrations.id,
      participantId: registrations.participantId,
      kind: registrations.kind,
      locale: registrations.locale,
      recipientEmail: participants.deliveryEmail,
    })
    .from(registrations)
    .innerJoin(participants, eq(participants.id, registrations.participantId))
    .where(and(eq(registrations.eventId, input.eventId), inArray(registrations.status, [...EVENT_NOTICE_STATUSES])));

  let real = 0;
  for (const row of rows) {
    const inserted = await enqueueEmail(tx, {
      participantId: row.participantId,
      registrationId: row.registrationId,
      messageType: input.messageType,
      locale: row.locale,
      recipientEmail: row.recipientEmail,
      payload: input.payload,
      idempotencyKey: `${input.keyPrefix}:${input.saveKey}:registration:${row.registrationId}`,
      requestedByStaffUserId: input.actorStaffUserId,
      now: input.now,
    });
    if (inserted && row.kind === "REAL") real += 1;
  }
  return real;
}

/**
 * "Detalii actualizate": what changed, by kind, and the organizer's note. The values themselves
 * are read at send time (`render.ts`), never copied here — see `event-changes.ts` for why.
 *
 * The note travels in **both languages**, `note: { ro, en }` (§354, bilingual everywhere): the
 * organizer writes it twice, and each registrant's message reads the half in their registration's
 * language — and the other half of the bilingual message reads the other text, never the same one
 * twice. A row queued before this carried one string, and `readEventNoticeWords` still reads it.
 */
export async function queueEventUpdateNotices<T extends Record<string, unknown>>(
  tx: Transaction<T>,
  input: NoticeInput & { changes: readonly EventChangeKind[]; note: BilingualText | null },
): Promise<number> {
  return queueToEveryone(tx, {
    ...input,
    messageType: "EVENT_UPDATE_NOTICE",
    keyPrefix: "event-update-notice",
    payload: { changes: [...input.changes], ...(input.note ? { note: { ro: input.note.ro, en: input.note.en } } : {}) },
  });
}

/** "{event} a fost anulat", with the reason the organizer typed — in both languages (§354), `reason: { ro, en }`. */
export async function queueEventCancelledNotices<T extends Record<string, unknown>>(
  tx: Transaction<T>,
  input: NoticeInput & { reason: BilingualText },
): Promise<number> {
  return queueToEveryone(tx, {
    ...input,
    messageType: "EVENT_CANCELLED",
    keyPrefix: "event-cancelled",
    payload: { reason: { ro: input.reason.ro, en: input.reason.en } },
  });
}
