import type { Database } from "@/db/types";
import { failureKind, pruneExpiredRows, retentionErrorSummary, totalPruned } from "@/modules/jobs/retention";
import { finishJobRun, startJobRun } from "@/modules/jobs/repository";
import { materializeStandingRepeats } from "@/modules/content/events/service";
import { readDeadlinesForRun } from "@/modules/deadlines/deadlines";
import { sweepOrphanAssets } from "@/modules/media/references";
import { queueEventReminders, queueParticipationConfirmations } from "@/modules/notifications/event-mail";
import { AUTOMATIC_SEND_KEYS } from "@/modules/notifications/domain/automatic-sends";
import { enqueueEmail } from "@/modules/notifications/outbox";
import { releaseLegacyHeldNumbers } from "./bibs";
import { revalidatePublicContent } from "@/modules/public-cache/cache";
import { queueNewEventAlerts } from "@/modules/newsletter/service";
import { announceLegalTemplateChanges, legalFactsInForce } from "@/modules/legal-documents/templates-notice";
import { purgeLapsedFamilyEntries } from "./family-entries";
import { purgeLapsedFamilySittings } from "./family-sitting";
import { queueRegistrationOpenedMessages } from "./interest";
import * as repo from "./repository";
import { fillAvailableSpots } from "./service";

/**
 * Registration maintenance (AGENTS.md §16.2): expire stale holds, close the waiting list for
 * events that have started, and offer released or newly free places to whoever is next — on
 * scheduled events only. A cancelled event is skipped like a completed one (§331): nothing
 * about its queue must still run, and every automatic message below asks for `SCHEDULED` too.
 * What still runs for everybody is event-blind: the lapse of unconfirmed addresses (the club's
 * hours, §377), the retention sweep, the picture sweep and the series horizon.
 *
 * A delivery and liveness mechanism, never a correctness one — §10.6 and §16.2 are both
 * explicit that capacity and queue correctness come from every read and every
 * capacity-changing transaction evaluating expiry against `now` itself. A missed or delayed
 * run here means a promotion email arrives late, not that anyone is overbooked or leapfrogged:
 * the very next registration attempt against the same event re-runs the same expiry check
 * inline before it is granted anything.
 *
 * One event-locked transaction per affected event, exactly as every other capacity-changing
 * path in `service.ts` uses — this is not a special case, it is the same allocator called on a
 * schedule instead of by a participant's click.
 */
