import { and, eq, inArray, isNotNull, isNull, lt, notExists, or, sql } from "drizzle-orm";
import { auditLogs } from "@/db/schema/audit-logs";
import { declarationAcceptances } from "@/db/schema/declaration-acceptances";
import { emailActionTokens } from "@/db/schema/email-action-tokens";
import { events } from "@/db/schema/events";
import { participants } from "@/db/schema/participants";
import { registrations } from "@/db/schema/registrations";
import { emailOutbox } from "@/db/schema/email-outbox";
import { groupRunDeclarations } from "@/db/schema/group-run-declarations";
import { jobRuns } from "@/db/schema/job-runs";
import { newsletterSubscribers, newsletterTokens } from "@/db/schema/newsletter";
import { rateLimitBuckets } from "@/db/schema/rate-limit";
import type { Database } from "@/db/types";
import { scrubRegistrationsFromAudit } from "@/modules/audit/repository";
import { GROUP_RUN_DECLARATION_RETENTION_DAYS } from "@/modules/group-run-declarations/domain";
import { revalidatePublicContent } from "@/modules/public-cache/cache";
import { RETENTION_PERIODS } from "./domain/retention-periods";

/**
 * Deleting the rows nobody will ever read again, and the personal data nobody may keep.
 *
 * Every window this sweep enforces, in the order it runs them (§322):
 *
 *     identity document, health note,  7 days after the event's start (cleared, the rows stay)
 *     emergency contact                  (the contact since §421)
 *     a group run's self-declarations  7 days after the event's start (the rows go; §393)
 *     a minor's Strava and Instagram   never kept (cleared on every run; §323, §324)
 *     job runs                         30 days
 *     throttle buckets                 1 day
 *     action tokens                    30 days after use, invalidation or expiry
 *     sent messages                    90 days after sending
 *     messages about nobody            90 days after queueing, any status
 *     unconfirmed registrations        30 days after the address lapsed unconfirmed
 *     registrations and declarations   3 years after the event's start, then the participant
 *     audit log                        3 years
 *
 * **`privacy-notice.ts` §7 states these; change both together.** The notice is what the club
 * promised a runner, and this file is what makes the promise true — a window changed here and
 * not there is a notice that says something false.
 *
 * What it deliberately does **not** do is decide policy: every window is the club's, written in
 * its notice, and erasing one person sooner is BR-REQ-037-06 — deliberate, per row, audited.
 *
 * ## Each step on its own (§322)
 *
 * A step is a transaction of its own and a `try` of its own. One that throws — a lock timeout,
 * a constraint nobody expected — is recorded in `failures` by its name and the sweep goes on to
 * the next, because a failure in the three-year delete must never be the reason an identity
 * document outlives its seven days. And the seven-day clearing runs **first**, for the same
 * reason: it is the window whose breach is a breach of special-category data.
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
   * a hash and a link. Thirty days — from the use, the invalidation or the expiry, whichever
   * came first — leaves the trail intact long enough to answer "did this link work?" about a
   * recent race, and no longer: a link used in March with a December expiry used to wait until
   * December (§322).
   */
  spentTokensDays: 30,
  /**
   * A delivered message's row holds the recipient's address. Ninety days covers a season's
   * worth of "did they ever get it?", after which keeping the address is storage rather than
   * evidence. Rows that failed permanently are kept with their registration: those are the ones
   * somebody investigates.
   */
  sentOutboxDays: 90,
  /**
   * A message about nobody — no registration and no participant behind it: the "registration
   * is open" note to an address left on an event's page, a staff invitation — has no row that
   * will ever take it away with it, so it goes ninety days after it was queued, whatever its
   * status (§322). The same ninety days as a sent message, because it is the same question.
   */
  orphanOutboxDays: 90,
  /**
   * An address never confirmed, a place never held: nothing to prove (§322).
   *
   * A registration whose email link lapsed (`EMAIL_CONFIRMATION_LAPSED`) was never the
   * participant's: nobody proved the address was theirs, no declaration was signed and no place
   * was ever occupied. Thirty days is long enough to answer "I registered and never got the
   * email", and keeping it three years would be keeping a stranger's typing.
   */
  unconfirmedRegistrationDays: 30,
  /**
   * An address left in the newsletter's pop-up and never confirmed (§NNN): gone once its link can
   * no longer work — the longest the club's email-link window may be (168 hours, `deadlines.ts`)
   * plus a day — counted from the last time the form was sent with it. Somebody else may have
   * typed it; nothing was ever sent to it but the one confirmation message.
   */
  unconfirmedSubscriberDays: 8,
  /**
   * A registration and the declaration signed for it are kept three years from the event's
   * start — the general limitation period of Codul civil art. 2517, within which a claim
   * about the event could still be made and the declaration is the evidence — and then go,
   * with the participant row when it was their last registration (`DECISIONS.md` §95). The
   * privacy notice says exactly this, and this is what makes it true.
   *
   * Moved to `domain/retention-periods.ts` so a pure module — `notifications/templates.ts`
   * included — can read it without pulling in `drizzle` and every schema this file touches.
   */
  registrationsYearsAfterEvent: RETENTION_PERIODS.registrationsYearsAfterEvent,
  /**
   * The identity document's series and number, and the health note, go seven days after the
   * event's start — the kits are handed out by then, and the privacy notice says so (§95).
   * The declaration keeps the name, the signature, the version and the hash; the participant
   * keeps the PDF that was emailed with the number in it.
   */
  identityAndHealthDaysAfterEvent: RETENTION_PERIODS.identityAndHealthDaysAfterEvent,
  /**
   * A group run's optional self-declaration (§393) goes whole seven days after the run's start —
   * the row, the name, the identity document and the address, and the messages that carry them.
   * It exists for the run: nobody registered, no kit was handed out, and there is no three-year
   * record of a registration for it to be the evidence of. The signer keeps the PDF that was
   * emailed; the club's archive copy has the document masked (§320). The same seven days as the
   * identity document above, so the run's page and the privacy notice can say one number. The
   * number itself lives in `group-run-declarations/domain.ts`, where the pages and the emails
   * read it too.
   */
  groupRunDeclarationsDaysAfterEvent: GROUP_RUN_DECLARATION_RETENTION_DAYS,
  /** The log of staff actions: three years, as the notice says. */
  auditLogYears: 3,
} as const;

