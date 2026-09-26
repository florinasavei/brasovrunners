import { describe, expect, it } from "vitest";
import { pickerDate, postedDate } from "@/shared/forms/pickers/picker-values";
import { DATE_PATTERN, DATE_VALUE, isDateValue, isTimeValue, normalizeTypedTime, TIME_PATTERN, TIME_VALUE } from "@/shared/forms/pickers/wall-values";

/**
 * The pickers' own value conversion (`shared/forms/pickers`, `DECISIONS.md` §345): what is
 * posted, both ways, and the two shapes of "not a value" — empty and malformed — that the boxes
 * agree on before and after a picker replaces the scriptless fallback.
 *
 * Pure functions, no DOM and no `PickerProvider`: the round trip through Day.js is what a wall
 * clock does, whatever zone the machine running the test happens to be in — which is the point
 * of building a date at noon and a time on a day with no daylight-saving gap (`picker-values.ts`'s
 * own doc comment).
 */

describe("picker-values — a posted date and the date picker's value, both ways", () => {
  it("round-trips an ordinary date", () => {
    const picked = pickerDate("2026-11-21");
    expect(picked).not.toBeNull();
    expect(postedDate(picked)).toBe("2026-11-21");
  });

  it("round-trips the last day of a month and of a year", () => {
    for (const value of ["2026-01-31", "2026-12-31", "2027-02-28", "2028-02-29"]) {
      expect(postedDate(pickerDate(value)), value).toBe(value);
    }
  });

  it("round-trips across the last Sunday of March — Bucharest's spring daylight-saving gap", () => {
    // 2026-03-29 is the day the clock jumps 03:00 to 04:00 in Bucharest; noon has no such gap,
    // which is why `pickerDate` builds on it rather than midnight.
    expect(postedDate(pickerDate("2026-03-29"))).toBe("2026-03-29");
    expect(postedDate(pickerDate("2026-03-30"))).toBe("2026-03-30");
  });

  it("reads a missing or empty date as no value", () => {
    expect(pickerDate(undefined)).toBeNull();
    expect(pickerDate(null)).toBeNull();
    expect(pickerDate("")).toBeNull();
  });

  it("refuses a date the calendar does not have, even though the pattern matches", () => {
    // 31 February passes `DATE_VALUE`'s digit shape; the calendar itself does not have it.
    expect(pickerDate("2026-02-31")).toBeNull();
    expect(pickerDate("2026-13-01")).toBeNull();
    expect(pickerDate("not-a-date")).toBeNull();
  });

  it("posts nothing for an absent, invalid or out-of-range picker value", () => {
    expect(postedDate(null)).toBe("");
    expect(postedDate(undefined)).toBe("");
  });
});

describe("wall-values — the scriptless box's pattern says what the value rule says", () => {
  const dateAnchored = new RegExp(`^${DATE_PATTERN}$`);
  const timeAnchored = new RegExp(`^${TIME_PATTERN}$`);

  const dates = [
    "2026-11-21",
    "2026-01-01",
    "2026-12-31",
    "",
    "2026-13-01",
    "2026-00-01",
    "2026-01-32",
    "26-11-21",
    "2026/11/21",
    "2026-1-1",
  ];
  const times = ["00:00", "19:00", "23:59", "", "24:00", "9:30", "19:5", "1900"];

  it("agrees with DATE_VALUE on every case, anchored the way HTML anchors `pattern` itself", () => {
    for (const value of dates) expect(dateAnchored.test(value), value).toBe(DATE_VALUE.test(value));
  });

  it("agrees with TIME_VALUE on every case", () => {
    for (const value of times) expect(timeAnchored.test(value), value).toBe(TIME_VALUE.test(value));
  });

  it("isDateValue accepts a real calendar date and refuses one with the right shape but no such day", () => {
    expect(isDateValue("2026-11-21")).toBe(true);
    expect(isDateValue("2026-02-29")).toBe(false); // 2026 is not a leap year
    expect(isDateValue("2028-02-29")).toBe(true); // 2028 is
    expect(isDateValue("2026-04-31")).toBe(false); // April has 30 days
  });

  it("isTimeValue is exactly TIME_VALUE — no calendar to check", () => {
    for (const value of times) expect(isTimeValue(value)).toBe(TIME_VALUE.test(value));
  });
});

describe("BR-REQ-050-02 normalizeTypedTime — what the typed time box reads, 24-hour only (§NNN)", () => {
  it("reads the usual typed shapes as HH:mm", () => {
    const cases: Array<[string, string]> = [
      ["19:00", "19:00"],
      ["1900", "19:00"],
      ["19.00", "19:00"],
      ["19,30", "19:30"],
      ["19h30", "19:30"],
      ["19 30", "19:30"],
      ["930", "09:30"],
      ["9:30", "09:30"],
      ["7", "07:00"],
      ["19", "19:00"],
      ["0", "00:00"],
      ["23:59", "23:59"],
      [" 06:05 ", "06:05"],
    ];
    for (const [typed, read] of cases) {
      expect(normalizeTypedTime(typed), typed).toBe(read);
      expect(isTimeValue(normalizeTypedTime(typed)), typed).toBe(true);
    }
  });

  it("leaves what is no time of day as typed, for the pattern and the server to refuse", () => {
    for (const typed of ["24:00", "19:60", "2500", "7pm", "7 PM", "07:00 AM", "abc", "19:", "1:2"]) {
      expect(normalizeTypedTime(typed), typed).toBe(typed.trim());
      expect(isTimeValue(normalizeTypedTime(typed)), typed).toBe(false);
    }
    expect(normalizeTypedTime("")).toBe("");
    expect(normalizeTypedTime("   ")).toBe("");
  });
});
