import { and, eq, isNull, lte, or } from "drizzle-orm";
import { emailOutbox } from "@/db/schema/email-outbox";
import type { registrations } from "@/db/schema/registrations";
import type { Database } from "@/db/types";
import type { StaffUser } from "@/db/schema/staff-users";
import { recordAuditEvent } from "@/modules/audit/repository";
import { consumeRateLimit } from "@/modules/rate-limit/service";
import { canManageRegistrations } from "@/modules/staff-identity/domain/roles";
import { DomainError } from "@/shared/errors/domain-error";
import { gmailRoadCondition, type OutboxBatchSummary, OUTBOX_SUMMARY_COUNTS, type OutboxRoads, processOutboxBatch } from "./outbox";
import type { MailgunStop } from "./domain/mailgun-stop";
import { createOutboxSender } from "./outbox-sender";
import { createOutboxRenderer } from "./render";
import { readEmailVolumeToday } from "./volume";
import { SEND_NOW_HOUR_SPENT, SendNowRefused, stoppedRefusal } from "./send-at-once";

/**
 * "Send now": the outbox drained from the backoffice, without waiting for the monitor
 * (`DECISIONS.md` §80). The owner's ask: "force sending emails, not wait for the cron if
 * needed — but keep the counter for Mailgun, because I might want to send newsletters."
 *
 * The same worker the job endpoint and the after-response drain run — one code path
 * (AGENTS.md §16.2), so a message sent from here is claimed, rendered, retried and deferred
 * exactly as it would be at 03:00. What is different is who asks and what bounds it:
 *
 * - an Administrator's session, not `JOB_SECRET`; audited, so the trail says who emptied the
 *   queue before a window;
 * - its own throttle, apart from the job's — a person pressing the button must not spend the
 *   scheduler's allowance, nor the scheduler theirs;
 * - **the counter.** The day's Mailgun allowance is the club's to spend on purpose. The button
 *   shows it and stops at it: batches run only while the day's remaining allowance is above
 *   zero, and never more than `MAX_BATCHES` in one press. The provider's own refusal on a
 *   spent cap still defers a message rather than losing it (§40) — this is the app-side
 *   forecast doing its job before the provider has to.
 */

/** Twenty a batch, five batches: a hundred messages, the whole of a free day, in one press. */
const MAX_BATCHES = 5;

export type SendNowResult = OutboxBatchSummary & {
  batches: number;
  /** The day's figures after the run, for the sentence the page shows. */
  sentToday: number;
  /** Null when the plan has no ceiling (§100). */
  allowance: number | null;
  remaining: number | null;
  /**
   * Gmail carried for a stopped Mailgun (§NNN): how many of `sent` left by Gmail for it —
   * «N prin Gmail — Mailgun în pauză până la HH:MM» on the page. 0 when nothing was carried.
   */
  viaGmail: number;
  /**
   * Mailgun's stop whenever one was in force for the press (§NNN), carried or not: with `carriedByGmail`
   * false the press sent only Gmail's own rows and Mailgun's still wait — the registrations list says
   * «Mailgun reia la HH:MM», having no queue header to say it. Null while Mailgun's road was open.
   */
  stop: MailgunStop | null;
  /** Whether Gmail carried Mailgun's groups for `stop` (§NNN). */
  carriedByGmail: boolean;
};

/** What the worker and the counter read; any fuller schema — the app's, the tests' — fits. */
type Db = Database<{ emailOutbox: typeof emailOutbox; registrations: typeof registrations }>;

/** Whether a PENDING message due now rides Gmail's road, which Mailgun's hourly pace does not hold. */
async function gmailRowDue(db: Db, roads: OutboxRoads | undefined, now: Date): Promise<boolean> {
  if (!roads) return false;
  const [found] = await db
    .select({ id: emailOutbox.id })
    .from(emailOutbox)
    .where(and(eq(emailOutbox.status, "PENDING"), or(isNull(emailOutbox.nextAttemptAt), lte(emailOutbox.nextAttemptAt, now)), gmailRoadCondition(roads)))
    .limit(1);
  return found !== undefined;
}