export type PruneCounts = {
  jobRuns: number;
  rateLimitBuckets: number;
  actionTokens: number;
  outboxMessages: number;
  /** Messages about nobody, gone after `orphanOutboxDays` (§322). */
  orphanOutboxMessages: number;
  /** Registrations whose address lapsed unconfirmed, gone after `unconfirmedRegistrationDays` (§322). */
  unconfirmedRegistrations: number;
  registrations: number;
  participants: number;
  identityDocuments: number;
  healthNotes: number;
  /** Registrations whose emergency contact was cleared, seven days after the event (§421). */
  emergencyContacts: number;
  /** A minor's Strava and Instagram, kept from before the rule that stores none (§323, §324). */
  minorSocials: number;
  /** A group run's self-declarations, gone seven days after the run (§393). */
  groupRunDeclarations: number;
  auditLogs: number;
  /** Newsletter addresses never confirmed, and the newsletter's links nobody can use any more (§NNN). */
  newsletter: number;
};

/**
 * The steps, by name — what a failure is reported as, and the only thing about it that leaves
 * this module: never the error's text, which can carry the SQL and the values in it.
 */
export const PRUNE_STEPS = [
  "identity-and-health",
  "group-run-declarations",
  "minor-socials",
  "job-runs",
  "rate-limit-buckets",
  "action-tokens",
  "sent-outbox",
  "orphan-outbox",
  "unconfirmed-registrations",
  "registrations-after-event",
  "audit-log",
  "newsletter",
] as const;
export type PruneStep = (typeof PRUNE_STEPS)[number];

