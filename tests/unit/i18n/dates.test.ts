import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { createFormatter } from "next-intl";
import { describe, expect, it } from "vitest";
import {
  calendarDayWords,
  capitalizeFirst,
  CLUB_TIME_ZONE,
  composeCalendarDay,
  DATE_FORMATS,
  formatCalendarDay,
  formatDay,
  formatDayRange,
  formatTime,
  intlLocale,
} from "@/i18n/dates";

/**
 * BR-REQ-040-03 criteria 4–6 — every date a person reads carries its day of the week, written
 * one way (§349): the long and the short form, 24-hour times, a capital where the date starts a
 * line and the language's own case inside a sentence, always in the zone the caller names.
 */

// Saturday 16 January 2027, 09:30 in Brașov (UTC+2 in winter).
const SATURDAY = new Date("2027-01-16T07:30:00Z");
const BUCHAREST = CLUB_TIME_ZONE;

describe("BR-REQ-040-03 criterion 4 the long and the short form, in both languages", () => {
  it("writes the long form: the whole weekday, the month abbreviated, the year", () => {
    expect(formatDay(SATURDAY, { locale: "ro", timeZone: BUCHAREST, style: "long" })).toBe("Sâmbătă, 16 ian. 2027");
    expect(formatDay(SATURDAY, { locale: "en", timeZone: BUCHAREST, style: "long" })).toBe("Saturday, 16 Jan 2027");
  });

  it("defaults to the long form", () => {
    expect(formatDay(SATURDAY, { locale: "ro", timeZone: BUCHAREST })).toBe("Sâmbătă, 16 ian. 2027");
  });

  it("writes the short form: the weekday abbreviated", () => {
    expect(formatDay(SATURDAY, { locale: "ro", timeZone: BUCHAREST, style: "short" })).toBe("Sâm., 16 ian. 2027");
    expect(formatDay(SATURDAY, { locale: "en", timeZone: BUCHAREST, style: "short" })).toBe("Sat, 16 Jan 2027");
  });

  it("adds the time on a 24-hour clock in both languages, never AM/PM", () => {
    expect(formatDay(SATURDAY, { locale: "ro", timeZone: BUCHAREST, withTime: true })).toBe("Sâmbătă, 16 ian. 2027, 09:30");
    expect(formatDay(SATURDAY, { locale: "en", timeZone: BUCHAREST, withTime: true })).toBe("Saturday, 16 Jan 2027, 09:30");
    const evening = new Date("2027-01-16T19:05:00Z");
    expect(formatDay(evening, { locale: "en", timeZone: BUCHAREST, style: "short", withTime: true })).toBe("Sat, 16 Jan 2027, 21:05");
    expect(formatTime(evening, { locale: "en", timeZone: BUCHAREST })).toBe("21:05");
    expect(formatTime(evening, { locale: "ro", timeZone: BUCHAREST })).toBe("21:05");
  });

  it("drops the year only when asked — a month's grid, whose heading names it", () => {
    expect(formatDay(SATURDAY, { locale: "ro", timeZone: BUCHAREST, style: "short", year: false })).toBe("Sâm., 16 ian.");
    expect(formatDay(SATURDAY, { locale: "en", timeZone: BUCHAREST, style: "short", year: false })).toBe("Sat, 16 Jan");
  });

  it("maps the page languages to the two Intl locales", () => {
    expect(intlLocale("ro")).toBe("ro-RO");
    expect(intlLocale("en")).toBe("en-GB");
    expect(intlLocale("fr")).toBe("en-GB");
  });
});

