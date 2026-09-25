import { describe, expect, it } from "vitest";
import { followStartDate, localizedSchedule, programmeLines, readScheduleItems, shiftProgrammeDates, shiftScheduleItems } from "@/modules/events/domain/schedule";

/** BR-REQ-020-01 criterion 11 (`DECISIONS.md` §117) — the programme as data. */
const ZONE = "Europe/Bucharest";

const ROWS = [
  { startsAt: "2026-10-11T07:00:00.000Z", endsAt: null, label: { ro: "Start", en: "Start" }, place: null },
  { startsAt: "2026-10-10T13:00:00.000Z", endsAt: "2026-10-10T16:00:00.000Z", label: { ro: "Ridicarea kiturilor", en: "Kit pickup" }, place: "Cortul de start" },
  { startsAt: "2026-10-11T06:30:00.000Z", endsAt: null, label: { ro: "Briefing", en: "Briefing" }, place: null },
];

describe("the programme's rows", () => {
  it("reads the stored rows soonest first, and nothing from a shape that is not a row", () => {
    expect(readScheduleItems(ROWS).map((row) => row.label.en)).toEqual(["Kit pickup", "Briefing", "Start"]);
    expect(readScheduleItems(null)).toEqual([]);
    expect(readScheduleItems([{ startsAt: "yesterday", label: { ro: "x", en: "y" } }])).toEqual([]);
    expect(readScheduleItems("[]")).toEqual([]);
  });

  it("speaks one language at a time", () => {
    const rows = localizedSchedule(readScheduleItems(ROWS), "ro");
    expect(rows[0]).toEqual({ startsAt: new Date("2026-10-10T13:00:00.000Z"), endsAt: new Date("2026-10-10T16:00:00.000Z"), label: "Ridicarea kiturilor", place: "Cortul de start" });
    expect(localizedSchedule(readScheduleItems(ROWS), "en")[2].label).toBe("Start");
  });

  it("shifts on the wall clock, so a briefing at 09:30 stays at 09:30 across the clock change", () => {
    // 11 October 09:30 EEST → 8 November 09:30 EET is 27 hours short of four weeks of instants.
    const shifted = shiftScheduleItems(readScheduleItems(ROWS), ZONE, { days: 28 });
    expect(shifted.find((row) => row.label.en === "Briefing")?.startsAt).toBe("2026-11-08T07:30:00.000Z");
    // 19:00 EEST on 10 October is 16:00Z; 19:00 EET on 7 November is 17:00Z.
    expect(shifted.find((row) => row.label.en === "Kit pickup")?.endsAt).toBe("2026-11-07T17:00:00.000Z");
  });

  it("writes one line per row, with the day only when the programme spans days", () => {
    const rows = localizedSchedule(readScheduleItems(ROWS), "en");
    expect(programmeLines(rows, ZONE, "en")).toEqual([
      // The day in the short form with its weekday and year, then the time (§349).
      "Sat, 10 Oct 2026, 16:00–19:00 — Kit pickup (Cortul de start)",
      "Sun, 11 Oct 2026, 09:30 — Briefing",
      "Sun, 11 Oct 2026, 10:00 — Start",
    ]);
    expect(programmeLines(rows.slice(1), ZONE, "ro")).toEqual(["09:30 — Briefing", "10:00 — Start"]);
    expect(programmeLines([], ZONE, "ro")).toEqual([]);
  });
});

/**
 * BR-REQ-050-02 criterion 13 (`DECISIONS.md` §117) — the editor's rows follow the event's date:
 * the pure function behind the island, on the form's `YYYY-MM-DD` boxes.
 */
