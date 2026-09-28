/**
 * A backoffice press that sends its own email now, past the scheduled pass (§540, amending §513, §80
 * and §68; the owner, 2026-09-28: «cand retrimit un mail trebuie sa am optiunea de bypass la cron ca
 * sa pot retrimite instant!»).
 *
 * Under the scheduled default (§513) a message a press queues waits for the outbox job's next real
 * run: up to about three hours on QA, up to fifteen minutes by day and an hour at night on
 * production. A resend is asked for by somebody looking at the screen, for somebody waiting at the
 * inbox — so the press's dialog asks which: «Trimite acum», the primary answer, or «Pune la coadă»,
 * which leaves the message to the scheduled pass as before. Everything automatic keeps «Când pleacă
 * emailurile».
 *
 * Pure: the form's answer and the row's flag. The send itself is `send-at-once.ts`.
 */

import type { ConfirmChoice } from "@/shared/feedback/notice";

/** What a press asked for: now, past the scheduled pass, or the queue, like every other email. */
export type DeliveryChoice = "now" | "queue";

/** The hidden field the dialog's two answers set (`ConfirmSpec.choice`). */
export const DELIVERY_CHOICE_FIELD = "delivery";

/**
 * The form's answer. Only a posted «now» sends at once: a page that offered no choice (the
 * «imediat» timing, where every email already leaves after the request) posts nothing, and the
 * press is the ordinary one it always was.
 */
export function deliveryChoiceOf(value: unknown): DeliveryChoice {
  return value === "now" ? "now" : "queue";
}

/**
 * The payload's mark on a row a press sends now (§540), and on its club copies, which carry the
 * payload (`clubCopyPayload`): the queue panel says «Pleacă acum» for it while it waits for the
 * drain after the response. The renderer ignores it.
 */
export const SENT_NOW_FLAG = "sentNow";

/**
 * The most rows one press sends in its `after()` (§540 review): two batches of the worker's twenty
 * (`send-rows-now.ts`). A press that queues more — an organizer's message to a long list — marks
 * and sends only its first rows now; the rest wait for the scheduled pass like any other row, and
 * neither the queue panel nor the toast says «acum» for them.
 */
export const SEND_NOW_ROW_LIMIT = 40;

/**
 * Which of a send-to-many's rows leave now (§540): the first `limit` recipients, and the club's
 * copies only when the whole send fits — a copy of a message most of the list has not yet had
 * waits with the rest. `later` is how many recipients wait for the scheduled pass.
 */
export function sendNowSplit(input: { recipients: number; copies: number; limit?: number }): { now: number; later: number; copiesNow: boolean } {
  const limit = input.limit ?? SEND_NOW_ROW_LIMIT;
  const now = Math.min(input.recipients, limit);
  return { now, later: input.recipients - now, copiesNow: input.recipients + input.copies <= limit };
}

/** The payload with the mark, for a press that sends now; unchanged for the queue. */
export function markedForNow(payload: Record<string, unknown>, choice: DeliveryChoice): Record<string, unknown> {
  return choice === "now" ? { ...payload, [SENT_NOW_FLAG]: true } : payload;
}

/**
 * How long after a press its row may still be said to leave «acum»: the drain after the response
 * takes seconds (§68). Past it the drain is over — an `after()` that failed, say — and the row waits
 * for the scheduled pass like any other.
 */
export const LEAVES_NOW_WITHIN_MS = 5 * 60_000;

/**
 * Whether the queue panel says «Pleacă acum» for a row (§540): marked by a press, still waiting,
 * never tried, with no turn of its own, and pressed a moment ago. Once tried — a transient failure
 * put it back with a retry — or handed back by Gmail's pace with a turn later on (the attempt given
 * back, §443), or left behind by a drain that never ran, it says its time like any other row: the
 * drain after the response is over.
 */
export function leavesNow(
  row: { status: string; attemptCount: number; sentNow: boolean; nextAttemptAt: Date | null; createdAt: Date },
  now: Date,
): boolean {
  return (
    row.sentNow &&
    row.status === "PENDING" &&
    row.attemptCount === 0 &&
    row.nextAttemptAt === null &&
    now.getTime() - row.createdAt.getTime() <= LEAVES_NOW_WITHIN_MS
  );
}

/** The choice's words, as the server worded them (`send-now-choice.ts`). */
export type SendNowWords = { choice: ConfirmChoice; note: string; confirmLabel: string };

/**
 * A press's dialog with the choice folded in (§540): the body with the wait's sentence after it, the
 * primary button «Trimite acum, fără să aștepte trecerea programată», the quiet one «Pune la coadă
 * pentru trecerea programată». Without a choice (the «imediat» timing), the spec as it was.
 */
export function withSendNowChoice<S extends { body: string; confirmLabel: string }>(spec: S, words: SendNowWords | null): S & { choice?: ConfirmChoice } {
  if (!words) return spec;
  return { ...spec, body: `${spec.body} ${words.note}`, confirmLabel: words.confirmLabel, choice: words.choice };
}

/**
 * Whether a press may send now: the day's Mailgun allowance must hold every message it sends by
 * Mailgun (§80, §443 — what Gmail carries costs the allowance nothing). A press over it is refused,
 * never deferred in silence: «Pune la coadă» is the answer that waits for the reset.
 */
export function roomToSendNow(input: { remaining: number | null; mailgunMessages: number }): boolean {
  return input.remaining === null || input.remaining >= input.mailgunMessages;
}
