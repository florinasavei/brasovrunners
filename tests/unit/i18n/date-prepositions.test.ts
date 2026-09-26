import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { formatDay, formatDayRange } from "@/i18n/dates";
import { emailSampleActionUrl, emailSampleFor } from "@/modules/notifications/email-copy-fields";
import { renderBilingual } from "@/modules/notifications/templates";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";

/**
 * §452 — a date that carries its weekday takes no «pe» in front of it, and the hour inside a
 * sentence takes «la» / «at». The owner, 2026-09-26, on «Înscrierile se deschid pe sâmbătă, 26
 * sept. 2026, 17:00.»: not grammatical. It reads «Înscrierile se deschid sâmbătă, 26 sept. 2026,
 * la 17:00.» One rule in the helper (`src/i18n/dates.ts`) for the hour, and every sentence of both
 * catalogues, and the platform's own email and PDF sentences in `src/`, read here for the «pe».
 */

// Saturday 26 September 2026, 17:00 in Brașov (UTC+3 in summer).
const OPENS = new Date("2026-09-26T14:00:00Z");
const ZONE = "Europe/Bucharest";

type Tree = { [key: string]: string | Tree | readonly (string | Tree)[] };

function sentences(tree: Tree, prefix = ""): [string, string][] {
  return Object.entries(tree).flatMap(([key, value]): [string, string][] => {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "string") return [[path, value]];
    if (Array.isArray(value)) {
      return value.flatMap((item, index): [string, string][] =>
        typeof item === "string" ? [[`${path}[${index}]`, item]] : sentences(item as Tree, `${path}[${index}]`),
      );
    }
    return sentences(value as Tree, path);
  });
}

function fill(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => values[name] ?? whole);
}

/**
 * What may follow «pe» in a sentence: a place on the web or a count — «Înscrie-te pe {provider}»,
 * «plata pe {host}», «Salvat pe {count} date» — never a date. `Event.series.monthly` («Lunar, pe
 * {day}») is the one exception by key: its `{day}` is the day of the month, a number («pe 11»).
 */
const NOT_A_DATE_AFTER_PE = new Set(["host", "provider", "count", "baseUrl", "email", "branch"]);
const MONTHLY_DAY = "Event.series.monthly";

/** The placeholders a caller fills with a date from the helper; the hour inside one already has its word. */
const DATE_PLACEHOLDERS = "date|when|day|until|deadline|due|last|first|end|resumesAt|checked|checkedOn|opens";

describe("§452 the hour inside a sentence takes «la» / «at»", () => {
  it("writes the owner's sentence the grammatical way", () => {
    const date = formatDay(OPENS, { locale: "ro", timeZone: ZONE, style: "long", withTime: true, position: "inline" });
    expect(date).toBe("sâmbătă, 26 sept. 2026, la 17:00");
    expect(fill(ro.Event.cta.opensOn, { date })).toBe("Înscrierile se deschid sâmbătă, 26 sept. 2026, la 17:00.");
    const english = formatDay(OPENS, { locale: "en", timeZone: ZONE, style: "long", withTime: true, position: "inline" });
    expect(fill(en.Event.cta.opensOn, { date: english })).toBe("Registration opens on Saturday, 26 Sept 2026, at 17:00.");
  });

  it("says the hour's word in the short form too, and never where the date starts a label", () => {
    expect(formatDay(OPENS, { locale: "ro", timeZone: ZONE, style: "short", withTime: true, position: "inline" })).toBe("sâm., 26 sept. 2026, la 17:00");
    expect(formatDay(OPENS, { locale: "en", timeZone: ZONE, style: "short", withTime: true, position: "inline" })).toBe("Sat, 26 Sept 2026, at 17:00");
    expect(formatDay(OPENS, { locale: "ro", timeZone: ZONE, withTime: true })).toBe("Sâmbătă, 26 sept. 2026, 17:00");
    expect(formatDay(OPENS, { locale: "en", timeZone: ZONE, withTime: true })).toBe("Saturday, 26 Sept 2026, 17:00");
  });

  it("keeps a span's second half in lower case with the bare hour, unless the span is inside a sentence", () => {
    const closes = new Date("2026-11-19T21:59:00Z");
    expect(formatDay(closes, { locale: "ro", timeZone: ZONE, style: "short", withTime: true, position: "continues" })).toBe("joi, 19 nov. 2026, 23:59");
    expect(formatDayRange(OPENS, closes, { locale: "ro", timeZone: ZONE, style: "short", withTime: true })).toBe(
      "Sâm., 26 sept. 2026, 17:00 – joi, 19 nov. 2026, 23:59",
    );
    expect(formatDayRange(OPENS, closes, { locale: "ro", timeZone: ZONE, style: "short", withTime: true, position: "inline" })).toBe(
      "sâm., 26 sept. 2026, la 17:00 – joi, 19 nov. 2026, la 23:59",
    );
  });

  it("adds nothing to a date without its time", () => {
    expect(formatDay(OPENS, { locale: "ro", timeZone: ZONE, position: "inline" })).toBe("sâmbătă, 26 sept. 2026");
  });
});

/**
 * The keys that keep «până la {x}»: a series' last date or a range's end, filled with a date that
 * carries no hour, where «până la» is Romanian's own «until». Every deadline — a hold, an offer,
 * a confirm-by — carries its hour and reads «până {x}».
 */
const RANGE_UNTIL_WITHOUT_TIME = new Set<string>([
  "Admin.editor.repeatRuleUntil",
  "Admin.editor.repeatRuleLiveUntil",
  "Admin.editor.scope.countFollowing",
  "Admin.editor.scope.countRange",
]);