describe("the programme's rows follow the event's date", () => {
  const box = (date: string, label = "x") => ({ date, time: "09:30", endTime: "", ro: label, en: label, place: "" });

  it("moves every dated row by the same number of days, and touches nothing else on the row", () => {
    const rows = [box("2026-11-21", "Briefing"), box("2026-11-21", "Start")];
    expect(shiftProgrammeDates(rows, "2026-11-21", "2026-11-28")).toEqual([
      { date: "2026-11-28", time: "09:30", endTime: "", ro: "Briefing", en: "Briefing", place: "" },
      { date: "2026-11-28", time: "09:30", endTime: "", ro: "Start", en: "Start", place: "" },
    ]);
  });

  it("keeps a two-day programme two days: the day before the start stays the day before", () => {
    const rows = [box("2026-11-20", "Kit pickup"), box("2026-11-21", "Start"), box("2026-11-22", "Awards")];
    expect(shiftProgrammeDates(rows, "2026-11-21", "2026-11-14").map((row) => row.date)).toEqual(["2026-11-13", "2026-11-14", "2026-11-15"]);
  });

  it("leaves a row with no date alone, and a row whose box is not a date", () => {
    const rows = [box(""), box("2026-11-21"), box("2026-02-30"), box("tomorrow")];
    expect(shiftProgrammeDates(rows, "2026-11-21", "2026-11-22").map((row) => row.date)).toEqual(["", "2026-11-22", "2026-02-30", "tomorrow"]);
  });

  it("crosses a month, a year and a leap day by the calendar", () => {
    expect(shiftProgrammeDates([box("2026-10-31")], "2026-10-31", "2026-11-01")[0].date).toBe("2026-11-01");
    expect(shiftProgrammeDates([box("2026-12-31"), box("2027-01-01")], "2026-12-31", "2027-01-01").map((row) => row.date)).toEqual(["2027-01-01", "2027-01-02"]);
    expect(shiftProgrammeDates([box("2026-02-28")], "2026-02-28", "2028-02-28")[0].date).toBe("2028-02-28");
    expect(shiftProgrammeDates([box("2028-02-28")], "2028-02-27", "2028-02-28")[0].date).toBe("2028-02-29");
    // Across the clock change, a calendar day is a calendar day: no hour is lost or gained.
    expect(shiftProgrammeDates([box("2026-10-24")], "2026-10-24", "2026-10-26")[0].date).toBe("2026-10-26");
  });

  it("moves nothing for a delta of zero, and nothing when either anchor is not a date", () => {
    const rows = [box("2026-11-21"), box("")];
    expect(shiftProgrammeDates(rows, "2026-11-21", "2026-11-21")).toEqual(rows);
    expect(shiftProgrammeDates(rows, "", "2026-11-28")).toEqual(rows);
    expect(shiftProgrammeDates(rows, "2026-11-21", "")).toEqual(rows);
    expect(shiftProgrammeDates(rows, "2026-11-21", "2026-13-01")).toEqual(rows);
  });

  it("reads a year as typed, so a chain of moves through a half-typed year ends where the last one says", () => {
    // A date box reads "0002-11-21" while "2027" is being typed over "2026"; the moves telescope.
    let rows = [box("2026-11-21"), box("2026-11-22")];
    let from = "2026-11-21";
    for (const to of ["0002-11-21", "0020-11-21", "0202-11-21", "2027-11-21"]) {
      rows = shiftProgrammeDates(rows, from, to);
      from = to;
    }
    expect(rows.map((row) => row.date)).toEqual(["2027-11-21", "2027-11-22"]);
  });

  it("never reads the clock: the same input gives the same answer", () => {
    const rows = [box("2026-11-21")];
    expect(shiftProgrammeDates(rows, "2026-11-21", "2026-12-05")).toEqual(shiftProgrammeDates(rows, "2026-11-21", "2026-12-05"));
  });
});

/**
 * BR-REQ-050-02 criterion 13 (§117, §NNN): the editor's default day for a row is the event's start
 * date — the spare line with no date yet takes it when the start is typed or moved, and the dated
 * rows move by the same number of days as before.
 */
describe("the programme's default day is the event's start date", () => {
  const box = (date: string, label = "") => ({ date, time: "", endTime: "", ro: label, en: label, place: "" });

  it("gives a row with no date the start date the moment one is typed, on the create page", () => {
    expect(followStartDate([box("")], "", "2027-05-10")).toEqual([box("2027-05-10")]);
  });

  it("moves the dated rows and dates the undated ones in the same move", () => {
    const rows = [box("2027-05-09", "Kit pickup"), box("2027-05-10", "Start"), box("", "Awards")];
    expect(followStartDate(rows, "2027-05-10", "2027-05-12").map((row) => row.date)).toEqual(["2027-05-11", "2027-05-12", "2027-05-12"]);
  });

  it("empties nothing while the start box is being retyped, and leaves a box that is not a date alone", () => {
    const rows = [box("2027-05-10"), box(""), box("tomorrow")];
    expect(followStartDate(rows, "2027-05-10", "")).toEqual(rows);
    expect(followStartDate(rows, "2027-05-10", "2027-13-01")).toEqual(rows);
    expect(followStartDate(rows, "2027-05-10", "2027-05-11").map((row) => row.date)).toEqual(["2027-05-11", "2027-05-11", "tomorrow"]);
  });

  it("dates the spare line through a half-typed year and still lands on the last date typed", () => {
    let rows = [box("")];
    let from = "";
    for (const to of ["0002-11-21", "0020-11-21", "0202-11-21", "2027-11-21"]) {
      rows = followStartDate(rows, from, to);
      from = to;
    }
    expect(rows.map((row) => row.date)).toEqual(["2027-11-21"]);
  });
});
