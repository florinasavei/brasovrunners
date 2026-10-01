import { and, count, eq, gt } from "drizzle-orm";
import { emailOutbox } from "@/db/schema/email-outbox";
import type { StaffUser } from "@/db/schema/staff-users";
import type { Database } from "@/db/types";
import { recordAuditEvent } from "@/modules/audit/repository";
import { consumeRateLimit } from "@/modules/rate-limit/service";
import { canManageRegistrations } from "@/modules/staff-identity/domain/roles";
import { DomainError } from "@/shared/errors/domain-error";
import { drainOutboxAfterResponse } from "./drain";
import { EMAIL_HEALTH_THRESHOLDS } from "./health";

/**
 * «Reîncearcă emailurile eșuate» (§NNN): an Administrator's button on the queue panel instead of the
 * SQL the owner ran from a phone on the probation's day. Every FAILED row of the last seven days —
 * `/api/health`'s own window, so the button empties exactly what the alarm counts — goes back to the
 * queue: PENDING, its attempt count back to 0, due now, its `last_error` kept so the queue still says
 * what went wrong the first time. BOUNCED is an address that does not exist and stays as it is.
 *
 * Asserted on the server (`canManageRegistrations`, the role «Trimite acum» asks), three presses an
 * hour, one audit row naming who and how many — never an address. After it, the ordinary drain: the
 * rows leave as any due row does, through the one claim and the one send path.
 */
export const RETRY_FAILED_WINDOW_MS = EMAIL_HEALTH_THRESHOLDS.FAILED_WINDOW_MS;

const retryable = (now: Date) =>
  and(eq(emailOutbox.status, "FAILED"), gt(emailOutbox.createdAt, new Date(now.getTime() - RETRY_FAILED_WINDOW_MS)));

/** How many rows the button would put back now: the dialog's live count. */
export async function countRetryableFailed<T extends Record<string, unknown>>(db: Database<T>, now: Date): Promise<number> {
  const [row] = await db.select({ value: count() }).from(emailOutbox).where(retryable(now));
  return row?.value ?? 0;
}

export async function retryFailedEmails<T extends Record<string, unknown>>(
  db: Database<T>,
  actor: Pick<StaffUser, "id" | "role">,
  now: Date,
): Promise<{ retried: number }> {
  if (!canManageRegistrations(actor.role)) {
    throw new DomainError("FORBIDDEN", `role ${actor.role} may not put failed emails back in the queue`);
  }
  const verdict = await consumeRateLimit(db, "admin-retry-failed", actor.id, now);
  if (!verdict.allowed) {
    throw new DomainError(
      "VALIDATION_ERROR",
      `failed emails were put back ${verdict.count} times in the last hour; wait ${verdict.retryAfter} seconds`,
    );
  }
  const retried = await db.transaction(async (tx) => {
    const rows = await tx
      .update(emailOutbox)
      .set({ status: "PENDING", attemptCount: 0, nextAttemptAt: now, lockedAt: null })
      .where(retryable(now))
      .returning({ id: emailOutbox.id });
    await recordAuditEvent(tx, {
      actorStaffUserId: actor.id,
      action: "email_outbox.retry_failed",
      entityType: "email_outbox",
      entityId: actor.id,
      metadata: { count: rows.length, windowDays: RETRY_FAILED_WINDOW_MS / (24 * 3_600_000) },
      now,
    });
    return rows.length;
  });
  // The ordinary drain after this response (§68), as for any row that became due.
  if (retried > 0) drainOutboxAfterResponse();
  return { retried };
}
