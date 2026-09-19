import { describe, expect, it } from "vitest";
import { clubHour, isQuietHour, jobStalenessThresholdMs } from "@/modules/jobs/quiet-hours";

/**
 * AGENTS.md §16.2, `DECISIONS.md` §68: the site may be slower at night, Brașov time, and the
 * health check measures each job against the cadence in force at that hour.
 */
describe("quiet hours, club time", () => {
  it("reads the hour in Bucharest, through daylight saving", () => {
    // Summer: UTC+3. 20:30Z is 23:30 in Brașov.
    expect(clubHour(new Date("2026-07-01T20:30:00.000Z"))).toBe(23);
    // Winter: UTC+2. 21:30Z is 23:30.
    expect(clubHour(new Date("2026-12-01T21:30:00.000Z"))).toBe(23);
    expect(clubHour(new Date("2026-12-01T05:00:00.000Z"))).toBe(7);
  });

  it("is quiet from 23:00 up to 07:00 and loud otherwise", () => {
    expect(isQuietHour(new Date("2026-07-01T20:00:00.000Z"))).toBe(true); // 23:00
    expect(isQuietHour(new Date("2026-07-01T03:59:00.000Z"))).toBe(true); // 06:59
    expect(isQuietHour(new Date("2026-07-01T04:00:00.000Z"))).toBe(false); // 07:00
    expect(isQuietHour(new Date("2026-07-01T19:59:00.000Z"))).toBe(false); // 22:59
  });

  it("allows an hourly monitor at night and a fifteen-minute one by day", () => {
    expect(jobStalenessThresholdMs(new Date("2026-07-01T10:00:00.000Z"), 15)).toBe(35 * 60_000);
    expect(jobStalenessThresholdMs(new Date("2026-07-01T00:00:00.000Z"), 15)).toBe(125 * 60_000);
  });

  // `DECISIONS.md` §148: QA is pinged hourly by day too, and says so through PINGER_CADENCE_MINUTES.
  it("measures a deployment against its own day cadence, never below hourly at night", () => {
    expect(jobStalenessThresholdMs(new Date("2026-07-01T10:00:00.000Z"), 60)).toBe(125 * 60_000);
    expect(jobStalenessThresholdMs(new Date("2026-07-01T00:00:00.000Z"), 60)).toBe(125 * 60_000);
    expect(jobStalenessThresholdMs(new Date("2026-07-01T00:00:00.000Z"), 120)).toBe(245 * 60_000);
    // The default is production's fifteen.
    expect(jobStalenessThresholdMs(new Date("2026-07-01T10:00:00.000Z"))).toBe(35 * 60_000);
  });
});
