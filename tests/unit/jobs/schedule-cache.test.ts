import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * BR-REQ-090-03 criterion 9 (§NNN) — the two properties of the cache slots that nothing else
 * would catch until a production build did.
 *
 * `unstable_cache` keys an entry on its function's source text as well as the key parts. An
 * arrow function compiles to different text in a route handler's bundle and in a page's, so the
 * slots a job wrote were invisible to `/devs` until the function became a bound one, whose text
 * is the engine's own in every bundle. And a reader must never fill a slot: a miss that stored
 * "nothing here" would outlive the run that owns the slot.
 */
const seen = vi.hoisted(() => ({ sources: [] as string[] }));

vi.mock("next/cache", async () => {
  const { fakeNextCache } = await import("../../helpers/next-cache");
  return {
    ...fakeNextCache.module,
    unstable_cache: (callback: (...args: unknown[]) => Promise<unknown>, keyParts?: readonly string[], options?: object) => {
      seen.sources.push(callback.toString());
      return fakeNextCache.module.unstable_cache(callback, keyParts, options);
    },
  };
});

const { fakeNextCache } = await import("../../helpers/next-cache");
const { readLastPing, readPingVerdict, recordPing, recordRealRun } = await import("@/modules/jobs/schedule-cache");
const { planQuiet } = await import("@/modules/jobs/schedule");

const NOW = new Date("2026-10-01T10:00:00.000Z");

beforeEach(() => {
  fakeNextCache.reset();
  seen.sources.length = 0;
});

describe("BR-REQ-090-03 criterion 9 the cache slots", () => {
  it("key every slot on a function whose text is the same in every bundle", async () => {
    await recordPing("email-outbox", NOW, false);
    await readPingVerdict("email-outbox", NOW);
    expect(seen.sources.length).toBeGreaterThan(0);
    for (const source of seen.sources) expect(source).toMatch(/\[native code\]/);
  });

  it("never lets a reader fill a slot", async () => {
    expect(await readPingVerdict("registration-maintenance", NOW)).toEqual({ run: true });
    expect(await readLastPing("registration-maintenance", NOW, 30 * 60_000)).toBeNull();
    expect(fakeNextCache.entries.size).toBe(0);
    expect(fakeNextCache.counts.writes).toBe(0);
  });

  it("writes one slot per five minutes of a run's quiet, and the first ping of each five minutes", async () => {
    await recordRealRun("registration-maintenance", planQuiet({ ranAt: NOW, nextWorkAt: null, cadenceMinutes: 0, failed: false }));
    // Twelve five-minute slots in the hour, and the run's own ping.
    expect(fakeNextCache.entries.size).toBe(13);

    await recordPing("registration-maintenance", new Date(NOW.getTime() + 60_000), false);
    // Same five minutes: the run's ping stays the one on record.
    expect(fakeNextCache.entries.size).toBe(13);
    expect(await readLastPing("registration-maintenance", new Date(NOW.getTime() + 2 * 60_000), 30 * 60_000)).toEqual({
      at: NOW.toISOString(),
      ran: true,
    });
  });
});
