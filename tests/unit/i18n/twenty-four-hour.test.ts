import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { calendarDayWords, DATE_FORMATS, formatDay, formatTime } from "@/i18n/dates";
import { nightAutoLine, programmeRowsOf } from "@/modules/content/events/ui/NightEventField";
import { DEFAULT_CLUB_COORDINATES } from "@/modules/events/domain/sun";
import { calendarDescription, type CalendarEvent, type CalendarLabels } from "@/modules/events/ical";
import { eventFactsBlock } from "@/modules/notifications/domain/event-facts";
import { emailSampleEventFacts } from "@/modules/notifications/email-copy-fields";
import { readTypedTime } from "@/shared/forms/pickers/wall-values";

/**
 * §439 — every time a person reads is on the 24-hour clock, in Romanian and in English (the
 * owner, 2026-09-26: "iar ai făcut ora cu AM și PM… am zis că vreau 24H format!").
 *
 * Two halves. What the helper writes, in both languages, on an evening hour (a morning one reads
 * the same on either clock, which is how the defect hid). And what the source may not contain: a
 * browser time control (`type="time"`, drawn in the browser's own locale — "07:00 PM" on an
 * English Chrome, §400), or a formatter option that asks for a 12-hour clock.
 */

const ROOT = path.resolve(__dirname, "../../..");

function sources(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const full = path.join(directory, entry);
    if (statSync(full).isDirectory()) return sources(full);
    return /\.(ts|tsx)$/.test(entry) ? [full] : [];
  });
}

/** The one file that may build an hour formatter without pinning it inline: it pins every named format. */
const HELPER = "src/i18n/dates.ts";

/**
 * Every options object handed to `Intl.DateTimeFormat(` or `format.dateTime(`, as written (one
 * level of braces). The call's arguments are read to their own closing parenthesis, so a first
 * argument with parentheses of its own — `format.dateTime(new Date(x), { hour })` — still yields
 * the object after it (the V2.03 review: `[^{)]*` stopped at the first `)` and saw nothing).
 */
