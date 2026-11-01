import { afterEach, describe, expect, it, vi } from "vitest";
import { addDays, ahead, birthOn, dayLine, dmy, nextMonthDay, todayInBrasov, weeksShift } from "../../e2e/support/dates";

/**
 * BR-REQ-050-02 — the e2e specs that type an event's date no longer hold a day the calendar reaches
 * (§NNN): `ahead` moves a written date by whole weeks so it is always months ahead, with the same
 * weekday and the same gaps to the other dates of the suite.
 */

const weekday = (iso: string) => new Date(`${iso}T00:00:00Z`).getUTCDay();
const days = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / 86_400_000;

describe("BR-REQ-050-02 dates that stay ahead of the calendar", () => {
  const todays = ["2026-11-01", "2027-04-14", "2027-04-15", "2028-02-29", "2031-12-31", "2040-06-15"];

  it("moves every written date a whole number of weeks, so the weekday and the gaps stay", () => {
    for (const today of todays) {
      const now = new Date(`${today}T12:00:00Z`);
      const shift = weeksShift(now);
      for (const written of ["2027-04-14", "2027-05-04", "2027-05-01", "2027-11-17"]) {
        const moved = ahead(written, now);
        expect(days(written, moved)).toBe(7 * shift);
        expect(weekday(moved)).toBe(weekday(written));
      }
      expect(days(ahead("2027-05-01", now), ahead("2027-05-04", now))).toBe(3);
      expect(ahead("2027-05-02", now)).toBe(ahead("2027-05-02", now));
    }
  });

  it("puts the earliest written date at least 24 weeks ahead of today in Brașov, and not a week more than that", () => {
    for (const today of todays) {
      const now = new Date(`${today}T12:00:00Z`);
      const lead = days(todayInBrasov(now), ahead("2027-04-14", now));
      expect(lead).toBeGreaterThanOrEqual(24 * 7);
      expect(lead).toBeLessThan(25 * 7);
    }
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("reads the shift once per process: a spec that crosses midnight, or a week, fills and asserts the same day", () => {
    const filled = ahead("2027-05-04");
    vi.useFakeTimers();
    vi.setSystemTime(new Date(Date.now() + 8 * 86_400_000));
    expect(ahead("2027-05-04")).toBe(filled);
  });

  it("leaves the dates alone while they are still far enough ahead", () => {
    expect(weeksShift(new Date("2026-10-01T12:00:00Z"))).toBe(0);
    expect(ahead("2027-05-04", new Date("2026-10-01T12:00:00Z"))).toBe("2027-05-04");
  });

  it("reads today on the club's clock, not UTC's", () => {
    expect(todayInBrasov(new Date("2026-11-01T22:30:00Z"))).toBe("2026-11-02");
  });

  it("finds the next 17 November at least twelve weeks ahead", () => {
    expect(nextMonthDay(11, 17, 12, new Date("2026-11-01T12:00:00Z"))).toBe("2027-11-17");
    expect(nextMonthDay(6, 16, 12, new Date("2026-11-01T12:00:00Z"))).toBe("2027-06-16");
    expect(nextMonthDay(11, 17, 12, new Date("2027-11-10T12:00:00Z"))).toBe("2028-11-17");
  });

  it("makes someone exactly the age asked on the run's day", () => {
    for (const run of ["2027-04-14", "2028-02-28", "2029-03-01", "2031-12-31"]) {
      for (const [age, until] of [[13, 1], [36, 20], [17, 1], [40, 100]] as const) {
        const born = birthOn(run, age, until);
        let years = Number(run.slice(0, 4)) - Number(born.slice(0, 4));
        if (run.slice(5) < born.slice(5)) years -= 1;
        expect(years).toBe(age);
      }
    }
  });

  it("writes a date the way the typed boxes do", () => {
    expect(dmy("1990-05-11")).toBe("11.05.1990");
    expect(dayLine("1990-05-11", "ro")).toBe("Vineri, 11 mai 1990");
    expect(dayLine("1990-05-11", "en")).toBe("Friday, 11 May 1990");
    expect(addDays("2027-02-28", 1)).toBe("2027-03-01");
  });
});
