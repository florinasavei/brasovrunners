import type { EmailMessageType } from "@/db/schema/email-outbox";

/**
 * Mail that goes to many people at once and waits for none of them (§445): the newsletter, the
 * new-event alert and the day-before «Vii?» question (§818; one message per subscriber of its topic, withdrawn at the send once its day has come). §80's rule for the day a newsletter existed was "it will have to fit under the
 * same number" — the plan's allowance (§100) — and the one thing that must never happen is that a
 * newsletter to three hundred addresses spends the allowance a registration's confirmation link
 * needs at noon the same day. So the outbox treats these types as the last in line and gives them
 * only part of what is left:
 *
 * - **Last in line.** A batch claims every other due message first; a newsletter row fills only
 *   the room that is left (`claimOutboxBatch`).
 * - **A share kept back.** Of what the plan has left over its period, a newsletter may use only
 *   what exceeds the reserve below — half of a daily allowance, a fifth of a monthly one — so a
 *   registration day still has its confirmations. What does not fit waits, untouched and with no
 *   attempt spent, until the allowance comes back (`nextAllowanceResetAt`), and goes then.
 * - **Never a false alarm.** A newsletter held back is the plan working as chosen, not a stalled
 *   outbox: `/api/health` counts neither its wait nor its reset as a fault (`health.ts`).
 *
 * The provider's own refusal still defers any message, bulk or not (§40): the reserve is the
 * club's claim about its plan, the refusal is the fact.
 */
export const BULK_MESSAGE_TYPES = ["NEWSLETTER", "NEW_EVENT_ALERT", "RSVP_ASK"] as const satisfies readonly EmailMessageType[];

export function isBulkMessage(messageType: EmailMessageType): boolean {
  return (BULK_MESSAGE_TYPES as readonly EmailMessageType[]).includes(messageType);
}

/**
 * The part of the allowance kept for everything else, by the period the plan counts over. Half of
 * Mailgun Free's hundred a day is about seven completed registrations' mail (`volume.ts`); a paid
 * plan counts a month, where a fifth is still thousands.
 */
export const BULK_RESERVE_SHARE: Readonly<Record<"day" | "month", number>> = { day: 0.5, month: 0.2 };

/**
 * How many bulk messages may go now: what the plan has left over its period, less the reserve —
 * never below zero — or `null` when the plan sets no ceiling at all (nothing to keep back).
 */
export function bulkBudget(headroom: { period: "day" | "month" | "none"; allowance: number | null; remaining: number | null }): number | null {
  if (headroom.period === "none" || headroom.allowance === null || headroom.remaining === null) return null;
  const reserve = Math.ceil(headroom.allowance * BULK_RESERVE_SHARE[headroom.period]);
  return Math.max(0, headroom.remaining - reserve);
}

/**
 * The sends to many (the decision «Cere reconfirmarea», part two): one message per registration of an event — or per
 * address that asked to hear of one — queued by one press or one job, so about two hundred at a time, and each of them
 * about a registration already made (or, for the last, not made at all). The outbox claims them after every registration's
 * own message (the address to confirm, the declaration, the offer, the confirmation), which a person may be waiting for
 * on a page right now, and before the bulk types above; among themselves, in this order, the most urgent first:
 *
 * 1. `EVENT_CANCELLED` — «{event} a fost anulat», queued for everyone registered when an organizer cancels a date with
 *    the notice ticked (`event-notices.ts`): first, because somebody may be about to travel to a race that will not run;
 * 2. `EVENT_UPDATE_NOTICE` — «Detalii actualizate», a moved start or place, queued the same way: what changed about a race
 *    that still runs;
 * 3. `EVENT_REMINDER` — the automatic reminder, about two hundred rows queued by the maintenance job in one transaction
 *    a reminder lead before the start (`event-mail.ts#queueEventReminders`): the day and the place, already known;
 * 4. `ORGANIZER_MESSAGE` — «Trimite un mesaj participanților», the organizers' own words (and «Cere reconfirmarea»),
 *    which an organizer writes days ahead and can wait for the three above;
 * 5. `EVENT_THANKS` — «Trimite mulțumirile», to everyone checked in, the afternoon of the race (`event-mail.ts#sendEventThanks`):
 *    after the race, nothing in it to act on before another message;
 * 6. `REGISTRATION_OPENED` — one per address that asked «Anunță-mă când se deschid înscrierile», queued by the maintenance
 *    job when the window opens (`registrations/interest.ts`): to people with no registration yet, so after every message
 *    to somebody registered, and still before the newsletter's kind, since each of them asked for this one.
 *
 * An order and nothing else: no cap, no hold and no mark — they leave at the queue's pace, in the room the
 * registrations' own messages leave, and a club copy rides with its type. So a send of two hundred never stands in
 * front of a verification queued after it. One exception: an Administrator's «Retrimite» of one of them for one runner
 * (`is_manual_resend`) is that person's own message, and goes with the registrations' own (`sendOrderOf`,
 * `waitsAsSendToMany`). While Mailgun is stopped, Gmail carries the registrations' own messages and the event's urgent
 * notices (`URGENT_SEND_TO_MANY_MESSAGE_TYPES`); the other sends to many on Mailgun's road wait for Mailgun
 * (`waitsForMailgunDuringStop`, `outbox.ts`). `/api/health` does not call one of them late for waiting its turn
 * (`health.ts`), and the public «emailurile întârzie» does not count them (`email-delay.ts`, `public-delay.ts`).
 */
