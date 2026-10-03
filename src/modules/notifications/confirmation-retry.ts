import { and, eq, gt, inArray, isNotNull, sql } from "drizzle-orm";
import { emailOutbox } from "@/db/schema/email-outbox";
import { events } from "@/db/schema/events";
import { participants } from "@/db/schema/participants";
import { registrations } from "@/db/schema/registrations";
import type { Database } from "@/db/types";
import type { Deadlines } from "@/modules/deadlines/domain/deadlines";
import { emailLinkLapseSql } from "@/modules/registrations/repository";
import {
  AUTOMATIC_SEND_KEYS,
  CONFIRMATION_RETRY,
  type ConfirmationRetryPlan,
  dueConfirmationRetries,
  planConfirmationRetries,
  type VerificationEmailRow,
} from "./domain/automatic-sends";
import { enqueueEmail } from "./outbox";

/**
 * The second verification email (§NNN; the owner, 2026-10-03: «Pe viitor ne trebuie mecanism și
 * setare de retry de confirmare email»): the address link once more, by itself, to whoever has not
 * confirmed and still can — the club's hours after the last email left, while the link still has the
 * club's least time left («Termene»). Who and when is `domain/automatic-sends.ts#planConfirmationRetries`;
 * this file selects the rows it reads and queues what it decides.
 *
 * It changes no state: no deadline moves (the row carries no `startsDeadline`, §513), no place is
 * held, the allocator is not called. The link is the renderer's, minted at send time like every
 * other one (§12.8, §14.5): it supersedes the first email's link, whose page then says a newer
 * email has it (§619). A test registration is selected exactly like a real one (§12.6).
 */

type Row = Record<string, unknown>;

function toDate(value: unknown): Date | null {
  if (value === null || value === undefined) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
}

export type ConfirmationRetryCandidateRow = {
  registrationId: string;
  participantId: string;
  eventId: string;
  locale: "ro" | "en";
  recipientEmail: string;
  kind: "REAL" | "TEST";
  linkExpiresAt: Date;
  startsAt: Date;
};

/**
 * Every registration still waiting for its address whose link is alive after `from`, at a scheduled
 * event with internal registration that has not started — and every participant's own verification
 * email for those addresses at those events (club copies have no participant and are not read).
 * Few rows by nature: a link lives two days by default.
 */
export async function selectConfirmationRetryRows<T extends Row>(
  db: Database<T>,
  from: Date,
  deadlines: Pick<Deadlines, "confirmationHours">,
): Promise<{ candidates: ConfirmationRetryCandidateRow[]; emails: VerificationEmailRow[] }> {
  const lapse = emailLinkLapseSql(deadlines.confirmationHours);
  const raw = await db
    .select({
      registrationId: registrations.id,
      participantId: registrations.participantId,
      eventId: registrations.eventId,
      locale: registrations.locale,
      recipientEmail: participants.deliveryEmail,
      kind: registrations.kind,
      linkExpiresAt: lapse,
      startsAt: events.startsAt,
    })
    .from(registrations)
    .innerJoin(events, eq(events.id, registrations.eventId))
    .innerJoin(participants, eq(participants.id, registrations.participantId))
    .where(
      and(
        eq(registrations.status, "PENDING_EMAIL_CONFIRMATION"),
        eq(events.eventStatus, "SCHEDULED"),
        eq(events.registrationMode, "INTERNAL"),
        gt(events.startsAt, from),
        sql`${lapse} > ${from.toISOString()}::timestamptz`,
      ),
    );
  const candidates = raw.flatMap((row) => {
    const linkExpiresAt = toDate(row.linkExpiresAt);
    return linkExpiresAt ? [{ ...row, linkExpiresAt }] : [];
  });
  if (candidates.length === 0) return { candidates, emails: [] };

  const participantIds = [...new Set(candidates.map((row) => row.participantId))];
  const eventIds = [...new Set(candidates.map((row) => row.eventId))];
  const emails: VerificationEmailRow[] = [];
  for (let i = 0; i < participantIds.length; i += 500) {
    const rows = await db
      .select({
        id: emailOutbox.id,
        registrationId: registrations.id,
        participantId: emailOutbox.participantId,
        eventId: registrations.eventId,
        status: emailOutbox.status,
        sentAt: emailOutbox.sentAt,
        createdAt: emailOutbox.createdAt,
        retry: sql<boolean>`coalesce((${emailOutbox.payloadJson}->>${CONFIRMATION_RETRY})::boolean, false)`,
      })
      .from(emailOutbox)
      .innerJoin(registrations, eq(registrations.id, emailOutbox.registrationId))
      .where(
        and(
          eq(emailOutbox.messageType, "VERIFY_REGISTRATION_EMAIL"),
          isNotNull(emailOutbox.participantId),
          inArray(emailOutbox.participantId, participantIds.slice(i, i + 500)),
          inArray(registrations.eventId, eventIds),
        ),
      );
    for (const row of rows) {
      if (!row.participantId) continue;
      emails.push({ ...row, participantId: row.participantId, retry: row.retry === true || String(row.retry) === "true" });
    }
  }
  return { candidates, emails };
}