describe("BR-REQ-040-03 criterion 5 a capital where the date starts, lower case inside a Romanian sentence", () => {
  it("capitalises a date that starts a label, a line, a cell or a heading", () => {
    expect(formatDay(SATURDAY, { locale: "ro", timeZone: BUCHAREST, position: "start" })).toMatch(/^Sâmbătă/);
    expect(formatDay(SATURDAY, { locale: "ro", timeZone: BUCHAREST, style: "short", position: "start" })).toMatch(/^Sâm\./);
  });

  it("keeps Romanian's lower case inside a sentence", () => {
    expect(formatDay(SATURDAY, { locale: "ro", timeZone: BUCHAREST, position: "inline" })).toBe("sâmbătă, 16 ian. 2027");
    expect(formatDay(SATURDAY, { locale: "ro", timeZone: BUCHAREST, style: "short", withTime: true, position: "inline" })).toBe(
      "sâm., 16 ian. 2027, 09:30",
    );
  });

  it("leaves English capitalised either way", () => {
    expect(formatDay(SATURDAY, { locale: "en", timeZone: BUCHAREST, position: "inline" })).toBe("Saturday, 16 Jan 2027");
  });

  it("capitalises a Romanian letter with a diacritic, and nothing but the first letter", () => {
    expect(capitalizeFirst("ștafetă, 3 mar.", "ro")).toBe("Ștafetă, 3 mar.");
    expect(capitalizeFirst("", "ro")).toBe("");
  });

  it("writes a span with the second day in the language's own case", () => {
    const sunday = new Date("2027-01-17T07:30:00Z");
    expect(formatDayRange(SATURDAY, sunday, { locale: "ro", timeZone: BUCHAREST, style: "short" })).toBe(
      "Sâm., 16 ian. 2027 – dum., 17 ian. 2027",
    );
    expect(formatDayRange(SATURDAY, sunday, { locale: "en", timeZone: BUCHAREST, style: "short" })).toBe("Sat, 16 Jan 2027 – Sun, 17 Jan 2027");
  });
});

describe("BR-REQ-040-03 criterion 6 the zone the caller names, never the server's", () => {
  it("reads an instant after midnight in Brașov as the next day, where UTC still says the day before", () => {
    // 22:30 UTC on Friday the 15th is 00:30 on Saturday the 16th in Brașov.
    const late = new Date("2027-01-15T22:30:00Z");
    expect(formatDay(late, { locale: "ro", timeZone: BUCHAREST, withTime: true })).toBe("Sâmbătă, 16 ian. 2027, 00:30");
    expect(formatDay(late, { locale: "ro", timeZone: "UTC", withTime: true })).toBe("Vineri, 15 ian. 2027, 22:30");
    expect(formatDay(late, { locale: "en", timeZone: BUCHAREST, style: "short" })).toBe("Sat, 16 Jan 2027");
  });

  it("follows the change to summer time, with no offset written into the code", () => {
    // Summer time starts on Sunday 29 March 2026 at 03:00 in Brașov: 00:30 UTC is 02:30 (UTC+2),
    // 01:30 UTC is already 04:30 (UTC+3).
    expect(formatDay(new Date("2026-03-29T00:30:00Z"), { locale: "ro", timeZone: BUCHAREST, withTime: true })).toBe("Duminică, 29 mar. 2026, 02:30");
    expect(formatDay(new Date("2026-03-29T01:30:00Z"), { locale: "ro", timeZone: BUCHAREST, withTime: true })).toBe("Duminică, 29 mar. 2026, 04:30");
  });

  it("follows the change back to winter time, when one hour happens twice", () => {
    // Sunday 25 October 2026: 04:00 summer time becomes 03:00 winter time, so 00:30 and 01:30
    // UTC both read 03:30 in Brașov.
    expect(formatTime(new Date("2026-10-25T00:30:00Z"), { locale: "ro", timeZone: BUCHAREST })).toBe("03:30");
    expect(formatTime(new Date("2026-10-25T01:30:00Z"), { locale: "ro", timeZone: BUCHAREST })).toBe("03:30");
    expect(formatDay(new Date("2026-10-25T01:30:00Z"), { locale: "en", timeZone: BUCHAREST })).toBe("Sunday, 25 Oct 2026");
  });

  it("reads a calendar date as the day it names, whatever zone a reader is in", () => {
    expect(formatCalendarDay("2027-01-16", { locale: "ro" })).toBe("Sâmbătă, 16 ian. 2027");
    expect(formatCalendarDay("2027-01-16", { locale: "en", style: "short", position: "inline" })).toBe("Sat, 16 Jan 2027");
    // A `date` column read back as midnight UTC is still that day, not the evening before.
    expect(formatCalendarDay(new Date("2027-01-16T00:00:00Z"), { locale: "ro", position: "inline" })).toBe("sâmbătă, 16 ian. 2027");
  });
});

