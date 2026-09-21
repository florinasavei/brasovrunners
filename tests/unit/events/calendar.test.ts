import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  currentMonth,
  dayKey,
  groupByDay,
  monthGrid,
  monthParam,
  groupByMonth,
  monthRange,
  parseMonth,
  parseYear,
  shiftMonth,
  yearRange,
  yearsAround,
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

  it("reads a year from the URL within two years either way, and offers those years (§116)", () => {
    const now = new Date("2026-09-18T10:00:00Z");
    expect(parseYear("2027", now, TZ)).toBe(2027);
    expect(parseYear("2024", now, TZ)).toBe(2024);
    expect(parseYear("2030", now, TZ)).toBeNull();
    expect(parseYear(undefined, now, TZ)).toBeNull();
    expect(parseYear("20x6", now, TZ)).toBeNull();
    expect(yearsAround(now, TZ)).toEqual([2024, 2025, 2026, 2027, 2028]);
    const { from, to } = yearRange(2026, TZ);
    expect(from.toISOString()).toBe("2025-12-31T22:00:00.000Z"); // 1 Jan 00:00 EET
    expect(to.toISOString()).toBe("2026-12-31T22:00:00.000Z"); // 1 Jan 2027 00:00 EET
    const byMonth = groupByMonth([
      { startsAt: new Date("2026-09-30T22:30:00Z"), timezone: TZ }, // 1 Oct in Brașov
      { startsAt: new Date("2026-09-13T04:00:00Z"), timezone: TZ },
    ]);
    expect([...byMonth.keys()]).toEqual(["2026-10", "2026-09"]);
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

/**
 * §261 — the tooltip is the month grid's, and nothing else's.
 *
 * A chip in a 40-pixel grid column shows glyphs and a time, so the tooltip is the only place
 * the title exists. An agenda row shows the whole sentence, and there the tooltip repeated the
 * line it was covering — on a tap, since `enterTouchDelay` is zero (the owner: "pe calendar
 * tooltipurile nu ar trebui să apară pe list view, sunt destul de enervante").
 *
 * Source assertion: the chip is a client island with no exported logic, and what is being
 * pinned is that the dense case keeps its tooltip while the agenda case returns before it.
 */
describe("§261 the calendar chip's tooltip", () => {
  const SOURCE = readFileSync(
    path.join(process.cwd(), "src/modules/events/ui/CalendarEventChip.tsx"),
    "utf8",
  );

  it("returns the bare link when the row is not dense", () => {
    expect(SOURCE).toContain("if (!dense) return chip;");
  });

  it("keeps one tooltip, after that return, for the grid", () => {
    const tooltips = SOURCE.match(/<Tooltip\b/g) ?? [];
    expect(tooltips).toHaveLength(1);
    expect(SOURCE.indexOf("<Tooltip")).toBeGreaterThan(SOURCE.indexOf("if (!dense) return chip;"));
  });

  it("names the whole sentence on the link itself, dense or not", () => {
    // Nothing is lost for a screen reader where the tooltip is gone.
    expect(SOURCE).toContain("aria-label={sentence}");
  });
});
