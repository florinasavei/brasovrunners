import { describe, expect, it } from "vitest";
import { daysUntilOnWallClock, raceWeek } from "@/modules/events/domain/race-week";

/**
 * BR-REQ-011-01 criterion 12 — the countdown counts calendar days on the event's own clock,
 * not 24-hour spans on the server's (`DECISIONS.md` §78).
 */
describe("race week", () => {
  const TZ = "Europe/Bucharest";
  // Saturday 2026-09-26 07:00 in Brașov = 04:00 UTC.
  const race = { startsAt: new Date("2026-09-26T04:00:00Z"), timezone: TZ };

  it("counts dates in the event's zone, so Friday 23:59 in Brașov is still 'tomorrow'", () => {
    // 20:59 UTC Friday = 23:59 Brașov Friday.
    expect(daysUntilOnWallClock(race.startsAt, new Date("2026-09-25T20:59:00Z"), TZ)).toBe(1);
    // 21:30 UTC Friday = 00:30 Brașov Saturday: race day.
    expect(daysUntilOnWallClock(race.startsAt, new Date("2026-09-25T21:30:00Z"), TZ)).toBe(0);
    // A server reading UTC dates would have said 1 here; the wall clock says 0.
    expect(daysUntilOnWallClock(race.startsAt, new Date("2026-09-26T01:00:00Z"), TZ)).toBe(0);
    expect(daysUntilOnWallClock(race.startsAt, new Date("2026-09-23T10:00:00Z"), TZ)).toBe(3);
  });

  // The club's race week, unset (§377): seven days.
  const week = { raceWeekDays: 7 };

  it("is race week within seven calendar days and not before, and never once the event has started", () => {
    expect(raceWeek(race, new Date("2026-09-19T10:00:00Z"), week)).toEqual({ days: 7 });
    expect(raceWeek(race, new Date("2026-09-18T10:00:00Z"), week)).toBeNull();
    expect(raceWeek(race, new Date("2026-09-26T03:00:00Z"), week)).toEqual({ days: 0 });
    expect(raceWeek(race, new Date("2026-09-26T04:00:00Z"), week)).toBeNull();
    expect(raceWeek(race, new Date("2026-09-27T04:00:00Z"), week)).toBeNull();
  });

  it("follows the club's number of days (§377): ten days reach the eighth, zero is the race day alone", () => {
    expect(raceWeek(race, new Date("2026-09-18T10:00:00Z"), { raceWeekDays: 10 })).toEqual({ days: 8 });
    expect(raceWeek(race, new Date("2026-09-15T10:00:00Z"), { raceWeekDays: 10 })).toBeNull();
    expect(raceWeek(race, new Date("2026-09-25T10:00:00Z"), { raceWeekDays: 0 })).toBeNull();
    expect(raceWeek(race, new Date("2026-09-26T03:00:00Z"), { raceWeekDays: 0 })).toEqual({ days: 0 });
  });
});
