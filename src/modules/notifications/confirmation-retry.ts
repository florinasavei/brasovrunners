import { and, eq, gt, inArray, isNotNull, sql } from "drizzle-orm";
import { emailOutbox } from "@/db/schema/email-outbox";
import { events } from "@/db/schema/events";
import { participants } from "@/db/schema/participants";
import { registrations } from "@/db/schema/registrations";
import type { Database } from "@/db/types";
import type { Deadlines } from "@/modules/deadlines/domain/deadlines";
import { emailLinkLapseSql } from "@/modules/registrations/repository";
import { governorEffects } from "@/modules/diagnostics/domain/neon-budget";
import { peekNeonBudgetLevel } from "@/modules/diagnostics/budget-level";
import { readJobCadence } from "@/modules/jobs/cadence";
import { pingerCadenceMinutes } from "@/modules/jobs/quiet-hours";
import { STARTS_DEADLINE } from "./domain/deadline-rebase";
import {
  AUTOMATIC_SEND_KEYS,
  CONFIRMATION_RETRY,
  type ConfirmationRetryPlan,
  dueConfirmationRetries,
  isConfirmationRetryDue,
  planConfirmationRetries,
  type VerificationEmailRow,
} from "./domain/automatic-sends";
import { judgeEmailDelay } from "./domain/email-delay";
import { emailWaitMinutes } from "./domain/email-wait";
import { readDeliveryTiming } from "./delivery-timing";
import { enqueueEmail } from "./outbox";
import { readEmailDelayFacts } from "./public-delay";

/**
 * The verification email re-sent by itself (§NNN; the owner, 2026-10-03: «Pe viitor ne trebuie
 * mecanism și setare de retry de confirmare email»): the address link once more, to whoever has not
 * confirmed and still can — the club's hours after the last email left, at most the club's number of
 * times, every verification email for the address and the event counting («Termene»). Who and when
 * is `domain/automatic-sends.ts#planConfirmationRetries`; this file selects the rows it reads and
 * queues what it decides.
 *
 * It changes no state: no deadline moves (the row carries no `startsDeadline`, §513), no place is
 * held, the allocator is not called. **Not the same link, deliberately.** A link is stored only as
 * its hash (§12.8), so the first email's link cannot be sent again: the renderer mints a new one at
 * the send like every other (§14.5), and it supersedes the first email's, whose page then says a
 * newer email has it (§619). A test registration is selected exactly like a real one (§12.6).
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
): Promise<{ candidates: ConfirmationRetryCandidateRow[]; emails: VerificationEmailRow[]; refused: Set<string> }> {
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
  if (candidates.length === 0) return { candidates, emails: [], refused: new Set() };

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
        startsDeadline: sql<boolean>`coalesce((${emailOutbox.payloadJson}->>${STARTS_DEADLINE}::text) = 'true', false)`,
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
      emails.push({ ...row, participantId: row.participantId, startsDeadline: row.startsDeadline === true || String(row.startsDeadline) === "true" });
    }
  }
  return { candidates, emails, refused: await refusedAddresses(db, participantIds) };
}

/**
 * The addresses that bounced or complained on any message, for any event (§76, §83): the outbox keeps
 * no suppression list of its own, so the re-sent email reads the rows themselves.
 */
async function refusedAddresses<T extends Row>(db: Database<T>, participantIds: readonly string[]): Promise<Set<string>> {
  const refused = new Set<string>();
  for (let i = 0; i < participantIds.length; i += 500) {
    const rows = await db
      .selectDistinct({ participantId: emailOutbox.participantId })
      .from(emailOutbox)
      .where(and(inArray(emailOutbox.status, ["BOUNCED", "COMPLAINED"]), inArray(emailOutbox.participantId, participantIds.slice(i, i + 500))));
    for (const row of rows) if (row.participantId) refused.add(row.participantId);
  }
  return refused;
}

/** Every re-sent email owed from `from` on, whether due now or later: the job's plan and the forecast. */
export async function planConfirmationRetriesFrom<T extends Row>(
  db: Database<T>,
  from: Date,
  deadlines: Pick<Deadlines, "confirmationHours" | "verificationRetryHours" | "verificationRetries">,
): Promise<{ plans: ConfirmationRetryPlan[]; candidates: ConfirmationRetryCandidateRow[] }> {
  if (deadlines.verificationRetries <= 0) return { plans: [], candidates: [] };
  const { candidates, emails, refused } = await selectConfirmationRetryRows(db, from, deadlines);
  return { plans: planConfirmationRetries(candidates, emails, deadlines, refused), candidates };
}

/**
 * Whether the outbox is behind right now (§623): the same judgement the public pages read
 * (`cachedEmailDelay`), from the outbox's facts and the wait the platform promises, read straight
 * through. While it is late, a re-sent email would only queue behind — and compete with — the first
 * emails of people registering now, so the job waits for it to catch up.
 */
export async function outboxIsBehind<T extends Row>(db: Database<T>, now: Date): Promise<boolean> {
  const [facts, { timing }, { minutes }] = await Promise.all([readEmailDelayFacts(db, now), readDeliveryTiming(db), readJobCadence(db)]);
  const floor = governorEffects(peekNeonBudgetLevel(now)).jobFloorMinutes;
  const promisedAt = (instant: Date) =>
    emailWaitMinutes({ timing, pingerMinutes: pingerCadenceMinutes(instant), intervalMinutes: minutes, governorFloorMinutes: floor });
  return judgeEmailDelay(facts, promisedAt(now), now, promisedAt).late;
}

/**
 * The maintenance job's step (§NNN): queue each re-sent email due at `now`, one per address and event,
 * oldest due first and at most `CONFIRMATION_RETRY_RUN_CAP`, by its own key, so a run repeated or
 * overlapping queues nothing twice — and nothing at all while the outbox is behind. Returns how many it queued.
 */
export async function queueConfirmationRetries<T extends Row>(
  db: Database<T>,
  now: Date,
  deadlines: Pick<Deadlines, "confirmationHours" | "verificationRetryHours" | "verificationRetries">,
): Promise<number> {
  if (deadlines.verificationRetries <= 0) return 0;
  const { plans, candidates } = await planConfirmationRetriesFrom(db, now, deadlines);
  const due = dueConfirmationRetries(plans, now);
  if (due.length === 0) return 0;
  if (await outboxIsBehind(db, now)) return 0;
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
        idempotencyKey: AUTOMATIC_SEND_KEYS.confirmationRetry(row.registrationId, plan.attempt),
        now,
      });
      if (inserted) queued += 1;
    }
  });
  return queued;
}

/**
 * When the job should next look for a re-sent email (`jobs/next-work.ts`, §334), or null: the soonest
 * still ahead of `now` — or, for one due now that the run left behind (the per-run cap, an outbox
 * behind), the pinger's next call, so the job's quiet never hides it until the daily window.
 */
export async function nextConfirmationRetry<T extends Row>(
  db: Database<T>,
  now: Date,
  deadlines: Pick<Deadlines, "confirmationHours" | "verificationRetryHours" | "verificationRetries">,
): Promise<Date | null> {
  const { plans } = await planConfirmationRetriesFrom(db, now, deadlines);
  const leftBehind = new Date(now.getTime() + pingerCadenceMinutes(now) * 60_000);
  let best: Date | null = null;
  for (const plan of plans) {
    const at = isConfirmationRetryDue(plan, now) ? leftBehind : plan.at.getTime() > now.getTime() ? plan.at : null;
    if (at && (!best || at.getTime() < best.getTime())) best = at;
  }
  return best;
}