describe("§452 no catalogue sentence puts a preposition before a date the helper wrote", () => {
  it("never writes «pe» before a date in Romanian", () => {
    const offending = sentences(ro as unknown as Tree).flatMap(([key, text]) =>
      [...text.matchAll(/(?<![\p{L}])pe \{(\w+)\}/gu)]
        .map((match) => match[1])
        .filter((name) => !NOT_A_DATE_AFTER_PE.has(name) && !(key === MONTHLY_DAY && name === "day"))
        .map((name) => `${key}: pe {${name}}`),
    );
    expect(offending).toEqual([]);
  });

  it("never writes «la» / «at» before a date, whose hour already carries it", () => {
    const romanian = sentences(ro as unknown as Tree).flatMap(([key, text]) =>
      [...text.matchAll(new RegExp(`(?<![\\p{L}])(?<!de )la \\{(${DATE_PLACEHOLDERS})\\}`, "gu"))]
        .map((match) => `${key}: ${match[0]}`)
        .filter((entry) => !RANGE_UNTIL_WITHOUT_TIME.has(entry.slice(0, entry.indexOf(": ")))),
    );
    // «de la {first}» is Romanian's own «from». «până la {x}» stays only on the keys listed in
    // RANGE_UNTIL_WITHOUT_TIME, whose value carries no hour; a deadline with its hour reads «până {x}».
    const english = sentences(en as unknown as Tree).flatMap(([key, text]) =>
      [...text.matchAll(new RegExp(`\\bat \\{(${DATE_PLACEHOLDERS})\\}`, "g"))].map((match) => `${key}: ${match[0]}`),
    );
    // The night sentence's {end} is a bare hour («se termină la {end}» / «ends at {end}»), not a date.
    const hourOnly = (entry: string) => /^(Event\.night\.|Admin\.editor\.night\.)/.test(entry);
    expect(romanian.filter((entry) => !hourOnly(entry))).toEqual([]);
    expect(english.filter((entry) => !hourOnly(entry))).toEqual([]);
  });
});

describe("§452 the platform's own sentences in src/ (emails, the PDFs) say no «pe» before a date", () => {
  const SRC = join(process.cwd(), "src");
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) return files(path);
      return /\.(ts|tsx)$/.test(name) ? [path] : [];
    });

  it("finds no «pe ${…Formatted}» nor «până la» before a deadline with its hour in a Romanian string", () => {
    const offending = files(SRC).flatMap((path) => {
      const text = readFileSync(path, "utf8");
      return [...text.matchAll(/(?<![\p{L}])(?:pe (?:\{(?:date|when|until|day)\}|\$\{[^}]*Formatted[^}]*\})|până la (?:\$\{[^}]*Formatted[^}]*\}|\{(?:until|deadline|due)\}))/gu)].map(
        (match) => `${relative(process.cwd(), path)}: ${match[0]}`,
      );
    });
    expect(offending).toEqual([]);
  });
});

describe("§452 the other sentences that carry a date, rendered in both languages", () => {
  const date = (locale: "ro" | "en", at: Date) =>
    formatDay(at, { locale, timeZone: ZONE, style: "short", withTime: true, position: "inline" });
  const race = new Date("2026-11-21T07:00:00Z");
  const opens = new Date("2026-11-14T07:00:00Z");
  const due = new Date("2026-11-19T07:00:00Z");

  it("says the confirmation window (§407) with no preposition before a date and «la» / «at» before the hour", () => {
    const words = (locale: "ro" | "en") => ({ date: date(locale, race), opens: date(locale, opens), due: date(locale, due) });
    expect(fill(ro.Admin.editor.boxes.confirmation.dates, words("ro"))).toBe(
      "Pentru sâm., 21 nov. 2026, la 09:00: cerută din sâm., 14 nov. 2026, la 09:00, termen joi, 19 nov. 2026, la 09:00.",
    );
    expect(fill(en.Admin.editor.boxes.confirmation.dates, words("en"))).toBe(
      "For Sat, 21 Nov 2026, at 09:00: asked from Sat, 14 Nov 2026, at 09:00, due Thu, 19 Nov 2026, at 09:00.",
    );
  });

  it("says a deadline as «până X, la HH:MM» / «until X, at HH:MM», never «până la X»", () => {
    const long = (locale: "ro" | "en") => formatDay(due, { locale, timeZone: ZONE, style: "long", withTime: true, position: "inline" });
    expect(fill(ro.Registrations.declare.deadline, { deadline: long("ro") })).toMatch(/^Locul tău este rezervat până joi, 19 nov\. 2026, la 09:00\./);
    expect(fill(en.Registrations.declare.deadline, { deadline: long("en") })).toMatch(/^Your place is held until Thursday, 19 Nov 2026, at 09:00\./);
    expect(fill(ro.Registrations.declare.deadlinePassed, { deadline: long("ro") })).toMatch(/^Termenul, joi, 19 nov\. 2026, la 09:00, a trecut,/);
    expect(fill(en.Registrations.declare.deadlinePassed, { deadline: long("en") })).toMatch(/^The deadline, Thursday, 19 Nov 2026, at 09:00, has passed,/);
  });

  it("starts the email's «Când» / «When» row with the date, capitalised, and no preposition", () => {
    for (const locale of ["ro", "en"] as const) {
      const content = renderBilingual("REGISTRATION_CONFIRMED", locale, emailSampleFor("REGISTRATION_CONFIRMED", locale), emailSampleActionUrl(locale));
      const label = locale === "ro" ? "Când" : "When";
      const row = content.text.split("\n").find((line) => line.startsWith(`${label}: `));
      expect(row).toMatch(new RegExp(`^${label}: \\p{Lu}\\p{L}+, \\d{1,2} \\p{L}+\\.? \\d{4}`, "u"));
      expect(row).not.toMatch(/(?<![\p{L}])(pe|on) \p{L}+, \d/u);
    }
  });
});