describe("the same formats, registered by name for next-intl (§349)", () => {
  it("formats `format.dateTime(date, \"dayLong\")` with the weekday, in the language's own case", () => {
    const ro = createFormatter({ locale: "ro", timeZone: BUCHAREST, formats: { dateTime: DATE_FORMATS } });
    const en = createFormatter({ locale: "en-GB", timeZone: BUCHAREST, formats: { dateTime: DATE_FORMATS } });
    expect(ro.dateTime(SATURDAY, "dayLong")).toBe("sâmbătă, 16 ian. 2027");
    expect(ro.dateTime(SATURDAY, "dayShortTime")).toBe("sâm., 16 ian. 2027, 09:30");
    expect(en.dateTime(SATURDAY, "dayShort")).toBe("Sat, 16 Jan 2027");
    expect(en.dateTime(new Date("2027-01-16T19:05:00Z"), "time")).toBe("21:05");
  });

  it("is what the request config registers", () => {
    const source = readFileSync(join(process.cwd(), "src/i18n/request.ts"), "utf8");
    expect(source).toMatch(/formats:\s*\{\s*dateTime:\s*DATE_FORMATS\s*\}/);
  });
});

/**
 * The helper is the one way (§349): a date written anywhere else with `dateStyle` or a
 * hand-picked Intl locale is a date without its weekday, or with a different comma. The
 * machine formats (`en-CA`), the calendar's column headers and the series sentence's weekday
 * names do not name a display locale and pass.
 */
describe("no date is formatted outside the helper", () => {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.(ts|tsx)$/.test(name)) files.push(path);
    }
  };
  walk(join(process.cwd(), "src"));

  it("never uses dateStyle or timeStyle, which lay a date out without its weekday", () => {
    const offenders = files.filter((file) => /\b(dateStyle|timeStyle)\s*:/.test(readFileSync(file, "utf8")));
    expect(offenders.map((file) => relative(process.cwd(), file))).toEqual([]);
  });

  // What may name a display locale and is not a date a person reads as one.
  const allowed = [
    "src/i18n/dates.ts", // the helper itself
    "src/modules/events/ui/series-sentence.ts", // weekday names in "every Monday and Wednesday"
    "src/modules/jobs/quiet-hours.ts", // the hour of the day, read by a job, never shown
    "src/modules/jobs/schedule.ts", // the minute of the day the pinger's slots fall on (§NNN), never shown
    "src/db/seeds/sample-dates.ts", // arithmetic for the sample data
  ];

  /*
    §324: the browser's ICU is not the server's, so an island that formats a date the server also
    rendered can disagree with it and throw the page away on hydration. Every island that shows a
    date — the series chips, the scope selector — is handed the server's string instead.
  */
  it("hands an island words that join into exactly the helper's short inline day (§350's live sentence)", () => {
    for (const locale of ["ro", "en"]) {
      const words = calendarDayWords(locale);
      for (let month = 1; month <= 12; month++) {
        for (const day of [1, 9, 28]) {
          const ymd = `2026-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
          expect(composeCalendarDay(ymd, words)).toBe(formatCalendarDay(ymd, { locale, style: "short", position: "inline" }));
        }
      }
    }
    expect(composeCalendarDay("2026-09-30", calendarDayWords("ro"))).toBe("mie., 30 sept. 2026");
    expect(composeCalendarDay("2026-02-31", calendarDayWords("ro"))).toBe("");
    expect(composeCalendarDay("30.09.2026", calendarDayWords("ro"))).toBe("");
  });

  it("leaves no client island to format a date itself", () => {
    const islands = files.filter((file) => /^\s*["']use client["']/.test(readFileSync(file, "utf8")));
    expect(islands.length).toBeGreaterThan(0);
    const offenders = islands.filter((file) =>
      /\bformat(Day|CalendarDay|DayRange|Time)\(|\.dateTime\(|new Intl\.DateTimeFormat\(|toLocale(Date|Time)?String\(/.test(readFileSync(file, "utf8")),
    );
    expect(offenders.map((file) => relative(process.cwd(), file))).toEqual([]);
  });

  it("never builds a display-locale DateTimeFormat outside src/i18n/dates.ts", () => {
    const offenders = files
      .filter((file) => !allowed.some((path) => file.replace(/\\/g, "/").endsWith(path)))
      .filter((file) => /new Intl\.DateTimeFormat\(\s*(locale\b|intl\b|"ro-RO"|"en-GB"|locale ===)/.test(readFileSync(file, "utf8")));
    expect(offenders.map((file) => relative(process.cwd(), file))).toEqual([]);
  });
});