export async function runRegistrationMaintenance<T extends Record<string, unknown>>(
  db: Database<T>,
  now: Date,
): Promise<{
  eventsProcessed: number;
  errorCount: number;
  prunedRows: number;
  orphanPicturesDeleted: number;
  remindersQueued: number;
  /** "Confirm your participation" messages queued this run (§104). */
  confirmationsQueued: number;
  /** "Registration is open" messages queued this run to the addresses left ahead of the window (§146). */
  interestsNotified: number;
  /**
   * Race numbers shown before §548 that a confirmed registration keeps, told to the runner this run
   * (`releaseLegacyHeldNumbers`) — once per database, zero on every run after the first.
   */
  legacyNumbersKept: number;
  /** Another person's kept forms nobody confirmed in time, deleted this run (§446). */
  familyEntriesPurged: number;
  /**
   * «Șabloanele textelor legale s-au schimbat» queued this run (§639): one per Administrator and
   * Superadministrator when a release moved a legal template, zero on every other run.
   */
  legalTemplatesNoticesQueued: number;
  /**
   * The failures the very next run could repair — an event's queue work, a reminder, a
   * confirmation, an announcement, a retention step — as opposed to the tidying ones (pictures,
   * series). Above zero, the run promises the pings no quiet, so the next ping tries again rather
   * than the next hour (§334). Retention is here since §322 made it loud: `failing` is two failed
   * runs in a row, and a retry an hour away would make that alarm an hour late.
   */
  retryableErrorCount: number;
}> {
  const jobRunId = await startJobRun(db, "registration-maintenance", now);

  /*
    The club's deadlines (§377), read once for the whole run and fresh — not from an instance's
    memo, which could be a minute old — and left in the memo, so the offers this run makes, the
    reminders it queues, the series it extends and the plan it writes afterwards (`next-work.ts`)
    all work from the same numbers.
  */
  const settings = await readDeadlinesForRun(db);

  /*
    The one data step of §548, first: a number exists only once a registration is confirmed, so
    what the old held-number column still holds is kept by a confirmed registration and cleared
    from every other one. Idempotent and cheap — the partial index holds exactly the rows it
    touches, none after the first run — so it runs every time rather than being remembered. A
    failure is retryable: every draw still treats the old column as taken meanwhile.
  */
  let kept: Awaited<ReturnType<typeof releaseLegacyHeldNumbers>>["kept"] = [];
  let legacyFailed = false;
  try {
    kept = (await releaseLegacyHeldNumbers(db, now)).kept;
    // The public list may show a kept number (§613): a one-off step that wrote some expires the cached pages.
    if (kept.length > 0) revalidatePublicContent("places");
  } catch {
    legacyFailed = true;
  }

  const lapsedEmailConfirmations = await repo.expireStalePendingEmailConfirmations(db, now, settings);

  /*
    Another person's form, kept for the address to confirm from its inbox (§446), deleted with the
    personal data it holds once the club's email-link window has passed unconfirmed. Event-blind,
    like the lapse above; a failure here is a row that lives until the next run, and it is counted
    as retryable so that run is the next ping, not the next hour (§334).
  */
  let familyEntriesPurged = 0;
  let familyPurgeFailed = false;
  try {
    familyEntriesPurged = await purgeLapsedFamilyEntries(db, now);
    // …and the family sittings nobody can act on any more (§519): ids and instants only, no names.
    await purgeLapsedFamilySittings(db, now);
  } catch {
    familyPurgeFailed = true;
  }

  const eventIds = await repo.findEventsNeedingMaintenance(db, now);
  let errorCount = (familyPurgeFailed ? 1 : 0) + (legacyFailed ? 1 : 0);
  let retryableErrorCount = errorCount;

  for (const eventId of eventIds) {
    try {
      await db.transaction(async (tx) => {
        const event = await repo.lockEventForCapacity(tx, eventId);
        if (!event) return;
        /*
          A cancelled event is left as it was cancelled (§331), and a completed one as it
          finished (§82): no hold expired and no offer made. The scan selects scheduled events
          only; this is the same rule under the lock, for a cancellation saved between the scan
          and this line.
        */
        if (event.eventStatus !== "SCHEDULED") return;

        if (event.startsAt <= now) {
          await repo.closeWaitlistForStartedEvent(tx, eventId, now);
        }

        await fillAvailableSpots(
          tx,
          {
            id: event.id,
            eventStatus: event.eventStatus,
            registrationMode: event.registrationMode,
            startsAt: event.startsAt,
            registrationOpensAt: event.registrationOpensAt,
            registrationOpensSoon: event.registrationOpensSoon,
            dateToBeAnnounced: event.dateToBeAnnounced,
            timeToBeAnnounced: event.timeToBeAnnounced,
            registrationClosesAt: event.registrationClosesAt,
            confirmationOpensDaysBefore: event.confirmationOpensDaysBefore,
            confirmationDeadlineDaysBefore: event.confirmationDeadlineDaysBefore,
            capacity: event.capacity,
            raceId: event.raceId,
            publishedAt: null,
          },
          now,
          settings,
        );
      });
    } catch {
      // One event's failure must not stop the run from reaching the rest — each event's work
      // is independent, and the next run retries whatever this one could not finish.
      errorCount += 1;
      retryableErrorCount += 1;
    }
  }

  /**
   * "Here is your race number" (§105's `BIB_ASSIGNED`), once, to a confirmed runner whose number
   * shown before §548 is now theirs for good — their confirmation said it was «provizoriu» and
   * promised the final one. Only for a race still ahead: a past or cancelled one needs no bib.
   * Queued after the data step's own transaction, and one per registration ever, by its own key,
   * so a retried run sends nothing twice.
   */
  let legacyNumbersKept = 0;
  try {
    await db.transaction(async (tx) => {
      for (const row of kept.filter((item) => item.raceAhead)) {
        const inserted = await enqueueEmail(tx, {
          participantId: row.participantId,
          registrationId: row.registrationId,
          messageType: "BIB_ASSIGNED",
          locale: row.locale,
          recipientEmail: row.recipientEmail,
          payload: { bibNumber: row.bibNumber },
          idempotencyKey: AUTOMATIC_SEND_KEYS.bibs(row.registrationId),
          now,
        });
        if (inserted) legacyNumbersKept += 1;
      }
    });
  } catch {
    // The numbers are written; a failure here is a message nobody got, not a race with no bibs.
    errorCount += 1;
  }

  /**
   * The reminders (§81), after the queue work and in their own try/catch: the reminder lead
   * before an event — the event's own, or the club's (§377) — every confirmed participant gets
   * one, once; the idempotency key holds across every run that sees the event inside the window.
   * A failure here is a late reminder, not a failed run.
   */
  let remindersQueued = 0;
  try {
    remindersQueued = await queueEventReminders(db, now, settings);
  } catch {
    errorCount += 1;
    retryableErrorCount += 1;
  }
  // The participation confirmations (§104), the same way: once per registration when the
  // event's window opens; a failure is a late reminder, not a failed run.
  let confirmationsQueued = 0;
  try {
    confirmationsQueued = await queueParticipationConfirmations(db, now);
  } catch {
    errorCount += 1;
    retryableErrorCount += 1;
  }
  // "Registration is open" (§146): to every address left on the event's page while the window
  // was ahead, once, the row gone with the message; the rows of an event that will never open
  // go too. A failure is a late announcement, not a failed run.
  let interestsNotified = 0;
  try {
    interestsNotified = (await queueRegistrationOpenedMessages(db, now)).queued;
  } catch {
    errorCount += 1;
    retryableErrorCount += 1;
  }
  // "A new event is on the calendar" (§445): once per event first published within the window, to
  // the newsletter's subscribers of its topics. A publication wakes this job (§334), so the alert
  // goes minutes after the press; a failure is a late alert, not a failed run.
  let eventAlertsQueued = 0;
  try {
    eventAlertsQueued = await queueNewEventAlerts(db, now);
  } catch {
    errorCount += 1;
    retryableErrorCount += 1;
  }

  /**
   * The Administrators' notice of a moved legal template (§639): at most one read of the legal texts'
   * overview an hour, whatever the pinger does (§479), and one email per Administrator and
   * Superadministrator per change of the templates. Caught on its own and never retryable: a template
   * that cannot be read is logged by its kind — never the error's text — and counted, and the job's
   * other work goes on; the step itself tries again at its next hour, not at the next ping.
   */
  let legalTemplatesNoticesQueued = 0;
  try {
    legalTemplatesNoticesQueued = (await announceLegalTemplateChanges(db, () => legalFactsInForce(db), now)).queued;
  } catch (error) {
    console.error("[legal-templates] the check of the legal templates failed", failureKind(error));
    errorCount += 1;
  }

  /**
   * The retention sweep, last and in its own try/catch.
   *
   * It rides on this job because it needs no scheduler of its own. Last, because expiring a
   * hold is the job's actual duty and deleting month-old rows must never delay it.
   *
   * **It fails loudly (§322).** It used to be caught and forgotten, on the reasoning that a
   * failure here was untidiness — and it is not: the sweep is what makes the privacy notice's
   * windows true, and an identity document still in the table on day eight is a promise broken
   * without anybody hearing about it. So each failed step is counted, logged by its name — never
   * the error's text, which can carry the SQL and the values in it — and written to the run's
   * `last_error` as `retention:<steps>`, which is what `jobs/health.ts` reads: two runs in a row
   * with it, and `/api/health` says `failing` and answers 503, which is what the monitor emails
   * on.
   *
   * Every failed step is also *retryable* (§334): the run then promises the pings no quiet, so
   * the second run that confirms or clears the failure is the next ping, not the next hour, and
   * the alarm is as prompt as §322 meant it to be.
   */
  let prunedRows = 0;
  let lastError: string | null = null;
  try {
    const pruned = await pruneExpiredRows(db, now);
    prunedRows = totalPruned(pruned);
    for (const failure of pruned.failures) {
      console.error("[retention] sweep step failed", failure.step, failureKind(failure.error));
    }
    errorCount += pruned.failures.length;
    retryableErrorCount += pruned.failures.length;
    lastError = retentionErrorSummary(pruned.failures);
  } catch (error) {
    // Nothing inside throws past its own step; this is the sweep failing to start at all.
    console.error("[retention] sweep step failed", "sweep", failureKind(error));
    errorCount += 1;
    retryableErrorCount += 1;
    lastError = retentionErrorSummary([{ step: "identity-and-health", error }]);
  }

  /**
   * The picture sweep, after the retention sweep and caught on its own for the same reasons
   * (AGENTS.md §17 "reference check before delete", `DECISIONS.md` §73): a stored picture
   * nothing has referenced for a week is deleted with its objects. Storage that is not
   * configured throws here and counts as one error, never as a failed run.
   */
  let orphanPicturesDeleted = 0;
  try {
    orphanPicturesDeleted = await sweepOrphanAssets(db, now);
  } catch {
    errorCount += 1;
  }

  /**
   * The standing series (§122): every source with a rule is brought up to the club's horizon —
   * eight weeks unless changed (§377). One indexed read for the sources, two per source, and on
   * most runs no write; caught on its own — a series that cannot be extended is a date missing
   * from the list next month, not a hold that never expires. A source the hidden list refused
   * (§NNN: its places reached «Numerele listei ascunse încep de la») makes none of its dates until it
   * is saved right; each counts as one error and is logged by its id, so the run says so every time.
   */
  let occurrencesCreated = 0;
  try {
    const series = await materializeStandingRepeats(db, now, settings);
    occurrencesCreated = series.created;
    for (const sourceId of series.refused) {
      console.error("[series] no new dates: the hidden list's numbers start inside the race's series or the spares", sourceId);
    }
    errorCount += series.refused.length;
  } catch {
    errorCount += 1;
  }

  await finishJobRun(
    db,
    jobRunId,
    {
      itemsProcessed:
        eventIds.length +
        lapsedEmailConfirmations +
        familyEntriesPurged +
        prunedRows +
        orphanPicturesDeleted +
        remindersQueued +
        confirmationsQueued +
        interestsNotified +
        eventAlertsQueued +
        legalTemplatesNoticesQueued +
        occurrencesCreated,
      errorCount,
      // The retention steps that failed, by name (§322) — the one error this run writes down,
      // because it is the one `/api/health` is asked to turn into an alarm.
      lastError,
    },
    new Date(),
  );

  return {
    eventsProcessed: eventIds.length,
    errorCount,
    prunedRows,
    orphanPicturesDeleted,
    remindersQueued,
    confirmationsQueued,
    interestsNotified,
    legacyNumbersKept,
    familyEntriesPurged,
    legalTemplatesNoticesQueued,
    retryableErrorCount,
  };
}
