import { describe, expect, it } from "vitest";
import type { PublicEvent } from "@/modules/events/repository";
import type { CalendarImageData, CalendarImageEntry } from "@/modules/events/domain/calendar-image";
import { calendarImageRows } from "@/modules/events/domain/calendar-image-rows";
import { fitText, paletteFor, posterPlan, weekdayColumn, wrapText, wrapWhole } from "@/modules/events/ui/calendar-image-draw";

/**
 * «Salvează ca imagine» (§855; the owner, 2026-10-27): the month as a picture, drawn in the browser. The pure
 * halves: which day each date falls on and what repeats, and the words cut to the room a cell gives them.
 */

/** A measure of ten units per character: a line of `width` holds `width / 10` characters. */
const ctx = { measureText: (text: string) => ({ width: [...text].length * 10 }) as TextMetrics };

function event(startsAt: string, title: string, overrides: Partial<PublicEvent> = {}): PublicEvent {
  return {
    startsAt: new Date(startsAt),
    timezone: "Europe/Bucharest",
    title,
    type: "GROUP_RUN",
    isSpecial: false,
    eventStatus: "SCHEDULED",
    timeToBeAnnounced: false,
    ...overrides,
  } as PublicEvent;
}

describe("the month's rows", () => {
  const rows = calendarImageRows(
    { year: 2026, month: 6 },
    [
      event("2026-06-08T15:30:00Z", "Happy Monday"),
      event("2026-06-01T15:30:00Z", "Happy Monday"),
      event("2026-06-05T15:00:00Z", "Girls only shake out run", { isSpecial: true }),
      // The club's day, not UTC's: 23:30 UTC on 30 June is 1 July in Brașov — next month's.
      event("2026-06-30T23:30:00Z", "Night run"),
      event("2026-07-02T15:00:00Z", "July"),
    ],
    () => "18:30",
  );

  it("puts each date on its day in the club's zone, soonest first, and leaves out the other months", () => {
    expect(rows.entries.map((entry) => [entry.day, entry.title])).toEqual([
      [1, "Happy Monday"],
      [5, "Girls only shake out run"],
      [8, "Happy Monday"],
    ]);
  });

  it("tells what repeats in the month from what stands alone", () => {
    expect(rows.series.map((members) => members.map((member) => member.title))).toEqual([["Happy Monday", "Happy Monday"]]);
    expect(rows.singles.map((member) => member.title)).toEqual(["Girls only shake out run"]);
  });

  it("says no hour for a date whose hour is to be announced, and marks a cancelled one", () => {
    const [entry] = calendarImageRows({ year: 2026, month: 6 }, [event("2026-06-03T09:00:00Z", "Tură", { timeToBeAnnounced: true, eventStatus: "CANCELLED" })], () => "12:00").entries;
    expect(entry).toMatchObject({ time: null, cancelled: true });
  });
});

describe("the words in a cell", () => {
  it("keeps what fits and cuts the rest with «…»", () => {
    expect(fitText(ctx, "Happy Monday", 200)).toBe("Happy Monday");
    expect(fitText(ctx, "Happy Monday", 60)).toBe("Happy…");
  });

  it("breaks a title at spaces, and the last line allowed says it was cut", () => {
    expect(wrapText(ctx, "Happy Monday with Brașov Runners", 130, 3)).toEqual(["Happy Monday", "with Brașov", "Runners"]);
    expect(wrapText(ctx, "Happy Monday with Brașov Runners", 130, 2)).toEqual(["Happy Monday", "with Brașov…"]);
    expect(wrapText(ctx, "Happy Monday with Brașov Runners", 130, 1)).toEqual(["Happy Monday…"]);
  });
});

describe("a title kept whole", () => {
  it("breaks at spaces and keeps a dash with the word before it", () => {
    expect(wrapWhole(ctx, "Happy Monday with Brașov Runners", 130)).toEqual(["Happy Monday", "with Brașov", "Runners"]);
    expect(wrapWhole(ctx, "Trail Marathon — briefing", 160)).toEqual(["Trail Marathon\u00a0—", "briefing"]);
  });

  it("says a word wider than the line does not fit, or splits it with «-» when asked", () => {
    expect(wrapWhole(ctx, "Reconnaissance run", 80)).toBeNull();
    expect(wrapWhole(ctx, "Reconnaissance run", 80, true)).toEqual(["Reconna-", "issance", "run"]);
  });
});