export type PruneFailure = { step: PruneStep; error: unknown };

/** The counts, and the steps that threw (§322): an empty list is a sweep that did all of it. */
export type PruneResult = PruneCounts & { failures: PruneFailure[] };

const daysBefore = (now: Date, days: number) => new Date(now.getTime() - days * 24 * 60 * 60_000);

function yearsBefore(now: Date, years: number): Date {
  const cutoff = new Date(now.getTime());
  cutoff.setUTCFullYear(cutoff.getUTCFullYear() - years);
  return cutoff;
}

/**
 * Every participant left with no registration at all goes too (`DECISIONS.md` §88): the address
 * and the name are kept "with the last registration" and not a day longer.
 */
async function deleteOrphanParticipants<T extends Record<string, unknown>>(db: Database<T>): Promise<number> {
  const deleted = await db
    .delete(participants)
    .where(notExists(db.select({ id: registrations.id }).from(registrations).where(eq(registrations.participantId, participants.id))))
    .returning({ id: participants.id });
  return deleted.length;
}

/**
 * One statement group per window, each with its own cutoff, its own transaction and its own
 * `try`, and all of them safe to run again: a sweep that deletes nothing is the ordinary case,
 * since it runs every few minutes and these windows are measured in days.
 */
export async function pruneExpiredRows<T extends Record<string, unknown>>(
  db: Database<T>,
  now: Date,
): Promise<PruneResult> {
  const counts: PruneCounts = {
    jobRuns: 0,
    rateLimitBuckets: 0,
    actionTokens: 0,
    outboxMessages: 0,
    orphanOutboxMessages: 0,
    unconfirmedRegistrations: 0,
    registrations: 0,
    participants: 0,
    identityDocuments: 0,
    healthNotes: 0,
    emergencyContacts: 0,
    minorSocials: 0,
    groupRunDeclarations: 0,
    auditLogs: 0,
    newsletter: 0,
  };
  const failures: PruneFailure[] = [];

  /** A step in its own transaction — a savepoint when `db` already is one — and its own `try`. */
  const step = async (name: PruneStep, work: (tx: Database<T>) => Promise<void>): Promise<void> => {
    try {
      await db.transaction(async (tx) => work(tx as unknown as Database<T>));
    } catch (error) {
      failures.push({ step: name, error });
    }
  };

  // First (§322): seven days after the event, the identity documents out of the declaration and
  // the health note out of the registration. The rows stay; the fields go. A minor's declaration
  // carries two documents, the parent's and the child's (§330), and both go together — the typed
  // names stay, as the signatures, for the three years the declaration is kept. The window whose
  // breach is special-category data runs before anything that could throw ahead of it.
  await step("identity-and-health", async (tx) => {
    const shortCutoff = daysBefore(now, RETENTION.identityAndHealthDaysAfterEvent);
    const recent = tx
      .select({ id: registrations.id })
      .from(registrations)
      .innerJoin(events, eq(events.id, registrations.eventId))
      .where(lt(events.startsAt, shortCutoff));
    const clearedDocuments = await tx
      .update(declarationAcceptances)
      .set({ idDocument: null, minorIdDocument: null })
      .where(
        and(
          or(isNotNull(declarationAcceptances.idDocument), isNotNull(declarationAcceptances.minorIdDocument)),
          inArray(declarationAcceptances.registrationId, recent),
        ),
      )
      .returning({ id: declarationAcceptances.id });
    const clearedHealth = await tx
      .update(registrations)
      .set({ healthNotes: null, healthConsentVersion: null, healthConsentAt: null, updatedAt: now })
      .where(and(isNotNull(registrations.healthNotes), inArray(registrations.id, recent)))
      .returning({ id: registrations.id });
    /*
      The emergency contact (§421): a third person's name and number, asked for race day and for
      nothing after it. Cleared with the documents and the note — a separate statement, so the
      count says how many rows lost a contact rather than a note — and kept no longer than seven
      days because nobody is rung about a race that is over.
    */
    const clearedContacts = await tx
      .update(registrations)
      .set({ emergencyContactName: null, emergencyContactPhone: null, updatedAt: now })
      .where(
        and(
          or(isNotNull(registrations.emergencyContactName), isNotNull(registrations.emergencyContactPhone)),
          inArray(registrations.id, recent),
        ),
      )
      .returning({ id: registrations.id });
    counts.identityDocuments = clearedDocuments.length;
    counts.healthNotes = clearedHealth.length;
    counts.emergencyContacts = clearedContacts.length;
  });

  /*
    A group run's optional self-declarations (§393), seven days after the run: the whole row, and
    first the outbox rows about it, which carry the signer's address — a message not sent by then
    has nothing left to send. Second, beside the identity documents, for the same reason: an
    identity number is the data whose window matters most.
  */
  await step("group-run-declarations", async (tx) => {
    const stale = tx
      .select({ id: groupRunDeclarations.id })
      .from(groupRunDeclarations)
      .innerJoin(events, eq(events.id, groupRunDeclarations.eventId))
      .where(lt(events.startsAt, daysBefore(now, RETENTION.groupRunDeclarationsDaysAfterEvent)));
    // Compared as text, so a payload of any other shape is simply not matched.
    await tx
      .delete(emailOutbox)
      .where(
        inArray(
          sql`${emailOutbox.payloadJson}->>'groupRunDeclarationId'`,
          tx
            .select({ id: sql<string>`${groupRunDeclarations.id}::text` })
            .from(groupRunDeclarations)
            .innerJoin(events, eq(events.id, groupRunDeclarations.eventId))
            .where(lt(events.startsAt, daysBefore(now, RETENTION.groupRunDeclarationsDaysAfterEvent))),
        ),
      );
    const deleted = await tx.delete(groupRunDeclarations).where(inArray(groupRunDeclarations.id, stale)).returning({ id: groupRunDeclarations.id });
    counts.groupRunDeclarations = deleted.length;
  });

  /*
    No Strava or Instagram for a minor (§323): new submissions store none, decided on the day of
    registering — somebody under eighteen on the day the row was written. Rows written before
    that rule kept what they were given, and the privacy notice says the club keeps none, so the
    sweep makes it true for them (§324) and keeps it true for any row written some other way.
    The same calendar rule as `isMinorOn`: the eighteenth birthday at midnight UTC.
  */
  await step("minor-socials", async (tx) => {
    const cleared = await tx
      .update(registrations)
      .set({ stravaUrl: null, instagramHandle: null, updatedAt: now })
      .where(
        and(
          or(isNotNull(registrations.stravaUrl), isNotNull(registrations.instagramHandle)),
          isNotNull(registrations.birthDate),
          sql`${registrations.createdAt} < ((${registrations.birthDate} + interval '18 years') AT TIME ZONE 'UTC')`,
        ),
      )
      .returning({ id: registrations.id });
    counts.minorSocials = cleared.length;
  });

  await step("job-runs", async (tx) => {
    const deleted = await tx
      .delete(jobRuns)
      .where(lt(jobRuns.startedAt, daysBefore(now, RETENTION.jobRunsDays)))
      .returning({ id: jobRuns.id });
    counts.jobRuns = deleted.length;
  });

  await step("rate-limit-buckets", async (tx) => {
    const deleted = await tx
      .delete(rateLimitBuckets)
      .where(lt(rateLimitBuckets.windowStartsAt, daysBefore(now, RETENTION.rateLimitBucketsDays)))
      .returning({ key: rateLimitBuckets.key });
    counts.rateLimitBuckets = deleted.length;
  });

  /**
   * Thirty days after it stopped working, whichever way it stopped (§322): used, invalidated or
   * expired. Never merely old — a token issued yesterday with a fourteen-day life, never used,
   * is still the link in somebody's inbox, and none of the three conditions is true of it.
   */
  await step("action-tokens", async (tx) => {
    const tokenCutoff = daysBefore(now, RETENTION.spentTokensDays);
    const deleted = await tx
      .delete(emailActionTokens)
      .where(
        or(
          and(isNotNull(emailActionTokens.usedAt), lt(emailActionTokens.usedAt, tokenCutoff)),
          and(isNotNull(emailActionTokens.invalidatedAt), lt(emailActionTokens.invalidatedAt, tokenCutoff)),
          lt(emailActionTokens.expiresAt, tokenCutoff),
        ),
      )
      .returning({ id: emailActionTokens.id });
    counts.actionTokens = deleted.length;
  });

  // SENT only. A BOUNCED or COMPLAINED row is the one an organizer goes looking for.
  await step("sent-outbox", async (tx) => {
    const deleted = await tx
      .delete(emailOutbox)
      .where(
        and(
          eq(emailOutbox.status, "SENT"),
          isNotNull(emailOutbox.sentAt),
          lt(emailOutbox.sentAt, daysBefore(now, RETENTION.sentOutboxDays)),
        ),
      )
      .returning({ id: emailOutbox.id });
    counts.outboxMessages = deleted.length;
  });

  // About nobody (§322): no registration and no participant will ever take these rows with it.
  await step("orphan-outbox", async (tx) => {
    const deleted = await tx
      .delete(emailOutbox)
      .where(
        and(
          isNull(emailOutbox.registrationId),
          isNull(emailOutbox.participantId),
          lt(emailOutbox.createdAt, daysBefore(now, RETENTION.orphanOutboxDays)),
        ),
      )
      .returning({ id: emailOutbox.id });
    counts.orphanOutboxMessages = deleted.length;
  });

  /**
   * An address never confirmed, a place never held (§322). `status = EXPIRED` beside the reason,
   * because a lapsed row can be restarted on the same row (§145) and a restart does not clear the
   * reason it once expired for: the status is what says it is still over.
   */
  await step("unconfirmed-registrations", async (tx) => {
    const lapsed = tx
      .select({ id: registrations.id })
      .from(registrations)
      .where(
        and(
          eq(registrations.status, "EXPIRED"),
          eq(registrations.expiryReason, "EMAIL_CONFIRMATION_LAPSED"),
          lt(registrations.expiredAt, daysBefore(now, RETENTION.unconfirmedRegistrationDays)),
        ),
      );
    // The trail loses what the manual erase takes from it (§324) — a rename's two names, a typed
    // reason, the participant id — before the rows it describes go, in the same transaction.
    await scrubRegistrationsFromAudit(tx, lapsed);
    await tx.delete(declarationAcceptances).where(inArray(declarationAcceptances.registrationId, lapsed));
    const deleted = await tx.delete(registrations).where(inArray(registrations.id, lapsed)).returning({ id: registrations.id });
    counts.unconfirmedRegistrations = deleted.length;
    if (deleted.length > 0) counts.participants += await deleteOrphanParticipants(tx);
  });
  // The public cache (§333, public pages from cache) is told after the step commits, as for the
  // three-year delete below. A lapsed row held no place and never reached the start list, so no
  // page changes in fact; the rule is simply that a sweep deleting registrations says so, and
  // every such sweep is one more thing a count on a public page is made of.
  if (counts.unconfirmedRegistrations > 0) revalidatePublicContent("places");

  /**
   * Registrations of events that started more than the retention period ago, with their
   * declarations; then every participant left with no registration at all. Test rows go the
   * same way. Erase by hand (`admin-service.ts`) does the same for one person, sooner.
   */
  await step("registrations-after-event", async (tx) => {
    const eventCutoff = yearsBefore(now, RETENTION.registrationsYearsAfterEvent);
    const stale = tx
      .select({ id: registrations.id })
      .from(registrations)
      .innerJoin(events, eq(events.id, registrations.eventId))
      .where(lt(events.startsAt, eventCutoff));
    // An audit row written after the event (a check-in, a rename on race day) is younger than
    // the registration's window and would outlive it with the name in it: scrubbed as an erase
    // scrubs (§324), before the delete.
    await scrubRegistrationsFromAudit(tx, stale);
    await tx.delete(declarationAcceptances).where(inArray(declarationAcceptances.registrationId, stale));
    const deleted = await tx.delete(registrations).where(inArray(registrations.id, stale)).returning({ id: registrations.id });
    counts.registrations = deleted.length;
    if (deleted.length > 0) counts.participants += await deleteOrphanParticipants(tx);
  });
  // An old race's page still shows its start list, from the public cache (§333): the names that
  // retention has just removed must leave it too. After the step's commit.
  if (counts.registrations > 0) revalidatePublicContent("places");

  await step("audit-log", async (tx) => {
    const deleted = await tx
      .delete(auditLogs)
      .where(lt(auditLogs.createdAt, yearsBefore(now, RETENTION.auditLogYears)))
      .returning({ id: auditLogs.id });
    counts.auditLogs = deleted.length;
  });

  /**
   * The newsletter (§NNN): an address never confirmed, once its link cannot work; and the links
   * themselves thirty days after they stopped working, the rule of the action tokens above. A
   * confirmed subscriber stays until they unsubscribe, which deletes them at once.
   */
  await step("newsletter", async (tx) => {
    const unconfirmed = await tx
      .delete(newsletterSubscribers)
      .where(and(isNull(newsletterSubscribers.confirmedAt), lt(newsletterSubscribers.updatedAt, daysBefore(now, RETENTION.unconfirmedSubscriberDays))))
      .returning({ id: newsletterSubscribers.id });
    const tokenCutoff = daysBefore(now, RETENTION.spentTokensDays);
    const links = await tx
      .delete(newsletterTokens)
      .where(
        or(
          and(isNotNull(newsletterTokens.usedAt), lt(newsletterTokens.usedAt, tokenCutoff)),
          and(isNotNull(newsletterTokens.invalidatedAt), lt(newsletterTokens.invalidatedAt, tokenCutoff)),
          lt(newsletterTokens.expiresAt, tokenCutoff),
        ),
      )
      .returning({ id: newsletterTokens.id });
    counts.newsletter = unconfirmed.length + links.length;
  });

  return { ...counts, failures };
}

