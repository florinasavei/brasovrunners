import { and, eq, inArray, isNotNull, lt, notExists, or } from "drizzle-orm";
import { auditLogs } from "@/db/schema/audit-logs";
import { declarationAcceptances } from "@/db/schema/declaration-acceptances";
import { emailActionTokens } from "@/db/schema/email-action-tokens";
import { events } from "@/db/schema/events";
import { participants } from "@/db/schema/participants";
import { registrations } from "@/db/schema/registrations";
import { emailOutbox } from "@/db/schema/email-outbox";
import { jobRuns } from "@/db/schema/job-runs";
import { rateLimitBuckets } from "@/db/schema/rate-limit";
import type { Database } from "@/db/types";

/**
 * Deleting the rows nobody will ever read again.
 *
 * Four tables grow on their own — not with the club's races, but with the clock. `job_runs`
 * gains a row every five minutes whether or not anybody registers: 288 a day, 105,000 a year,
 * to answer a question ("did the scheduler run recently?") that only ever looks at the newest
 * one. The others grow with traffic and then never shrink.
 *
 * This is a retention sweep, not a feature. It removes only rows whose *purpose is spent*, and
 * two of the four windows are privacy improvements rather than housekeeping: a sent message
 * keeps a participant's address, and an action token keeps the link between a participant and a
 * registration. Holding either for years because nothing deleted them is not a decision anybody
 * made.
 *
 * What it deliberately does **not** touch: `registrations`, `participants`,
 * `declaration_acceptances`, `audit_logs`, `events`. How long the club keeps a runner's entry
 * after a race is a policy question with legal weight, and it belongs to the club rather than
 * to a sweep that runs every five minutes (`BUSINESS.md` §9). Erasing one person is
 * BR-REQ-037-06 and is deliberate, per-row, and audited.
 */

/**
 * The windows, as data, and each one is an argument rather than a round number.
 *
 * They are generous on purpose: the cost of keeping a row a week longer is a few kilobytes,
 * and the cost of deleting one somebody still needed is a support question nobody can answer.
 */
export const RETENTION = {
  /**
   * `/api/health` reads the newest run per job and nothing else, and `/devs` shows the same.
   * Thirty days is far more history than either uses, and enough to see a pattern by hand after
   * a bad week.
   */
  jobRunsDays: 30,
  /**
   * A throttle bucket is meaningless once its window has passed — `consumeRateLimit` keys on the
   * window start, so an old row can never be read again. One day rather than one hour so that a
   * clock skew or a long window added later cannot delete a bucket still in use.
   */
  rateLimitBucketsDays: 1,
  /**
   * A token that is spent or expired can never be accepted again (§13.2), so the row only holds
   * a hash and a link. Thirty days leaves the trail intact long enough to answer "did this link
   * work?" about a recent race.
   */
  spentTokensDays: 30,
  /**
   * A delivered message's row holds the recipient's address. Ninety days covers a season's
   * worth of "did they ever get it?", after which keeping the address is storage rather than
   * evidence. Rows that failed permanently are kept: those are the ones somebody investigates.
   */
  sentOutboxDays: 90,
  /**
   * A registration and the declaration signed for it are kept three years from the event's
   * start — the general limitation period of Codul civil art. 2517, within which a claim
   * about the event could still be made and the declaration is the evidence — and then go,
   * with the participant row when it was their last registration (`DECISIONS.md` §95). The
   * privacy notice says exactly this, and this is what makes it true.
   */
  registrationsYearsAfterEvent: 3,
  /**
   * The identity document's series and number, and the health note, go seven days after the
   * event's start — the kits are handed out by then, and the privacy notice says so (§95).
   * The declaration keeps the name, the signature, the version and the hash; the participant
   * keeps the PDF that was emailed with the number in it.
   */
  identityAndHealthDaysAfterEvent: 7,
  /** The log of staff actions: three years, as the notice says. */
  auditLogYears: 3,
} as const;

export type PruneCounts = {
  jobRuns: number;
  rateLimitBuckets: number;
  actionTokens: number;
  outboxMessages: number;
  registrations: number;
  participants: number;
  identityDocuments: number;
  healthNotes: number;
  auditLogs: number;
};

const daysBefore = (now: Date, days: number) => new Date(now.getTime() - days * 24 * 60 * 60_000);

/**
 * One statement per table, each with its own cutoff, and all of them safe to run again: a sweep
 * that deletes nothing is the ordinary case, since it runs every five minutes and these windows
 * are measured in days.
 */
