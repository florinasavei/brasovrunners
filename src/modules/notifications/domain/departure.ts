import type { EmailMessageType, EmailOutboxStatus } from "@/db/schema/email-outbox";
import { isBulkMessage, waitsAsSendToMany } from "./bulk";
import type { DeliveryTiming } from "./delivery-timing";
import { outboxRowLeavesAt, outboxRowOverdue } from "./email-wait";
import { pauseIsRecent } from "./hourly-pace";
import type { StopRoute } from "./mailgun-stop";
import { nextAllowanceResetAt } from "./retry";
import { LEAVES_NOW_WITHIN_MS, leavesNow } from "./send-at-once";

/**
 * When one waiting email leaves (§529, moved here from `OutboxQueuePanel`'s own `leaves` by the design «telling
 * the owner about every email a staff press sends», slice 1): the queue panel, «Emailuri azi» and — from slice
 * 2 — the toast after a press all ask this one function, so the three make one judgement.
 *
 * - **sending** — a worker holds it now;
 * - **never** — it spent its retries and moves again only by a hand («Reîncearcă emailurile eșuate»);
 * - **now** — a press sent it past the scheduled pass (§540, the `sentNow` flag), or the «imediat» timing sends
 *   it after the response of the request that queued it: in both, only while that drain is still plausibly
 *   under way (`LEAVES_NOW_WITHIN_MS`) and the row was never tried. The «imediat» drain's «now» is judged after
 *   the stop below: while Mailgun's road is stopped and nothing carries the row, the drain's claim takes none of
 *   it (`outbox.ts#claimOutboxBatchWithStop`), and «now» would promise what waits for the reopening. A press's
 *   «now» is judged before it: «Trimite acum» was asked with room to send (`assertRoomToSendNow`);
 * - **reset** — on Mailgun's road while Mailgun is stopped and nothing carries it (§622, the panel's header), or
 *   while the plan's day is spent: it leaves when the stop ends or the allowance resets;
 * - **at** — the outbox job's first real run at or after the row's own turn (its creation, or the end of its
 *   hold, retry or deferral), `late` when that turn is further back than `/api/health`'s `overdue` allows, and
 *   `heldUntil` when a family sitting holds it (§519).
 *
 * Pure: the caller reads the timing, the next tick, the thresholds and Mailgun's state once, for every row.
 * The bulk messages' daily room (`bulk-budget.ts`) splits a send by count, which the toast after the press says
 * (slice 2); one row of a newsletter waits for the outbox job like any other, never late (§445).
 */
export type DepartureRow = {
  status: EmailOutboxStatus;
  messageType: EmailMessageType;
  attemptCount: number;
  nextAttemptAt: Date | null;
  createdAt: Date;
  /** Sanitized: only its pause mark is read (§605). */
  lastError: string | null;
  /** A family sitting's hold, from the payload's own flag (§519). */
  familyHeld: boolean;
  /** A press asked for it now (§540): the payload's `sentNow` flag. */
  sentNow: boolean;
  /** Whether the claim takes it on Mailgun's road (§442, `outboxRoadsFor`). */
  onMailgunRoad: boolean;
  /** An Administrator's «Retrimite» for one runner: the person's own message, whatever its type. Absent reads as no. */
  isManualResend?: boolean;
};

export type DepartureContext = {
  now: Date;
  /** «Când pleacă emailurile» (§513). */
  timing: DeliveryTiming;
  /** The outbox job's next real run (`outbox-delivery.ts`). */
  nextTickAt: Date;
  /** How far apart the real runs after the next one are: the longer of the stated interval and the governor's floor (§334, §447). */
  runIntervalMinutes: number;
  /** The interval `/api/health` adds to its `overdue` allowance now (§529). */
  overdueCadenceMinutes: number;
  /** `/api/health`'s thresholds (`EMAIL_HEALTH_THRESHOLDS`): ninety minutes, and how far a deferral may reach. */
  overdueAfterMs: number;
  deferredBeyondMs: number;
  /** Whether Mailgun's hour binds (§605): a Mailgun-road row held for it is not late. */
  hourPaceHolds: boolean;
  /** When Mailgun's road opens again for a row nothing else carries (`mailgunReopensAt`); null while it is open. */
  mailgunReopensAt: Date | null;
  /** The pinger's cadence at an instant (`jobs/quiet-hours.ts#pingerCadenceMinutes`). */
  pingerMinutesAt: (instant: Date) => number;
};

export type Departure =
  | { kind: "sending" }
  | { kind: "never" }
  | { kind: "now" }
  | { kind: "reset"; at: Date }
  | { kind: "at"; at: Date; late: boolean; heldUntil: Date | null };