/** Total rows removed, for the one line the job logs. The counts only — never the failures. */
export function totalPruned(counts: PruneCounts): number {
  return (
    counts.jobRuns +
    counts.rateLimitBuckets +
    counts.actionTokens +
    counts.outboxMessages +
    counts.orphanOutboxMessages +
    counts.unconfirmedRegistrations +
    counts.registrations +
    counts.participants +
    counts.identityDocuments +
    counts.healthNotes +
    counts.emergencyContacts +
    counts.minorSocials +
    counts.groupRunDeclarations +
    counts.auditLogs +
    counts.newsletter
  );
}

/**
 * What `job_runs.last_error` says about a sweep that failed (§322): the step names and nothing
 * else — `retention:registrations-after-event,audit-log`. `jobs/health.ts` reads the prefix.
 */
export const RETENTION_ERROR_PREFIX = "retention:";

/**
 * What a log line may say about a failed step's error: the SQLSTATE when the driver gave one
 * (`57014`, a statement timeout), the error's class otherwise. Never the message, which is where
 * PostgreSQL puts the values of the row it refused.
 */
export function failureKind(error: unknown): string {
  const code = (error as { code?: unknown; cause?: { code?: unknown } } | null)?.code ?? (error as { cause?: { code?: unknown } } | null)?.cause?.code;
  if (typeof code === "string" && /^[0-9A-Z]{5}$/.test(code)) return code;
  return error instanceof Error ? error.name : "error";
}

export function retentionErrorSummary(failures: readonly PruneFailure[]): string | null {
  return failures.length === 0 ? null : `${RETENTION_ERROR_PREFIX}${failures.map((failure) => failure.step).join(",")}`;
}
