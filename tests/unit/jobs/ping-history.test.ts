import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * §657 — the outage grace reads the pings the data cache remembers since the maintenance's last real
 * run (`readPingHistory`). The quiet before a run can last a day (§577); reading every five-minute
 * slot of both jobs over it was some 650 cache reads in a hundred round trips on one run. The read is
 * bounded now — one job walked along its pinger's cadence, every slot only where a call is missing —
 * and must still find exactly the silences the full record shows.
 */
vi.mock("next/cache", async () => (await import("../../helpers/next-cache")).fakeNextCache.module);

const { fakeNextCache } = await import("../../helpers/next-cache");
const { readPingHistory, recordPing } = await import("@/modules/jobs/schedule-cache");
const { JOB_NAMES } = await import("@/modules/jobs/schedule");
const { isQuietHour } = await import("@/modules/jobs/quiet-hours");
const { findPingGaps } = await import("@/modules/registrations/domain/outage-grace");

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
// The maintenance's last real run, 04:02 in Brașov; this run a day later.
const ANCHOR = new Date("2026-10-02T01:02:00.000Z");
const NOW = new Date("2026-10-03T01:02:30.000Z");
const MAINTENANCE = "registration-maintenance" as const;

/** The pinger's calls in [from, until): at :02, :17, :32 and :47 by day, at :02 at night — as the monitors call. */
function calls(from: Date, until: Date, silent: { from: Date; until: Date } | null = null): Date[] {
  const out: Date[] = [];
  for (let at = from.getTime(); at < until.getTime(); at += 15 * MINUTE) {
    const instant = new Date(at);
    if (isQuietHour(instant) && instant.getUTCMinutes() !== 2) continue;
    if (silent && at >= silent.from.getTime() && at < silent.until.getTime()) continue;
    out.push(instant);
  }
  return out;
}

async function remember(job: (typeof JOB_NAMES)[number], instants: Date[]) {
  for (const at of instants) await recordPing(job, at, false);
}

/** The silences `findPingGaps` reads from what the run knows of each job: the pings, and the maintenance's anchor and this run. */
function gapsOf(byJob: Record<string, Date[]>) {
  return findPingGaps(
    JOB_NAMES.map((job) => [...(byJob[job] ?? []), ...(job === MAINTENANCE ? [ANCHOR, NOW] : [])]),
    15,
  );
}

beforeEach(() => fakeNextCache.reset());

describe("§657 the pings since the last real run, read bounded", () => {
  it("reads no silence after a quiet day, in a fraction of the slots", async () => {
    await recordPing(MAINTENANCE, ANCHOR, true);
    const all = calls(new Date(ANCHOR.getTime() + 15 * MINUTE), NOW);
    await remember(MAINTENANCE, all);
    await remember("email-outbox", all);
    fakeNextCache.counts.reads = 0;

    const found = await readPingHistory({ job: MAINTENANCE, at: ANCHOR }, NOW, 15);

    expect(found).not.toBeNull();
    expect(gapsOf(found ?? {})).toEqual([]);
    // Every slot of both jobs would be 2 × 288; the walk reads about one per call of one job, and the outbox's only
    // across the morning's change of cadence, where an hour without a call is longer than the day's threshold.
    expect(fakeNextCache.counts.reads).toBeLessThan(150);
  });

  it("finds exactly the silence the full record shows, 11:19 to 18:30 in Brașov, reading every slot only across it", async () => {
    const silent = { from: new Date("2026-10-02T08:19:00.000Z"), until: new Date("2026-10-02T15:30:00.000Z") };
    await recordPing(MAINTENANCE, ANCHOR, true);
    const heard = calls(new Date(ANCHOR.getTime() + 15 * MINUTE), NOW, silent);
    await remember(MAINTENANCE, heard);
    await remember("email-outbox", heard);
    fakeNextCache.counts.reads = 0;

    const found = await readPingHistory({ job: MAINTENANCE, at: ANCHOR }, NOW, 15);
    const expected = gapsOf({ [MAINTENANCE]: heard, "email-outbox": heard });

    expect(expected).toHaveLength(1);
    expect(expected[0].endedAt).toEqual(new Date("2026-10-02T15:32:00.000Z"));
    expect(gapsOf(found ?? {})).toEqual(expected);
    expect(fakeNextCache.counts.reads).toBeLessThan(2 * 288);
  });

  it("reads no silence where the outbox's calls went on through the maintenance's", async () => {
    const silent = { from: new Date("2026-10-02T08:19:00.000Z"), until: new Date("2026-10-02T15:30:00.000Z") };
    await recordPing(MAINTENANCE, ANCHOR, true);
    await remember(MAINTENANCE, calls(new Date(ANCHOR.getTime() + 15 * MINUTE), NOW, silent));
    await remember("email-outbox", calls(new Date(ANCHOR.getTime() + 15 * MINUTE), NOW));

    const found = await readPingHistory({ job: MAINTENANCE, at: ANCHOR }, NOW, 15);

    expect(gapsOf(found ?? {})).toEqual([]);
  });

  it("finds a silence that runs to this run, and one at night", async () => {
    await recordPing(MAINTENANCE, ANCHOR, true);
    // Nothing from 23:02 to 03:02 in Brașov, and nothing after 22:47 the next evening.
    const night = { from: new Date("2026-10-02T20:02:00.000Z"), until: new Date("2026-10-03T00:02:00.000Z") };
    const heard = calls(new Date(ANCHOR.getTime() + 15 * MINUTE), new Date(NOW.getTime() - 2 * HOUR), night);
    await remember(MAINTENANCE, heard);
    await remember("email-outbox", heard);

    const found = await readPingHistory({ job: MAINTENANCE, at: ANCHOR }, NOW, 15);
    const expected = gapsOf({ [MAINTENANCE]: heard, "email-outbox": heard });

    expect(expected.length).toBeGreaterThan(0);
    expect(gapsOf(found ?? {})).toEqual(expected);
  });

  it("reads nothing from a cache that has forgotten the last run's own ping", async () => {
    await remember(MAINTENANCE, calls(new Date(ANCHOR.getTime() + 15 * MINUTE), NOW));
    expect(await readPingHistory({ job: MAINTENANCE, at: ANCHOR }, NOW, 15)).toBeNull();
  });
});