/**
 * When Mailgun's road opens again for a row nothing else carries (§622): the end of a recorded stop that Gmail
 * does not carry, or — no stop recorded — the reset of a Free plan's day once its allowance is spent («restul
 * pleacă după resetare», the outbox panel's own sentence). Null while Mailgun's road is open, or Gmail carries.
 */
export function mailgunReopensAt(
  volume: { whileStopped: StopRoute; remaining: number | null; period: "day" | "month" | "none" },
  now: Date,
): Date | null {
  if (volume.whileStopped.road === "wait") return volume.whileStopped.stop.until;
  if (volume.whileStopped.road === "mailgun" && volume.period === "day" && volume.remaining === 0) return nextAllowanceResetAt(now);
  return null;
}

/** Whether the «imediat» timing's drain is still plausibly sending a row it queued a moment ago (§513, §68). */
function drainedNow(row: DepartureRow, now: Date): boolean {
  return (
    row.status === "PENDING" &&
    row.attemptCount === 0 &&
    row.nextAttemptAt === null &&
    now.getTime() - row.createdAt.getTime() <= LEAVES_NOW_WITHIN_MS
  );
}

export function departureOf(row: DepartureRow, ctx: DepartureContext): Departure {
  const { now } = ctx;
  if (row.status === "PROCESSING") return { kind: "sending" };
  if (row.status === "FAILED") return { kind: "never" };
  // A press sent it now, past the scheduled pass (§540): it leaves after that press's response, asked with room to send it.
  if (leavesNow(row, now)) return { kind: "now" };

  const dueAt = row.nextAttemptAt ?? row.createdAt;
  // Mailgun stopped with nothing carrying it, or the plan's day spent (§622): the stop's end, unless the row's own turn is later.
  if (row.onMailgunRoad && ctx.mailgunReopensAt && ctx.mailgunReopensAt.getTime() > now.getTime() && ctx.mailgunReopensAt.getTime() > dueAt.getTime()) {
    return { kind: "reset", at: outboxRowLeavesAt({ dueAt: ctx.mailgunReopensAt, nextTickAt: ctx.nextTickAt, intervalMinutes: ctx.runIntervalMinutes, pingerMinutesAt: ctx.pingerMinutesAt }) };
  }
  // The «imediat» timing: the request that queued it drains it after its response (§68) — only past the stop above,
  // which that drain's claim honours like the job's: a Mailgun-road row it holds is never «now».
  if (ctx.timing === "immediate" && drainedNow(row, now)) return { kind: "now" };

  /*
    Late by health's own number (§98, §447): `overdueCadenceMinutes` is the cadence `/api/health` adds to its
    ninety minutes, the planned interval included — one judgement, two screens (§529). Since §605, as health
    counts it too: a Mailgun-road row is not late while Mailgun's hour binds (a Gmail row never waits for it),
    and a row Mailgun paused recently is late once it has waited past the allowance since it was queued (unless
    its pause runs past the hour, a deferral); a row whose pause mark is older is judged like any other waiting
    row. A newsletter held for the allowance's reserve (§445) is the reserve working, never late; a send to many
    (the decision «Cere reconfirmarea», part two) waiting its turn behind the registrations' own messages is the order
    working, and is late here only as health counts it — paused recently by the provider. A manual resend of one is the
    person's own message, late as one.
  */
  const sendToMany = waitsAsSendToMany(row.messageType, row.isManualResend === true);
  const overdueSince = (at: Date) =>
    outboxRowOverdue({ now, dueAt: at, overdueAfterMs: ctx.overdueAfterMs, intervalMinutes: ctx.overdueCadenceMinutes });
  const late =
    !isBulkMessage(row.messageType) &&
    (pauseIsRecent(row, now)
      ? overdueSince(row.createdAt) && row.nextAttemptAt !== null && row.nextAttemptAt.getTime() <= now.getTime() + ctx.deferredBeyondMs
      : !sendToMany && !(ctx.hourPaceHolds && row.onMailgunRoad) && overdueSince(dueAt));
  const at = outboxRowLeavesAt({ dueAt, nextTickAt: ctx.nextTickAt, intervalMinutes: ctx.runIntervalMinutes, pingerMinutesAt: ctx.pingerMinutesAt });
  // A family sitting's hold (§519): a turn in the future and no attempt made yet — not a retry, not the reserve.
  const heldUntil = row.nextAttemptAt && row.nextAttemptAt.getTime() > now.getTime() && row.familyHeld ? row.nextAttemptAt : null;
  return { kind: "at", at, late: heldUntil ? false : late, heldUntil };
}
