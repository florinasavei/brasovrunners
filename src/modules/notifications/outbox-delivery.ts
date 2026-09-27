import { and, count, desc, eq, isNotNull } from "drizzle-orm";
import { emailOutbox } from "@/db/schema/email-outbox";
import { jobRuns } from "@/db/schema/job-runs";
import type { Database } from "@/db/types";
import { readJobCadence } from "@/modules/jobs/cadence";
import { PINGER_CADENCE_MINUTES, pingerCadenceMinutes } from "@/modules/jobs/quiet-hours";
import { env } from "@/shared/config/env";
import { readDeliveryTiming } from "./delivery-timing";
import type { DeliveryTiming } from "./domain/delivery-timing";
import { emailWaitMinutes, nextOutboxTick } from "./domain/email-wait";

/**
 * What the queue holds and when it next leaves (§513): the figure `/api/health`'s `email` block
 * carries and the line «Următoarele emailuri automate» (§383) opens with. Under the scheduled
 * default a queue that waits for the cron is normal, so the count alone would read as a stall;
 * with the tick beside it, it reads as "leaves at 10:15".
 */
export type OutboxDelivery = {
  timing: DeliveryTiming;
  /** Rows waiting to be claimed (`PENDING`), whatever the reason — the tick, a retry, a deferral. */
  pending: number;
  /** The most a message queued now may wait, in minutes; null when the request itself sends it. */
  waitMinutes: number | null;
  /**
   * The most a message may wait under `scheduled`, by day and at night, whatever the timing now —
   * what the «Termene» setting's own words say before anybody picks it.
   */
  scheduledWait: { day: number; night: number };
  /** The pinger call at which the outbox job is next expected to run for real (an estimate). */
  nextTickAt: string;
};

/**
 * `governorFloorMinutes` is the budget governor's minimum interval in force now (§447), read once
 * by the caller for every check it makes, exactly as `checkEmailHealth` takes it.
 */
export async function readOutboxDelivery<T extends Record<string, unknown>>(
  db: Database<T>,
  now: Date,
  governorFloorMinutes = 0,
): Promise<OutboxDelivery> {
  const [{ timing }, { minutes: stated }, [queued], [lastRun]] = await Promise.all([
    readDeliveryTiming(db),
    readJobCadence(db),
    db.select({ pending: count() }).from(emailOutbox).where(eq(emailOutbox.status, "PENDING")),
    db
      .select({ finishedAt: jobRuns.finishedAt })
      .from(jobRuns)
      .where(and(eq(jobRuns.jobName, "email-outbox"), isNotNull(jobRuns.finishedAt)))
      .orderBy(desc(jobRuns.startedAt))
      .limit(1),
  ]);
  const pingerMinutes = pingerCadenceMinutes(now);
  const intervalMinutes = Math.max(stated, governorFloorMinutes);
  const scheduledAt = (pinger: number) =>
    emailWaitMinutes({ timing: "scheduled", pingerMinutes: pinger, intervalMinutes: stated, governorFloorMinutes }) ?? pinger;
  const day = env.PINGER_CADENCE_MINUTES;
  return {
    timing,
    pending: queued?.pending ?? 0,
    waitMinutes: emailWaitMinutes({ timing, pingerMinutes, intervalMinutes: stated, governorFloorMinutes }),
    scheduledWait: { day: scheduledAt(day), night: scheduledAt(Math.max(PINGER_CADENCE_MINUTES.night, day)) },
    nextTickAt: nextOutboxTick({ now, pingerMinutes, intervalMinutes, lastRunAt: lastRun?.finishedAt ?? null }).toISOString(),
  };
}