export async function pruneExpiredRows<T extends Record<string, unknown>>(
  db: Database<T>,
  now: Date,
): Promise<PruneCounts> {
  const deletedJobRuns = await db
    .delete(jobRuns)
    .where(lt(jobRuns.startedAt, daysBefore(now, RETENTION.jobRunsDays)))
    .returning({ id: jobRuns.id });

  const deletedBuckets = await db
    .delete(rateLimitBuckets)
    .where(lt(rateLimitBuckets.windowStartsAt, daysBefore(now, RETENTION.rateLimitBucketsDays)))
    .returning({ key: rateLimitBuckets.key });

  /**
   * Spent or long expired, never merely old: a token issued yesterday with a fourteen-day life
   * is still the link in somebody's inbox, and deleting it would break a message already sent.
   */
  const tokenCutoff = daysBefore(now, RETENTION.spentTokensDays);
  const deletedTokens = await db
    .delete(emailActionTokens)
    .where(
      and(
        lt(emailActionTokens.expiresAt, now),
        or(
          // Used or invalidated — either way it can never be accepted again (§13.2).
          isNotNull(emailActionTokens.usedAt),
          isNotNull(emailActionTokens.invalidatedAt),
          lt(emailActionTokens.expiresAt, tokenCutoff),
        ),
      ),
    )
    .returning({ id: emailActionTokens.id });

  // SENT only. A BOUNCED or COMPLAINED row is the one an organizer goes looking for.
  const deletedOutbox = await db
    .delete(emailOutbox)
    .where(
      and(
        eq(emailOutbox.status, "SENT"),
        isNotNull(emailOutbox.sentAt),
        lt(emailOutbox.sentAt, daysBefore(now, RETENTION.sentOutboxDays)),
      ),
    )
    .returning({ id: emailOutbox.id });

  /**
   * Registrations of events that started more than the retention period ago, with their
   * declarations; then every participant left with no registration at all. Test rows go the
   * same way. Erase by hand (`admin-service.ts`) does the same for one person, sooner.
   */
  const eventCutoff = new Date(now.getTime());
  eventCutoff.setUTCFullYear(eventCutoff.getUTCFullYear() - RETENTION.registrationsYearsAfterEvent);
  const stale = db
    .select({ id: registrations.id })
    .from(registrations)
    .innerJoin(events, eq(events.id, registrations.eventId))
    .where(lt(events.startsAt, eventCutoff));
  await db.delete(declarationAcceptances).where(inArray(declarationAcceptances.registrationId, stale));
  const deletedRegistrations = await db
    .delete(registrations)
    .where(inArray(registrations.id, stale))
    .returning({ id: registrations.id });
  const deletedParticipants =
    deletedRegistrations.length > 0
      ? await db
          .delete(participants)
          .where(notExists(db.select({ id: registrations.id }).from(registrations).where(eq(registrations.participantId, participants.id))))
          .returning({ id: participants.id })
      : [];

  // Seven days after the event: the identity document out of the declaration, the health note
  // out of the registration. The rows stay; the two fields go.
  const shortCutoff = daysBefore(now, RETENTION.identityAndHealthDaysAfterEvent);
  const recent = db
    .select({ id: registrations.id })
    .from(registrations)
    .innerJoin(events, eq(events.id, registrations.eventId))
    .where(lt(events.startsAt, shortCutoff));
  const clearedDocuments = await db
    .update(declarationAcceptances)
    .set({ idDocument: null })
    .where(and(isNotNull(declarationAcceptances.idDocument), inArray(declarationAcceptances.registrationId, recent)))
    .returning({ id: declarationAcceptances.id });
  const clearedHealth = await db
    .update(registrations)
    .set({ healthNotes: null, healthConsentVersion: null, healthConsentAt: null, updatedAt: now })
    .where(and(isNotNull(registrations.healthNotes), inArray(registrations.id, recent)))
    .returning({ id: registrations.id });

  const auditCutoff = new Date(now.getTime());
  auditCutoff.setUTCFullYear(auditCutoff.getUTCFullYear() - RETENTION.auditLogYears);
  const deletedAudit = await db.delete(auditLogs).where(lt(auditLogs.createdAt, auditCutoff)).returning({ id: auditLogs.id });

  return {
    jobRuns: deletedJobRuns.length,
    rateLimitBuckets: deletedBuckets.length,
    actionTokens: deletedTokens.length,
    outboxMessages: deletedOutbox.length,
    registrations: deletedRegistrations.length,
    participants: deletedParticipants.length,
    identityDocuments: clearedDocuments.length,
    healthNotes: clearedHealth.length,
    auditLogs: deletedAudit.length,
  };
}

/** Total rows removed, for the one line the job logs. */
export function totalPruned(counts: PruneCounts): number {
  return Object.values(counts).reduce((sum, count) => sum + count, 0);
}