function formatterOptions(text: string): string[] {
  const found: string[] = [];
  for (const call of text.matchAll(/(?:Intl\.DateTimeFormat|\.dateTime)\(/g)) {
    const open = (call.index ?? 0) + call[0].length;
    let depth = 1;
    let end = open;
    while (end < text.length && depth > 0) {
      if (text[end] === "(") depth += 1;
      else if (text[end] === ")") depth -= 1;
      end += 1;
    }
    found.push(...[...text.slice(open, end - 1).matchAll(/\{[^{}]*\}/g)].map((match) => match[0]));
  }
  return found;
}

/**
 * Every object literal that asks for an hour by name with a string value — `{ hour: "2-digit" }`
 * wherever it stands. Options held in a variable (`const opts = { hour: "2-digit" }; new
 * Intl.DateTimeFormat("en", opts)`) never reach `formatterOptions`, so the literal is asked
 * where it is written. What neither sees: options built by spreading or by assignment
 * (`opts.hour = "2-digit"`); none exists in src/, and `dates.ts` is the place for a new one.
 */
function hourObjects(text: string): string[] {
  return [...text.matchAll(/\{[^{}]*\}/g)].map((match) => match[0]).filter((object) => /\bhour\s*:\s*["'`]/.test(object));
}

/** An options object that shows an hour — by name or by shorthand (`{ hour }`) — pins the 24-hour cycle. */
const ASKS_HOUR = /\bhour\b\s*[:,}]/;
const PINS_H23 = /hourCycle:\s*["']h23["']|hour12:\s*false/;

/** `.toLocaleString(` on something named like a date — a number's (`count.toLocaleString`) groups digits, never an hour. */
const DATE_TO_LOCALE_STRING = /\b(?:\w*(?:[Dd]ate|[Aa]t|[Tt]ime|[Ww]hen|now)|new Date\([^)]*\))\.toLocaleString\(/;

const EVENING = new Date("2027-01-16T17:05:00.000Z"); // 19:05 in Bucharest, winter time

describe("BR-REQ-050-02 every time reads 24-hour, in both languages (§349, §439)", () => {
  it("writes 19:05, never 7:05 pm, in Romanian and in English", () => {
    for (const locale of ["ro", "en"]) {
      const time = formatTime(EVENING, { locale, timeZone: "Europe/Bucharest" });
      expect(time).toBe("19:05");
      const day = formatDay(EVENING, { locale, timeZone: "Europe/Bucharest", withTime: true });
      expect(day.endsWith(", 19:05")).toBe(true);
      expect(day).not.toMatch(/\b[ap]\.?m\.?\b/i);
    }
  });

  it("pins every named format that has an hour to the h23 cycle", () => {
    for (const [name, options] of Object.entries(DATE_FORMATS)) {
      if ("hour" in options) expect(options.hourCycle, name).toBe("h23");
    }
  });

  it("leaves no browser time control and no 12-hour option anywhere in src/", () => {
    const offenders: string[] = [];
    for (const file of sources(path.join(ROOT, "src"))) {
      // Code only: the doc comments name the controls they replaced, on purpose.
      const text = readFileSync(file, "utf8")
        .split(/\r?\n/)
        .filter((line) => !/^\s*(\*|\/\*|\/\/|\{\/\*)/.test(line))
        .join("\n");
      const relative = path.relative(ROOT, file).replaceAll("\\", "/");
      if (/type=["{]*["']time["']|type:\s*["']time["']/.test(text)) offenders.push(`${relative}: type="time"`);
      if (/type=["{]*["']datetime-local["']|type:\s*["']datetime-local["']/.test(text)) offenders.push(`${relative}: type="datetime-local"`);
      if (/hour12:\s*true|hourCycle:\s*["']h1[12]["']/.test(text)) offenders.push(`${relative}: a 12-hour option`);
      if (/\bampm\b/.test(text)) offenders.push(`${relative}: ampm`);
      // Outside the helper, a formatter that shows an hour pins the cycle itself: with no
      // `hourCycle: "h23"` / `hour12: false`, `{ hour: "2-digit" }` in "en" prints «07:00 PM».
      if (relative !== HELPER) {
        for (const options of new Set([...formatterOptions(text), ...hourObjects(text)])) {
          if (ASKS_HOUR.test(options) && !PINS_H23.test(options)) {
            offenders.push(`${relative}: an hour without h23 — ${options.replace(/\s+/g, " ")}`);
          }
        }
        if (/\btimeStyle\s*:/.test(text)) offenders.push(`${relative}: timeStyle`);
        if (/\.toLocaleTimeString\(/.test(text)) offenders.push(`${relative}: toLocaleTimeString`);
        if (/\.toLocaleString\(/.test(text) && DATE_TO_LOCALE_STRING.test(text)) offenders.push(`${relative}: a Date's toLocaleString`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("the walk's own check catches the shapes it names", () => {
    expect(formatterOptions(`new Intl.DateTimeFormat("en", { hour: "2-digit", minute: "2-digit" })`)).toEqual([`{ hour: "2-digit", minute: "2-digit" }`]);
    expect(formatterOptions(`format.dateTime(at, { timeZone, hour: "2-digit", hourCycle: "h23" })`)[0]).toContain("h23");
    // A first argument with parentheses of its own, and a shorthand hour.
    const shorthand = formatterOptions(`format.dateTime(new Date(x), { hour })`);
    expect(shorthand).toEqual(["{ hour }"]);
    expect(ASKS_HOUR.test(shorthand[0]) && !PINS_H23.test(shorthand[0])).toBe(true);
    // Options held in a variable are asked where the literal is written.
    const held = `const opts = { hour: "2-digit", minute: "2-digit" };\nnew Intl.DateTimeFormat("en", opts).format(at);`;
    expect(formatterOptions(held)).toEqual([]);
    expect(hourObjects(held)).toEqual([`{ hour: "2-digit", minute: "2-digit" }`]);
    expect(hourObjects(`const clock = { hour: "2-digit", hourCycle: "h23" };`).every((object) => PINS_H23.test(object))).toBe(true);
    // A number named hour is no formatter option.
    expect(hourObjects(`function at(hour: number) { return { hour, minute: 0 }; }`)).toEqual([]);
    expect(DATE_TO_LOCALE_STRING.test("startsAt.toLocaleString(locale)")).toBe(true);
    expect(DATE_TO_LOCALE_STRING.test("value.toLocaleString(locale)")).toBe(false);
  });
});

/**
 * The surfaces a person reads, at 19:05 in both languages: the email's facts block (§392), the
 * calendar file's text (§107, §404) and the editor's night line (§394). An hour before 13:00
 * reads the same on either clock, so every one is asked about an evening.
 */
describe("BR-REQ-050-02 the surfaces write 19:05, never AM/PM, in both languages (§439)", () => {
  const AM_PM = /\b[AaPp]\.?\s?[Mm]\.?(?![a-zăâîșț])/;

  it("the email's facts block: when, and the programme", () => {
    for (const locale of ["ro", "en"] as const) {
      const facts = {
        ...emailSampleEventFacts(locale),
        startsAt: EVENING,
        raceStartsAt: null,
        scheduleItems: [{ startsAt: EVENING.toISOString(), endsAt: null, label: { ro: "Startul", en: "The start" }, place: null }],
      };
      const { text, html } = eventFactsBlock(facts, locale);
      expect(text, locale).toMatch(/19:05/);
      expect(text, locale).not.toMatch(AM_PM);
      expect(html.replace(/<[^>]+>/g, " "), locale).not.toMatch(AM_PM);
    }
  });

  it("the calendar file's description, with its night line", () => {
    const translator =
      (catalogue: { Event: Record<string, unknown> }): CalendarLabels["t"] =>
      (key, values) => {
        const message = key.split(".").reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], catalogue.Event);
        if (typeof message !== "string") throw new Error(`missing Event.${key}`);
        return Object.entries(values ?? {}).reduce((out, [name, value]) => out.replaceAll(`{${name}}`, String(value)), message);
      };
    const event: CalendarEvent = {
      id: "11111111-1111-1111-1111-111111111111",
      title: "Seara pe Tâmpa",
      startsAt: EVENING,
      endsAt: null,
      timezone: "Europe/Bucharest",
      locationName: "Tâmpa",
      excerpt: null,
      scheduleJson: null,
      distanceMeters: 8000,
      url: "https://example.test/ro/evenimente/seara",
      updatedAt: null,
      nightOverride: null,
    };
    for (const [locale, catalogue] of [
      ["ro", ro],
      ["en", en],
    ] as const) {
      const text = calendarDescription(event, { locale, t: translator(catalogue) });
      expect(text, locale).toMatch(/19:05/);
      expect(text, locale).not.toMatch(AM_PM);
    }
  });

  it("the editor's automatic night line", () => {
    for (const [locale, catalogue] of [
      ["ro", ro],
      ["en", en],
    ] as const) {
      const night = catalogue.Admin.editor.night;
      const { line } = nightAutoLine(
        { ...night, day: calendarDayWords(locale) },
        { date: "2027-01-16", time: "19:05", timeZone: "Europe/Bucharest" },
        DEFAULT_CLUB_COORDINATES,
      );
      expect(line, locale).toMatch(/19:05/);
      expect(line, locale).toMatch(/\b1[67]:\d\d\b/); // the sunset, on the same clock
      expect(line, locale).not.toMatch(AM_PM);
    }
  });

  /*
    The V2.03 review: the night line read the start box raw while the series sentence read it as
    it would post, so «1900» typed and not yet left said 19:00 in one and «no time» in the other.
    Both now ask `readTypedTime`, and the programme's rows are read the same way.
  */
  it("the night line reads a typed «1900» as the box will post it, like the series sentence", () => {
    expect(readTypedTime("1900")).toBe("19:00");
    expect(readTypedTime("19.05")).toBe("19:05");
    expect(readTypedTime("19:")).toBe("");
    expect(readTypedTime("7pm")).toBe("");
    const data = new FormData();
    data.set("event.schedule[0].date", "2027-01-16");
    data.set("event.schedule[0].time", "1905");
    data.set("event.schedule[0].endTime", "21.30");
    expect(programmeRowsOf(data)).toEqual([{ date: "2027-01-16", time: "19:05", endTime: "21:30" }]);
    const night = ro.Admin.editor.night;
    const { line } = nightAutoLine(
      { ...night, day: calendarDayWords("ro") },
      { date: "2027-01-16", time: readTypedTime("1905"), timeZone: "Europe/Bucharest" },
      DEFAULT_CLUB_COORDINATES,
    );
    expect(line).toMatch(/19:05/);
  });

  it("the editor's night line itself asks readTypedTime of the start box, not the raw typed text", () => {
    const island = readFileSync(path.join(ROOT, "src/modules/content/events/ui/NightEventField.tsx"), "utf8");
    expect(island).toContain('time: readTypedTime(text("event.startsAtTime"))');
  });
});
