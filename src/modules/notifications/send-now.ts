import type { emailOutbox } from "@/db/schema/email-outbox";
import type { registrations } from "@/db/schema/registrations";
import type { Database } from "@/db/types";
import type { StaffUser } from "@/db/schema/staff-users";
import { recordAuditEvent } from "@/modules/audit/repository";
import { consumeRateLimit } from "@/modules/rate-limit/service";
import { canManageRegistrations } from "@/modules/staff-identity/domain/roles";
import { DomainError } from "@/shared/errors/domain-error";
import { type OutboxBatchSummary, processOutboxBatch } from "./outbox";
import { createOutboxSender } from "./outbox-sender";
import { createOutboxRenderer } from "./render";
import { readEmailVolumeToday } from "./volume";

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
};

/** What the worker and the counter read; any fuller schema — the app's, the tests' — fits. */
type Db = Database<{ emailOutbox: typeof emailOutbox; registrations: typeof registrations }>;

export async function sendOutboxNow(
  db: Db,
  actor: Pick<StaffUser, "id" | "role">,
  now: Date,
): Promise<SendNowResult> {
  if (!canManageRegistrations(actor.role)) {
    throw new DomainError("FORBIDDEN", `role ${actor.role} may not send the outbox by hand`);
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
  let volume = await readEmailVolumeToday(db, now);

  // The club's road per group and the Reply-To it chose to show (§442): one sender for the press;
  // Gmail's cap and pace from the database before each Gmail message.
  const { sender, route, roads, replyTo } = await createOutboxSender(db);
  while (batches < MAX_BATCHES && (volume.remaining === null || volume.remaining > 0)) {
    const summary = await processOutboxBatch(db, {
      sender,
      route,
      roads,
      // A renderer per batch, so each event's words are read once per batch (§373, email follow-up).
      render: createOutboxRenderer({ replyTo }),
      now,
      // Never past what the day still allows: the counter is the ceiling, not a display.
      batchSize: Math.min(20, volume.remaining ?? 20),
    });
    // An empty claim is not a batch: nothing was waiting, and nothing is counted.
    if (summary.claimed === 0) break;
    batches += 1;
    for (const key of Object.keys(total) as (keyof OutboxBatchSummary)[]) total[key] += summary[key];
    volume = await readEmailVolumeToday(db, now);
    // The provider said stop (a spent cap defers the rest): no point in another batch.
    if (summary.deferred > 0) break;
  }

  await recordAuditEvent(db, {
    actorStaffUserId: actor.id,
    action: "outbox.sent_by_staff",
    entityType: "email_outbox",
    entityId: actor.id,
    metadata: { ...total, batches, sentToday: volume.sentMessages, remaining: volume.remaining },
    now,
  });

  return { ...total, batches, sentToday: volume.sentMessages, allowance: volume.allowance, remaining: volume.remaining };
}
