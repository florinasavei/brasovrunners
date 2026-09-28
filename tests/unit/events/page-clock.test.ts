import { describe, expect, it } from "vitest";
import { eventClockInstants, nextWallMidnight } from "@/modules/events/domain/page-clock";

/**
 * §NNN (amending §333) — the instants at which a page that shows an event reads differently, so
 * a static page is kept until the first of them and no longer.
 */
const iso = (dates: Date[]) => dates.map((date) => date.toISOString()).sort();

describe("eventClockInstants", () => {
  it("names the start, the end, the registration window, the weather window and the confirmation window", () => {
    const instants = eventClockInstants({
      startsAt: new Date("2026-11-21T07:00:00.000Z"),
      endsAt: new Date("2026-11-21T11:00:00.000Z"),
      raceStartsAt: null,
      registrationOpensAt: new Date("2026-10-01T06:00:00.000Z"),
      registrationClosesAt: new Date("2026-11-19T20:00:00.000Z"),
      confirmationOpensDaysBefore: 7,
      confirmationDeadlineDaysBefore: 2,
    });
    expect(iso(instants)).toEqual(
      iso([
        new Date("2026-10-01T06:00:00.000Z"), // registration opens
        new Date("2026-11-19T20:00:00.000Z"), // registration closes
        new Date("2026-11-21T07:00:00.000Z"), // the start
        new Date("2026-11-21T11:00:00.000Z"), // the end
        new Date("2026-11-14T07:00:00.000Z"), // the forecast's seven days (§402) and the confirmation window's opening (§104)
        new Date("2026-11-14T07:00:00.000Z"),
        new Date("2026-11-19T07:00:00.000Z"), // the confirmation deadline
      ]),
    );
  });

  it("reads the weather window from the race's own start when it has one", () => {
    const instants = iso(eventClockInstants({ startsAt: new Date("2026-11-21T07:00:00.000Z"), raceStartsAt: new Date("2026-11-21T08:00:00.000Z") }));
    expect(instants).toContain("2026-11-14T08:00:00.000Z");
  });

  it("adds the public list's end when the club's deadlines are given (§421)", () => {
    const instants = iso(eventClockInstants({ startsAt: new Date("2026-11-21T07:00:00.000Z"), endsAt: null }, { publicListDays: 30 }));
    expect(instants).toContain("2026-12-21T07:00:00.000Z");
  });

  it("names only the registration window for an event whose date is to be announced (§533)", () => {
    const instants = eventClockInstants({ startsAt: null, registrationOpensAt: new Date("2026-10-01T06:00:00.000Z"), registrationClosesAt: null });
    expect(iso(instants)).toEqual(["2026-10-01T06:00:00.000Z"]);
  });
});

describe("nextWallMidnight", () => {
  it("is the next midnight on Brașov's clock, not the server's", () => {
    // 22:30 UTC on 20 November is 00:30 on the 21st in Bucharest (UTC+2): the next midnight is the 22nd's.
    expect(nextWallMidnight(new Date("2026-11-20T22:30:00.000Z"), "Europe/Bucharest").toISOString()).toBe("2026-11-21T22:00:00.000Z");
    expect(nextWallMidnight(new Date("2026-11-20T10:00:00.000Z"), "Europe/Bucharest").toISOString()).toBe("2026-11-20T22:00:00.000Z");
  });

  it("follows the clock change: the night summer time ends is still one midnight", () => {
    // 24 October 2026, noon in Bucharest (UTC+3); the clocks go back on the 25th at 04:00.
    expect(nextWallMidnight(new Date("2026-10-24T09:00:00.000Z"), "Europe/Bucharest").toISOString()).toBe("2026-10-24T21:00:00.000Z");
    expect(nextWallMidnight(new Date("2026-10-25T09:00:00.000Z"), "Europe/Bucharest").toISOString()).toBe("2026-10-25T22:00:00.000Z");
  });
});
