import { AsyncLocalStorage } from "node:async_hooks";
import { revalidateTag, unstable_cache } from "next/cache";
import {
  type DueSlot,
  type FloorSlot,
  JOB_NAMES,
  type JobName,
  MAX_QUIET_MINUTES,
  type PingSlot,
  type PingVerdict,
  type QuietPlan,
  decidePing,
  slotStart,
  slotsBack,
  slotsBetween,
} from "./schedule";

/**
 * Where a job's "nothing due until" lives between two serverless invocations without the
 * database: Next's data cache (§NNN). No new service — no Redis, no KV, no Edge Config — and on
 * Vercel the cache is the platform's own, shared by every function of the deployment's
 * environment and kept across deployments until invalidated or evicted. On `next start` it is
 * the build's file cache. Evicted or empty, a slot reads as missing and the ping runs for real:
 * losing the cache costs a query, never a job.
 *
 * ## Why slots, and why write-once
 *
 * `unstable_cache` is a memo, not a store: a key holds whatever its function returned the first
 * time, until a tag invalidates it. It cannot be overwritten in the request that wants to —
 * invalidating and re-reading inside one request writes an entry that the invalidation, flushed
 * when the request ends, then marks expired. So nothing here is ever overwritten. Each value is
 * written once under a key that carries the five minutes it is for (`slotStart`): a real run
 * writes one "nothing due until" slot per five minutes of its quiet, a ping reads the one slot
 * its own minute falls in, and a later run simply writes later slots. `wakeJobs` invalidates a
 * job's slots by tag when a write path makes work sooner than they promised.
 *
 * ## Reading without writing
 *
 * A memo's miss runs its function and stores the result, which would let a *reader* fill a slot
 * with "nothing here" before the run that owns it arrives. So the function is bound per call to
 * the value to store: a writer's returns it, a reader's throws `NotRecorded`, and a throw stores
 * nothing. Both have the same text and the same key parts, so they address the same entry — the
 * key is the function's source plus the key parts, never what it was bound to.
 *
 * ## What is safe to lose
 *
 * Everything. Outside a request (a script, a test without the fake) every call throws and is
 * read as missing; a `revalidatePath` of a page adds that page's implicit tag to what its own
 * reads check, so a slot written before it reads as missing *on that page* until the next run
 * writes fresh ones (the task board therefore falls back to the database, `jobs/ui`). Missing
 * always means "run": the conservative answer.
 *
 * ## A wake that races a run
 *
 * "Every write path that makes work sooner invalidates the promise" is true of the promises that
 * already exist, not of one being written at the same moment. A real run reads the database for
 * its plan (`nextWork`), then writes the slots, which land when its request ends. A write path
 * that commits after that read and whose `revalidateTag` is applied before those slots land
 * invalidates the *old* slots and not the new ones — and the new ones were computed without its
 * work, so they keep promising the old quiet. Nothing re-checks: a per-job "woken at" marker the
 * run could read before writing would be one more write-once slot with the same flush-at-request-
 * end timing, and so the same race one step later.
 *
 * It is left as it is because it is bounded and safe. Bounded by the plan itself — the cap, an
 * hour, or the Administrator's longer interval — after which a real run finds the work anyway;
 * safe because nothing the job does is what keeps a place right (AGENTS.md §10.6: a lapsed hold
 * or offer is lapsed on every read). The window is the few hundred milliseconds between a run's
 * `nextWork` query and the end of its request, so what it costs in practice is a message or a
 * hand-over that goes at the next real run rather than the next ping.
 */

const TAG = "br-jobs";
const dueTag = (job: JobName) => `${TAG}:due:${job}`;
const FLOOR_TAG = `${TAG}:floor`;
const PING_TAG = `${TAG}:ping`;

class NotRecorded extends Error {}

type Family = "due" | "floor" | "ping";

/** A writer's value, or a reader's refusal to invent one. Always called bound, never directly. */
async function produce(value: unknown): Promise<unknown> {
  if (value === undefined) throw new NotRecorded();
  return value;
}

async function slot<T>(family: Family, job: JobName, at: Date, tags: string[], write?: T): Promise<T | null> {
  try {
    /*
      Bound, and that is load-bearing. `unstable_cache` keys an entry on its function's *source
      text* plus the key parts, and the same arrow function compiles to different text in a route
      handler's bundle and in a page's — minified names differ — so a slot a job wrote was
      invisible to `/devs` (measured on a production build). A bound function's text is the
      engine's own `function () { [native code] }` in every bundle, and a bound argument is not
      part of the key, so writer and reader address the one entry the key parts name.
    */
    return (await unstable_cache(produce.bind(null, write), [TAG, family, job, slotStart(at).toISOString()], {
      tags,
      revalidate: false,
    })()) as T;
  } catch {
    // `NotRecorded` is the ordinary miss; anything else — no request scope, a cache that is
    // unreachable — is the same answer for the same reason: missing means the ping runs.
    return null;
  }
}

const dueTags = (job: JobName) => [TAG, dueTag(job)];
const floorTags = [TAG, FLOOR_TAG];
const pingTags = [PING_TAG];

/** The run's own job, while it runs: its own writes are covered by the plan it computes after them. */
const running = new AsyncLocalStorage<JobName>();

