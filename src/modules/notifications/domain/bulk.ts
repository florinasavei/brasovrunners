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
 * The staff sends to many (the decision «Cere reconfirmarea», part two): «Trimite un mesaj participanților» and «Detalii
 * actualizate» — `BULK_CLUB_COPY_MESSAGES`, one message per registration of an event, queued by one press. The outbox
 * claims them after every registration's own message (the address to confirm, the declaration, the offer, the
 * confirmation) and before the bulk types above, so a send of two hundred never stands in front of a verification queued
 * after it. They are about the person's own registration, so they keep a smaller reserve than the newsletter's: a tenth
 * of the allowance, and on a daily plan at least ten messages — what the registrations' own emails need for the rest of
 * the day. Decided for the owner (the brief's first open decision): the default, `max(10, 10%)`.
 */
export const STAFF_RESERVE_SHARE = 0.1;
export const STAFF_RESERVE_DAY_MINIMUM = 10;

/** The messages a staff send leaves to the registrations' own emails, by the plan's period; none without a ceiling. */
export function staffReserve(headroom: { period: "day" | "month" | "none"; allowance: number | null }): number {
  if (headroom.period === "none" || headroom.allowance === null) return 0;
  const share = Math.ceil(headroom.allowance * STAFF_RESERVE_SHARE);
  return headroom.period === "day" ? Math.max(STAFF_RESERVE_DAY_MINIMUM, share) : share;
}

/** How many staff-send messages may go now: what the plan has left less `staffReserve`, never below zero; `null` with no ceiling. */
export function staffBudget(headroom: { period: "day" | "month" | "none"; allowance: number | null; remaining: number | null }): number | null {
  if (headroom.period === "none" || headroom.allowance === null || headroom.remaining === null) return null;
  return Math.max(0, headroom.remaining - staffReserve(headroom));
}

/**
 * The mark a staff-send row carries while the reserve holds it until the allowance comes back: the reserve working, not
 * a fault — `/api/health` counts such a row neither as deferred nor as a provider's error, as it counts no bulk row held
 * for its own reserve. Once its turn has passed by the overdue allowance, it is late like any row.
 */
export const STAFF_RESERVE_HELD_ERROR = "staff send: held for the registrations' own emails";
