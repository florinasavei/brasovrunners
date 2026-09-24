import type { Database } from "@/db/types";
import { jobStalenessThresholdMs } from "./quiet-hours";
import { nextWork } from "./next-work";
import { type JobCadenceMinutes, type JobName, planQuiet, SLOT_MINUTES } from "./schedule";
import { readJobCacheState } from "./schedule-cache";

/**
 * What the task board's throttle card and `/devs` print for one job (§334): the last real run,
 * when the next real one will happen at the latest, and the last ping and whether it ran.
 *
 * The next real check is read from the cache — it is what the pings will actually do. When the
 * cache does not answer on this page it is worked out again from the database the page already
 * has open: the last run's plan, recomputed with what is waiting now. That is not a second
 * opinion; it covers a page whose own `revalidatePath` makes the cache's older slots read as
 * missing *here* (`schedule-cache.ts`), which would otherwise tell the owner "at the next ping"
 * while the pings go on answering from the cache.
 */
export type JobOverview = {
  job: JobName;
  lastRealRunAt: Date | null;
  /** Null: the next ping runs for real. */
  nextCheckAt: Date | null;
  /** Why the pings wait until then: work that is due, or the Administrator's minimum interval. */
  waitingFor: "nothing-due" | "cadence" | null;
  source: "cache" | "database";
  lastPingAt: Date | null;
  lastPingRan: boolean | null;
};

export async function describeJob<T extends Record<string, unknown>>(
  db: Database<T>,
  input: { job: JobName; now: Date; cadenceMinutes: JobCadenceMinutes; lastFinishedAt: string | null },
): Promise<JobOverview> {
  const { job, now, cadenceMinutes } = input;
  const lastRealRunAt = input.lastFinishedAt ? new Date(input.lastFinishedAt) : null;
  const cache = await readJobCacheState(job, now, jobStalenessThresholdMs(now) + SLOT_MINUTES * 60_000);
  const lastPingAt = cache.lastPing ? new Date(cache.lastPing.at) : null;
  const base = { job, lastRealRunAt, lastPingAt, lastPingRan: cache.lastPing ? cache.lastPing.ran : null };

  if (!cache.verdict.run) {
    return { ...base, nextCheckAt: cache.verdict.until, waitingFor: cache.verdict.reason, source: "cache" };
  }
  if (!lastRealRunAt) return { ...base, nextCheckAt: null, waitingFor: null, source: "database" };

  const plan = planQuiet({ ranAt: lastRealRunAt, nextWorkAt: await nextWork(db, job, now), cadenceMinutes, failed: false });
  const floor = plan.floorUntil && plan.floorUntil > plan.quietUntil ? plan.floorUntil : null;
  const nextCheckAt = floor ?? plan.quietUntil;
  return nextCheckAt.getTime() > now.getTime()
    ? { ...base, nextCheckAt, waitingFor: floor ? "cadence" : "nothing-due", source: "database" }
    : { ...base, nextCheckAt: null, waitingFor: null, source: "database" };
}