export const SEND_TO_MANY_MESSAGE_TYPES = [
  "EVENT_CANCELLED",
  "EVENT_UPDATE_NOTICE",
  "EVENT_REMINDER",
  "ORGANIZER_MESSAGE",
  "EVENT_THANKS",
  "REGISTRATION_OPENED",
] as const satisfies readonly EmailMessageType[];

export type SendToManyMessageType = (typeof SEND_TO_MANY_MESSAGE_TYPES)[number];

/**
 * The event's urgent notices among the sends to many (the decision «Cere reconfirmarea», part two): the date cancelled
 * (`EVENT_CANCELLED`) and its start or place moved (`EVENT_UPDATE_NOTICE`). Each says something a person acts on at once —
 * not to travel, or to come at another hour or to another place — so while Mailgun is stopped «Gmail preia când Mailgun se
 * oprește» carries them as it carried every group before this change: after the registrations' own messages, in the place
 * the order gives them. That uses Gmail's day, and is the price of a cancellation reaching everyone that day. The other four
 * — the reminder, the organizers' message, the thanks and «s-au deschis înscrierile» — say nothing that cannot wait for
 * Mailgun: they wait, so Gmail's room stays for the registrations' own (`waitsForMailgunDuringStop`).
 */
export const URGENT_SEND_TO_MANY_MESSAGE_TYPES = ["EVENT_CANCELLED", "EVENT_UPDATE_NOTICE"] as const satisfies readonly SendToManyMessageType[];

export function isSendToManyMessage(messageType: EmailMessageType): boolean {
  return (SEND_TO_MANY_MESSAGE_TYPES as readonly EmailMessageType[]).includes(messageType);
}

/**
 * Whether a row waits as a send to many: its type is one, and it is not an Administrator's manual resend for one runner —
 * that one is the person's own message, claimed, judged late and counted ahead as the registrations' own are.
 */
export function waitsAsSendToMany(messageType: EmailMessageType, isManualResend = false): boolean {
  return !isManualResend && isSendToManyMessage(messageType);
}

/**
 * Whether a row waits for Mailgun while Mailgun is stopped and «Gmail preia când Mailgun se oprește» carries for it (the
 * decision «Cere reconfirmarea», part two): a send to many, not a manual resend, not one of the event's urgent notices.
 * The one predicate of that rule — the carried claim (as SQL, `mailgun-stop.ts#waitsForMailgunCondition`), the batch's
 * hand-back of a row caught mid-batch, the sender's `bulk` flag, `/api/health`'s reading of what is carried now and the
 * queue panel's «Pleacă după ce Mailgun reia» all ask it. Its callers keep their two exceptions: a row whose own road is
 * Gmail, and a press's own «Trimite acum» rows (§540).
 */
export function waitsForMailgunDuringStop(messageType: EmailMessageType, isManualResend = false): boolean {
  return waitsAsSendToMany(messageType, isManualResend) && !(URGENT_SEND_TO_MANY_MESSAGE_TYPES as readonly EmailMessageType[]).includes(messageType);
}

/** The types `waitsForMailgunDuringStop` holds (a manual resend apart), for the SQL that reads the rule. */
export const WAITS_FOR_MAILGUN_MESSAGE_TYPES: readonly SendToManyMessageType[] = SEND_TO_MANY_MESSAGE_TYPES.filter((type) => waitsForMailgunDuringStop(type));

/**
 * The sends to many the claim takes after `messageType`'s own step — what a new send of it does not wait behind
 * (`volume.ts#waitingAhead`). Every row of an earlier step, and the older rows of its own step, stand ahead of it.
 */
export function sendsToManyAfter(messageType: SendToManyMessageType): readonly SendToManyMessageType[] {
  return SEND_TO_MANY_MESSAGE_TYPES.slice(SEND_TO_MANY_MESSAGE_TYPES.indexOf(messageType) + 1);
}

/**
 * A non-bulk message's place in the claim's order: 0 for a registration's own (a manual resend of any type included),
 * then 1 to 6 by `SEND_TO_MANY_MESSAGE_TYPES`. The bulk ones are claimed apart, last, under their cap.
 */
export function sendOrderOf(messageType: EmailMessageType, isManualResend = false): number {
  return isManualResend ? 0 : (SEND_TO_MANY_MESSAGE_TYPES as readonly EmailMessageType[]).indexOf(messageType) + 1;
}
