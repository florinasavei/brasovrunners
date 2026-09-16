import type { Database } from "@/db/types";
import { pruneExpiredRows, totalPruned } from "@/modules/jobs/retention";
import { finishJobRun, startJobRun } from "@/modules/jobs/repository";
import * as repo from "./repository";
import { fillAvailableSpots } from "./service";

/**
 * Registration maintenance (AGENTS.md §16.2): expire stale holds, close the waiting list for
 * events that have started, and offer released or newly free places to whoever is next.
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
): Promise<{ eventsProcessed: number; errorCount: number; prunedRows: number }> {
  const jobRunId = await startJobRun(db, "registration-maintenance", now);

  const lapsedEmailConfirmations = await repo.expireStalePendingEmailConfirmations(db, now);

  const eventIds = await repo.findEventsNeedingMaintenance(db, now);
  let errorCount = 0;

  for (const eventId of eventIds) {
    try {
      await db.transaction(async (tx) => {
        const event = await repo.lockEventForCapacity(tx, eventId);
        if (!event) return;

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
            registrationClosesAt: event.registrationClosesAt,
            capacity: event.capacity,
            raceId: event.raceId,
            publishedAt: null,
          },
          now,
        );
      });
    } catch {
      // One event's failure must not stop the run from reaching the rest — each event's work
      // is independent, and the next run retries whatever this one could not finish.
      errorCount += 1;
    }
  }

  /**
   * The retention sweep, last and in its own try/catch.
   *
   * It rides on this job because it needs no scheduler of its own: four tables whose oldest
   * rows are meaningless, swept by something that already runs every five minutes. Last,
   * because expiring a hold is the job's actual duty and deleting month-old rows must never
   * delay it. Caught separately, because a failure here is untidiness — nothing a participant
   * or an organizer would notice — and it must not mark the whole run as failed.
   */
  let prunedRows = 0;
  try {
    prunedRows = totalPruned(await pruneExpiredRows(db, now));
  } catch {
    errorCount += 1;
  }

  await finishJobRun(
    db,
    jobRunId,
    { itemsProcessed: eventIds.length + lapsedEmailConfirmations + prunedRows, errorCount },
    new Date(),
  );

  return { eventsProcessed: eventIds.length, errorCount, prunedRows };
}