/** Every second email owed from `from` on, whether due now or later: the job's plan and the forecast. */
export async function planConfirmationRetriesFrom<T extends Row>(
  db: Database<T>,
  from: Date,
  deadlines: Pick<Deadlines, "confirmationHours" | "confirmationRetryHours" | "confirmationRetryLeftHours">,
): Promise<{ plans: ConfirmationRetryPlan[]; candidates: ConfirmationRetryCandidateRow[] }> {
  if (deadlines.confirmationRetryHours <= 0) return { plans: [], candidates: [] };
  const { candidates, emails } = await selectConfirmationRetryRows(db, from, deadlines);
  return { plans: planConfirmationRetries(candidates, emails, deadlines), candidates };
}

/**
 * The maintenance job's step (§NNN): queue each second email due at `now`, one per address and event,
 * by its own key, so a run repeated or overlapping queues nothing twice. Returns how many it queued.
 */
export async function queueConfirmationRetries<T extends Row>(
  db: Database<T>,
  now: Date,
  deadlines: Pick<Deadlines, "confirmationHours" | "confirmationRetryHours" | "confirmationRetryLeftHours">,
): Promise<number> {
  const { plans, candidates } = await planConfirmationRetriesFrom(db, now, deadlines);
  const due = dueConfirmationRetries(plans, now);
  if (due.length === 0) return 0;
  const byId = new Map(candidates.map((row) => [row.registrationId, row]));
  let queued = 0;
  await db.transaction(async (tx) => {
    for (const plan of due) {
      const row = byId.get(plan.registrationId);
      if (!row) continue;
      const inserted = await enqueueEmail(tx, {
        participantId: row.participantId,
        registrationId: row.registrationId,
        messageType: "VERIFY_REGISTRATION_EMAIL",
        // The registration's language, as every message about it.
        locale: row.locale,
        recipientEmail: row.recipientEmail,
        // No `startsDeadline` (§513): the link keeps the deadline its first email started.
        payload: { [CONFIRMATION_RETRY]: true },
        idempotencyKey: AUTOMATIC_SEND_KEYS.confirmationRetry(row.registrationId, plan.anchorId),
        now,
      });
      if (inserted) queued += 1;
    }
  });
  return queued;
}

/** The soonest second email still ahead of `now` (`jobs/next-work.ts`, §334), or null. */
export async function nextConfirmationRetry<T extends Row>(
  db: Database<T>,
  now: Date,
  deadlines: Pick<Deadlines, "confirmationHours" | "confirmationRetryHours" | "confirmationRetryLeftHours">,
): Promise<Date | null> {
  const { plans } = await planConfirmationRetriesFrom(db, now, deadlines);
  let best: Date | null = null;
  for (const plan of plans) {
    if (plan.at.getTime() > now.getTime() && (!best || plan.at.getTime() < best.getTime())) best = plan.at;
  }
  return best;
}
