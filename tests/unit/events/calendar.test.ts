import { describe, expect, it } from "vitest";
import {
  currentMonth,
  dayKey,
  groupByDay,
  monthGrid,
  monthParam,
  monthRange,
  parseMonth,
  shiftMonth,
} from "@/modules/events/domain/calendar";

const TZ = "Europe/Bucharest";

/** `DECISIONS.md` §89 — the month view is wall-clock arithmetic in the club's zone. */
describe("the events calendar", () => {
  it("reads the month from the URL, and falls back to the current one", () => {
    const now = new Date("2026-09-18T10:00:00Z");
    expect(parseMonth("2026-10", now, TZ)).toEqual({ year: 2026, month: 10 });
    expect(parseMonth(undefined, now, TZ)).toEqual({ year: 2026, month: 9 });
    expect(parseMonth("2026-13", now, TZ)).toEqual({ year: 2026, month: 9 });
    expect(parseMonth("garbage", now, TZ)).toEqual({ year: 2026, month: 9 });
    // Two years either way and no further.
    expect(parseMonth("2030-01", now, TZ)).toEqual({ year: 2026, month: 9 });
    expect(parseMonth(["2026-11", "2026-12"], now, TZ)).toEqual({ year: 2026, month: 11 });
  });

  it("knows the month in Brașov, not in UTC", () => {
    // 22:30 UTC on 30 September is 01:30 on 1 October in Bucharest (UTC+3).
    expect(currentMonth(new Date("2026-09-30T22:30:00Z"), TZ)).toEqual({ year: 2026, month: 10 });
    expect(dayKey(new Date("2026-09-30T22:30:00Z"), TZ)).toBe("2026-10-01");
  });

  it("spans the month from local midnight to local midnight", () => {
    const { from, to } = monthRange({ year: 2026, month: 10 }, TZ);
    expect(from.toISOString()).toBe("2026-09-30T21:00:00.000Z"); // 1 Oct 00:00 EEST
    expect(to.toISOString()).toBe("2026-10-31T22:00:00.000Z"); // 1 Nov 00:00 EET, after the clocks go back
  });

  it("shifts and formats months across a year boundary", () => {
    expect(shiftMonth({ year: 2026, month: 12 }, 1)).toEqual({ year: 2027, month: 1 });
    expect(shiftMonth({ year: 2026, month: 1 }, -1)).toEqual({ year: 2025, month: 12 });
    expect(monthParam({ year: 2026, month: 3 })).toBe("2026-03");
  });

  it("lays the grid out Monday first, padded to full weeks", () => {
    // October 2026 starts on a Thursday and ends on a Saturday.
    const weeks = monthGrid({ year: 2026, month: 10 });
    expect(weeks).toHaveLength(5);
    expect(weeks[0].map((d) => d.key)).toEqual([
      "2026-09-28",
      "2026-09-29",
      "2026-09-30",
      "2026-10-01",
      "2026-10-02",
      "2026-10-03",
      "2026-10-04",
    ]);
    expect(weeks[0].slice(0, 3).every((d) => !d.inMonth)).toBe(true);
    expect(weeks[4][5]).toEqual({ key: "2026-10-31", day: 31, inMonth: true });
    expect(weeks[4][6].inMonth).toBe(false);
    // February 2027 starts on a Monday and has exactly four weeks.
    expect(monthGrid({ year: 2027, month: 2 })).toHaveLength(4);
  });

  it("groups events by the day they start, keeping their order", () => {
    const monday = { startsAt: new Date("2026-10-05T16:00:00Z"), timezone: TZ, title: "Mon" };
    const mondayLater = { startsAt: new Date("2026-10-05T17:30:00Z"), timezone: TZ, title: "Mon 2" };
    const wednesday = { startsAt: new Date("2026-10-07T16:00:00Z"), timezone: TZ, title: "Wed" };
    const grouped = groupByDay([monday, mondayLater, wednesday]);
    expect([...grouped.keys()]).toEqual(["2026-10-05", "2026-10-07"]);
    expect(grouped.get("2026-10-05")?.map((e) => e.title)).toEqual(["Mon", "Mon 2"]);
  });
});