describe("«Afiș»: each series under its weekday", () => {
  const entry = (day: number, title: string, overrides: Partial<CalendarImageEntry> = {}): CalendarImageEntry => ({
    day,
    time: "19:30",
    title,
    tone: "weekly",
    type: "GROUP_RUN",
    special: false,
    cancelled: false,
    ...overrides,
  });
  const recurring = (title: string, type: CalendarImageEntry["type"] = "GROUP_RUN") => ({ title, sentence: `${title}, every week`, tone: "weekly" as const, type });
  // June 2026: the 1st is a Monday.
  const data = (entries: CalendarImageEntry[], rows: ReturnType<typeof recurring>[]) => ({ month: { year: 2026, month: 6 }, entries, recurring: rows }) as unknown as CalendarImageData;

  it("counts the columns from Monday", () => {
    expect([1, 3, 7, 30].map((day) => weekdayColumn({ year: 2026, month: 6 }, day))).toEqual([0, 2, 6, 1]);
  });

  it("puts a series in its weekday's head with the hour most of its dates keep, and its dates become marks", () => {
    const plan = posterPlan(
      data(
        [
          entry(1, "Happy Monday"),
          entry(3, "Hill run", { time: "19:00" }),
          entry(5, "Girls only", { tone: "special", special: true, time: "18:00" }),
          entry(8, "Happy Monday", { time: "20:00" }),
          entry(10, "Hill run", { time: "19:00", cancelled: true }),
          entry(15, "happy monday "),
          entry(17, "Hill run", { time: "19:00" }),
        ],
        [recurring("Happy Monday"), recurring("Hill run")],
      ),
    );
    expect(plan.lanes.map((lane) => [lane.title, lane.column, lane.time, lane.variant])).toEqual([
      ["Happy Monday", 0, "19:30", 0],
      ["Hill run", 2, "19:00", 0],
    ]);
    expect([...plan.marks.keys()]).toEqual([1, 3, 8, 10, 15, 17]);
    expect([...plan.dates.values()].flat().map((date) => date.title)).toEqual(["Girls only"]);
  });

  it("stacks two series of one weekday, the earlier first, and gives a series on two weekdays a look of its own", () => {
    const plan = posterPlan(
      data(
        [
          entry(2, "Track", { time: "18:30" }),
          entry(2, "Tempo", { time: "07:00" }),
          entry(9, "Track", { time: "18:30" }),
          entry(9, "Tempo", { time: "07:00" }),
          entry(9, "Intervals"),
          entry(11, "Intervals"),
        ],
        [recurring("Track"), recurring("Tempo"), recurring("Intervals")],
      ),
    );
    expect(plan.lanes.map((lane) => [lane.title, lane.column, lane.variant])).toEqual([
      ["Track", 1, 1],
      ["Tempo", 1, 0],
      ["Intervals", null, 2],
    ]);
  });

  it("writes a series' special edition in full, and keeps a series of another type apart", () => {
    const plan = posterPlan(
      data(
        [entry(1, "Happy Monday"), entry(8, "Happy Monday", { special: true, tone: "special" }), entry(15, "Happy Monday"), entry(6, "Happy Monday", { type: "HIKE" })],
        [recurring("Happy Monday")],
      ),
    );
    expect([...plan.marks.keys()]).toEqual([1, 15]);
    expect([...plan.dates.keys()]).toEqual([8, 6]);
  });
});

describe("«Sezonul lunii»", () => {
  it("draws each month in its season's palette", () => {
    expect([1, 3, 6, 9, 12].map((month) => paletteFor("season", month))).toEqual(["winter", "spring", "summer", "autumn", "winter"]);
    expect(paletteFor("dark", 6)).toBe("dark");
  });
});
