import type { EmailMessageType } from "@/db/schema/email-outbox";

/**
 * Mail that goes to many people at once and waits for none of them (§445): the newsletter and the
 * new-event alert. §80's rule for the day a newsletter existed was "it will have to fit under the
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
export const BULK_MESSAGE_TYPES = ["NEWSLETTER", "NEW_EVENT_ALERT"] as const satisfies readonly EmailMessageType[];

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
