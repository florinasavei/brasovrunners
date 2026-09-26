import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DATE_FORMATS, formatDay, formatTime } from "@/i18n/dates";

/**
 * §NNN — every time a person reads is on the 24-hour clock, in Romanian and in English (the
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

const EVENING = new Date("2027-01-16T17:05:00.000Z"); // 19:05 in Bucharest, winter time

describe("BR-REQ-050-02 every time reads 24-hour, in both languages (§349, §NNN)", () => {
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
    }
    expect(offenders).toEqual([]);
  });
});