/** Run `work` as `job`'s real run, so the write paths it calls do not forget the slots it is about to write. */
export function insideJobRun<T>(job: JobName, work: () => Promise<T>): Promise<T> {
  return running.run(job, work);
}

/**
 * "This change may have given a job something to do sooner than it expects" — the one call every
 * write path makes (§NNN), after its transaction, from the service layer.
 *
 * `dueAt` is the earliest instant the change can matter (`maintenanceDueFor`). Work due further
 * away than the longest quiet any run can promise (`MAX_QUIET_MINUTES`) needs no invalidation:
 * a real run happens before it is due and finds it. Anything sooner — or a caller that does not
 * know — forgets the job's cached quiet, so the next ping runs for real.
 *
 * Never throws and never waits: `revalidateTag` is queued and applied when the request ends,
 * after the transaction has committed; outside a request it is simply not there. A call this
 * misses, a call site nobody wrote, or a call that races a run's own slot writes (see "A wake
 * that races a run" above) costs at most the cap — an hour — never the work itself.
 */
export function wakeJobs(jobs: JobName | readonly JobName[], dueAt?: Date | null, now: Date = new Date()): void {
  if (dueAt && dueAt.getTime() - now.getTime() >= MAX_QUIET_MINUTES * 60_000) return;
  const self = running.getStore();
  for (const job of typeof jobs === "string" ? [jobs] : jobs) {
    if (job === self) continue;
    try {
      revalidateTag(dueTag(job), { expire: 0 });
    } catch {
      // Outside a request scope, or during a render: nothing to invalidate from here.
    }
  }
}

/**
 * The Administrator changed the minimum interval: every job's quiet was computed with the old
 * one, and every floor slot holds it. Both go, so the next ping of each job runs and plans anew.
 */
export function forgetJobSchedules(): void {
  wakeJobs(JOB_NAMES);
  try {
    revalidateTag(FLOOR_TAG, { expire: 0 });
  } catch {
    // As in `wakeJobs`.
  }
}

/** A ping's verdict, from the cache alone: two reads at most, no database. */
export async function readPingVerdict(job: JobName, now: Date): Promise<PingVerdict> {
  const due = await slot<DueSlot>("due", job, now, dueTags(job));
  const quiet = decidePing(now, due, null);
  if (!quiet.run) return quiet;
  const floor = await slot<FloorSlot>("floor", job, now, floorTags);
  return decidePing(now, null, floor);
}

/** That a ping arrived, and whether it ran — the first ping of each five minutes, for `/api/health`. */
export async function recordPing(job: JobName, now: Date, ran: boolean): Promise<void> {
  await slot<PingSlot>("ping", job, now, pingTags, { at: now.toISOString(), ran });
}

/**
 * Leave a real run's plan for the pings after it: one "nothing due until" slot for each five
 * minutes of quiet, one floor slot for each five minutes of the Administrator's interval, and
 * the ping itself. Writes are queued by Next and finished before the function is frozen.
 */
export async function recordRealRun(job: JobName, plan: QuietPlan): Promise<void> {
  const due: DueSlot = {
    quietUntil: plan.quietUntil.toISOString(),
    ranAt: plan.ranAt.toISOString(),
    cadenceMinutes: plan.cadenceMinutes,
  };
  const writes: Promise<unknown>[] = slotsBetween(plan.ranAt, plan.quietUntil).map((at) =>
    slot<DueSlot>("due", job, at, dueTags(job), due),
  );
  if (plan.floorUntil) {
    const floor: FloorSlot = {
      until: plan.floorUntil.toISOString(),
      ranAt: plan.ranAt.toISOString(),
      cadenceMinutes: plan.cadenceMinutes,
    };
    writes.push(...slotsBetween(plan.ranAt, plan.floorUntil).map((at) => slot<FloorSlot>("floor", job, at, floorTags, floor)));
  }
  writes.push(recordPing(job, plan.ranAt, true));
  await Promise.all(writes);
}

/**
 * The newest ping within `horizonMs`, from the cache — what `/api/health` measures the pinger
 * against now that a ping with nothing to do writes no `job_runs` row. Read newest first, six
 * slots at a time, and stopped at the first that answers: a pinger every fifteen minutes is
 * found in the first batch.
 */
export async function readLastPing(job: JobName, now: Date, horizonMs: number): Promise<PingSlot | null> {
  const slots = slotsBack(now, horizonMs);
  for (let index = 0; index < slots.length; index += 6) {
    const batch = await Promise.all(slots.slice(index, index + 6).map((at) => slot<PingSlot>("ping", job, at, pingTags)));
    const found = batch.filter((entry): entry is PingSlot => entry !== null && Date.parse(entry.at) <= now.getTime());
    if (found.length > 0) return found.reduce((a, b) => (Date.parse(a.at) >= Date.parse(b.at) ? a : b));
  }
  return null;
}

/** What `/devs` and the task board show for one job: the cached plan and the last ping, if the cache answers. */
export type JobCacheState = { verdict: PingVerdict; lastPing: PingSlot | null };

export async function readJobCacheState(job: JobName, now: Date, horizonMs: number): Promise<JobCacheState> {
  const [verdict, lastPing] = await Promise.all([readPingVerdict(job, now), readLastPing(job, now, horizonMs)]);
  return { verdict, lastPing };
}
