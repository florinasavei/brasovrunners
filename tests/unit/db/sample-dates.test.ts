import { describe, expect, it } from "vitest";
import { atBrasov, nextWeekday, todayInBrasov } from "@/db/seeds/sample-dates";

/**
 * `DECISIONS.md` §162 — the sample events are dated from today: the seed must never carry a
 * calendar date that the calendar can walk past.
 */
describe("the sample events' dates", () => {
  const brasovHour = (date: Date) =>
    Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Bucharest", hour: "2-digit", hourCycle: "h23" }).format(date));
  const brasovWeekday = (date: Date) => new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Bucharest", weekday: "short" }).format(date);

  it("lands on the asked weekday, at the asked Brașov hour, at least the asked days ahead", () => {
    const today = todayInBrasov();
    for (const [weekday, name] of [[0, "Sun"], [3, "Wed"], [6, "Sat"]] as const) {
      const days = nextWeekday(weekday, 2);
      expect(days).toBeGreaterThanOrEqual(2);
      expect(days).toBeLessThan(9);
      const when = atBrasov(days, 8, 30);
      expect(brasovWeekday(when)).toBe(name);
      expect(brasovHour(when)).toBe(8);
      expect(when.getTime()).toBeGreaterThan(today.getTime());
    }
  });

  it("keeps the Brașov hour across the clock change", () => {
    // Whatever today is, 200 days ahead is on the other side of at least one DST switch.
    expect(brasovHour(atBrasov(200, 18))).toBe(18);
    expect(brasovHour(atBrasov(-200, 7))).toBe(7);
  });
});
