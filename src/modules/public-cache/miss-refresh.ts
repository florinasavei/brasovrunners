import { after } from "next/server";

/**
 * The background refresh of a red month's cache misses (§447).
 *
 * At red a public read that misses the data cache does not ask the database in the request
 * (`cache.ts`); it is answered from its last good copy, and the read is queued here to be refreshed
 * "at the next allowed moment": the queue is drained in one wave after the response, and at most
 * one wave runs per `everyMinutes` on this instance. One wave is one wake of the compute however
 * many reads it refreshes — Neon bills the time awake, not the queries — so a crawler walking a
 * thousand addresses costs one wake per interval, not a thousand.
 *
 * A write this instance made has already woken the compute, so it lets the next wave run at once
 * (`allowRefreshNow`): a change the club makes during a red month shows after the next page view
 * rather than after the interval.
 *
 * Per instance and in memory, like the breaker (`resilience/breaker.ts`): losing it on a cold start
 * costs one extra wave at worst.
 */

/** How many reads wait for the next wave at most; beyond it, a miss is simply not queued. */
export const MISS_REFRESH_MAX_PENDING = 200;

const pending = new Map<string, () => Promise<unknown>>();
let nextWaveAt = 0;

/**
 * Queue `refresh` under `key` (one entry per key: the newest wins), and start a wave after the
 * response when one is allowed now. Returns whether a wave was started.
 */
export function scheduleMissRefresh(key: string, refresh: () => Promise<unknown>, everyMinutes: number, now: number = Date.now()): boolean {
  if (pending.has(key) || pending.size < MISS_REFRESH_MAX_PENDING) pending.set(key, refresh);
  return startWave(everyMinutes, now);
}

/** Run everything queued in one wave after the response, when a wave is allowed now. */
function startWave(everyMinutes: number, now: number): boolean {
  if (now < nextWaveAt || pending.size === 0) return false;
  nextWaveAt = now + everyMinutes * 60_000;

  const wave = [...pending.values()];
  pending.clear();
  const run = async () => {
    for (const read of wave) {
      try {
        await read();
      } catch (error) {
        // A read that still cannot be made stays a miss; the next one queues it again.
        console.error("[public-cache] a background refresh failed", error);
      }
    }
  };
  try {
    after(run);
  } catch {
    // Outside a request (a test, a script) there is no `after()`: run it without waiting.
    void run();
  }
  return true;
}

/**
 * How long after a write on this instance a red month's miss is read in the request (§493): the
 * write woke the compute, which stays awake five minutes after its last query whatever anybody
 * does (Neon's fixed suspend), so a read inside this window costs at most the window itself — never
 * a wake — and the organizer who just cancelled an event and opens its page sees it cancelled,
 * rather than the copy taken before the save. Well under the five minutes, so the reads it allows
 * cannot keep the compute awake much past the write's own tail.
 */
export const READ_AFTER_WRITE_MS = 2 * 60_000;

let wokenByWriteAt = Number.NEGATIVE_INFINITY;

/** A write has woken the compute already: the next miss may start a wave at once, and read in the request for a moment. */
export function allowRefreshNow(now: number = Date.now()): void {
  nextWaveAt = 0;
  wokenByWriteAt = now;
}

/** Whether a write on this instance woke the compute within `READ_AFTER_WRITE_MS` (§493). */
export function computeAwakeFromWrite(now: number = Date.now()): boolean {
  return now - wokenByWriteAt < READ_AFTER_WRITE_MS;
}

/**
 * Start the wave the queue is waiting for, when one may run now — for a miss that is read in the
 * request anyway (`computeAwakeFromWrite`): the same wake carries whatever else was queued.
 */
export function flushMissRefreshes(everyMinutes: number, now: number = Date.now()): boolean {
  return startWave(everyMinutes, now);
}

/** For the tests: what is waiting, and a clean slate. */
export function pendingMissRefreshes(): number {
  return pending.size;
}

export function forgetMissRefreshes(): void {
  pending.clear();
  nextWaveAt = 0;
  wokenByWriteAt = Number.NEGATIVE_INFINITY;
}