export async function sendOutboxNow(
  db: Db,
  actor: Pick<StaffUser, "id" | "role">,
  now: Date,
): Promise<SendNowResult> {
  if (!canManageRegistrations(actor.role)) {
    throw new DomainError("FORBIDDEN", `role ${actor.role} may not send the outbox by hand`);
  }

  /*
    Mailgun's hour (§605): with no room left in it, the press is told so with its sentence rather
    than claiming nothing in silence — and spends none of the hour's presses, like every refusal
    that only read something. Unless a message on Gmail's road is waiting: the pace does not hold
    that road, so the press has something to send. With room, the claim itself keeps every batch
    inside the hour.
  */
  const before = await readEmailVolumeToday(db, now);
  // The club's road per group and the Reply-To it chose to show (§442): one sender for the press;
  // Gmail's cap and pace from the database before each Gmail message.
  const { sender, route, roads, replyTo } = await createOutboxSender(db);
  /*
    Mailgun said stop (§NNN): with «Gmail preia când Mailgun se oprește» on and room in Gmail's day,
    the press sends through Gmail — the claim's own rule — and says so. Otherwise it is refused with
    the sentence that names the cause and the remedy, unless a message on Gmail's own road is due,
    which the stop does not hold. Read before the throttle, like every refusal that only read something.
  */
  const whileStopped = before.whileStopped;
  const carrying = whileStopped.road === "gmail";
  if (whileStopped.road === "wait" && !(await gmailRowDue(db, roads, now))) throw stoppedRefusal(whileStopped);
  if (!carrying && before.hourRemaining === 0 && !(await gmailRowDue(db, roads, now))) {
    throw new SendNowRefused(`Mailgun's hourly pace is spent: ${before.sentLastHour} of ${before.hourlyAllowance} in the last hour`, SEND_NOW_HOUR_SPENT);
  }

  const verdict = await consumeRateLimit(db, "admin-send-now", actor.id, now);
  if (!verdict.allowed) {
    throw new DomainError(
      "VALIDATION_ERROR",
      `the outbox was sent by hand ${verdict.count} times in the last hour; wait ${verdict.retryAfter} seconds`,
    );
  }

  const total: OutboxBatchSummary = { claimed: 0, sent: 0, retrying: 0, deferred: 0, failed: 0, bounced: 0 };
  let batches = 0;
  let volume = before;
  let viaGmail = 0;
  // The stop in force whether Gmail carries it or not (§NNN): a press that sent only Gmail's own rows still says Mailgun's wait.
  let stop: MailgunStop | null = whileStopped.road === "mailgun" ? null : whileStopped.stop;
  let carriedByGmail = carrying;
  // Mailgun's day is not Gmail's: while Gmail carries for it, the day's counter does not stop the press.
  const room = () => (carriedByGmail || volume.remaining === null ? null : volume.remaining);

  while (batches < MAX_BATCHES && (room() === null || (room() ?? 0) > 0)) {
    const summary = await processOutboxBatch(db, {
      sender,
      route,
      roads,
      // A renderer per batch, so each event's words are read once per batch (§373, email follow-up).
      render: createOutboxRenderer({ replyTo }),
      now,
      // Never past what the day still allows: the counter is the ceiling, not a display.
      batchSize: Math.min(20, room() ?? 20),
    });
    // An empty claim is not a batch: nothing was waiting, and nothing is counted.
    if (summary.claimed === 0) break;
    batches += 1;
    for (const key of OUTBOX_SUMMARY_COUNTS) total[key] += summary[key];
    if (summary.carried) {
      viaGmail += summary.carried.viaGmail;
      stop = summary.carried.stop;
      carriedByGmail = true;
    }
    volume = await readEmailVolumeToday(db, now);
    // The provider said stop (a spent cap defers the rest): no point in another batch.
    if (summary.deferred > 0) break;
  }
  /*
    Mailgun said stop during the press and nobody carried it (§NNN, the review of round three): the
    switch off or the notice missing, the batch records the stop but carries nothing, so `carried`
    is unset. The stop is read back — the volume re-read after the batch holds it — so the list still
    says «Mailgun reia la HH:MM» rather than the count alone.
  */
  if (stop === null && total.deferred > 0) {
    stop = volume.mailgunStop;
    carriedByGmail = false;
  }

  await recordAuditEvent(db, {
    actorStaffUserId: actor.id,
    action: "outbox.sent_by_staff",
    entityType: "email_outbox",
    entityId: actor.id,
    metadata: {
      ...total,
      batches,
      sentToday: volume.sentMessages,
      remaining: volume.remaining,
      // What Gmail carried for a stopped Mailgun (§NNN): counts and the stop's kind, never an address.
      ...(stop ? { viaGmail, mailgunStop: stop.kind, mailgunStopUntil: stop.until.toISOString(), carriedByGmail } : {}),
    },
    now,
  });

  return { ...total, batches, sentToday: volume.sentMessages, allowance: volume.allowance, remaining: volume.remaining, viaGmail, stop, carriedByGmail };
}
