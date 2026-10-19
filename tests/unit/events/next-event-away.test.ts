import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { awayFrom, type AwayFrom } from "@/modules/events/domain/next-event-away";
import { nextWallMidnight } from "@/modules/events/domain/page-clock";
import { fromWallTimeInput } from "@/modules/events/domain/zoned-time";
import { secondsUntilFirst } from "@/modules/public-cache/page-lifetime";

/**
 * §834 — the calendar's «Următorul eveniment» says how far away it is: «Azi», «Mâine», «Peste 5 zile»,
 * «Peste 3 săptămâni», «Peste 2 luni», «Acum». Calendar days on the club's wall clock
 * (`daysUntilOnWallClock`), across the October clock change; the words in both languages through
 * `countForm`; the card draws them; the page that holds the card is held to the club's midnight.
 */
let currentLocale: "ro" | "en" = "ro";

vi.mock("next-intl/server", async () => {
  const { createFormatter, createTranslator } = await import("next-intl");
  const ro = (await import("../../../messages/ro.json")).default;
  const en = (await import("../../../messages/en.json")).default;
  return {
    getTranslations: async (namespace: string) =>
      createTranslator({ locale: currentLocale, messages: currentLocale === "ro" ? ro : en, namespace: namespace as "Events" }),
    getFormatter: async () => createFormatter({ locale: currentLocale, timeZone: "Europe/Bucharest" }),
    getLocale: async () => currentLocale,
  };
});
vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children, ...rest }: { href: { pathname: string; params: { slug: string } }; children: ReactNode }) =>
    createElement("a", { href: href.pathname.replace("[slug]", href.params.slug), ...rest }, children),
  getPathname: ({ href }: { href: string }) => href,
}));

const { default: NextEventPanel } = await import("@/modules/events/ui/NextEventPanel");
const { sampleRace, SAMPLE_NOW } = await import("@/modules/design/fixtures");

afterEach(() => {
  currentLocale = "ro";
});

const ROOT = path.resolve(__dirname, "../../..");
const TZ = "Europe/Bucharest";

/** A wall time in Brașov, as the instant it is: the clocks go back at 04:00 on Sunday 2026-10-25. */
const wall = (local: string) => {
  const at = fromWallTimeInput(local, TZ);
  if (!at) throw new Error(`not a wall time: ${local}`);
  return at;
};

/** The date `days` after a `YYYY-MM-DD` one, on the calendar — never by adding 24-hour blocks. */
const dateAfter = (date: string, days: number) => {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
};

describe("§834 awayFrom — the steps", () => {
  // Tuesday 2026-10-20, 09:00 in Brașov; the clocks change on Sunday 2026-10-25, five days on.
  const now = wall("2026-10-20T09:00");
  const raceIn = (days: number, time = "18:30") => wall(`${dateAfter("2026-10-20", days)}T${time}`);

  it.each<[number, AwayFrom]>([
    [0, { kind: "today" }],
    [1, { kind: "tomorrow" }],
    [2, { kind: "days", count: 2 }],
    [5, { kind: "days", count: 5 }],
    [13, { kind: "days", count: 13 }],
    [14, { kind: "weeks", count: 2 }],
    [20, { kind: "weeks", count: 2 }],
    [21, { kind: "weeks", count: 3 }],
    [59, { kind: "weeks", count: 8 }],
    [60, { kind: "months", count: 2 }],
    [89, { kind: "months", count: 2 }],
    [90, { kind: "months", count: 3 }],
    [600, { kind: "months", count: 20 }],
  ])("is %i calendar days away: %j", (days, expected) => {
    expect(awayFrom(raceIn(days), now, TZ)).toEqual(expected);
  });

  it("is the same whatever the hour of the race or of the visit — a day is a date, not 24 hours", () => {
    // Saturday 07:00 is «mâine» from Friday morning to Friday 23:59, and «azi» from midnight.
    const saturday = wall("2026-10-24T07:00");
    expect(awayFrom(saturday, wall("2026-10-23T00:00"), TZ)).toEqual({ kind: "tomorrow" });
    expect(awayFrom(saturday, wall("2026-10-23T23:59"), TZ)).toEqual({ kind: "tomorrow" });
    expect(awayFrom(saturday, wall("2026-10-24T00:00"), TZ)).toEqual({ kind: "today" });
    expect(awayFrom(saturday, wall("2026-10-24T06:59"), TZ)).toEqual({ kind: "today" });
  });

  it("reads the club's date, not the server's: Friday 23:30 in Brașov is still Friday at 20:30 UTC", () => {
    const saturday = wall("2026-10-24T07:00");
    expect(awayFrom(saturday, new Date("2026-10-23T20:30:00Z"), TZ)).toEqual({ kind: "tomorrow" });
    expect(awayFrom(saturday, new Date("2026-10-23T21:30:00Z"), TZ)).toEqual({ kind: "today" });
  });

  it("is not thrown by the clocks going back (Sunday 2026-10-25, a 25-hour day)", () => {
    // Monday 00:30 after the change, from Saturday 23:30 before it: 26 hours, two dates.
    expect(awayFrom(wall("2026-10-26T00:30"), wall("2026-10-24T23:30"), TZ)).toEqual({ kind: "days", count: 2 });
    // Sunday morning, from Saturday night: next day, 8.5 hours on the clock-change's own day.
    expect(awayFrom(wall("2026-10-25T08:00"), wall("2026-10-24T22:30"), TZ)).toEqual({ kind: "tomorrow" });
    // Monday 00:05 from Sunday 00:30: 24 h 35 m of the 25-hour day, and one date.
    expect(awayFrom(wall("2026-10-26T00:05"), wall("2026-10-25T00:30"), TZ)).toEqual({ kind: "tomorrow" });
    // A race on the Saturday after the change, counted from before it and from after it.
    const race = wall("2026-10-31T09:00");
    expect(awayFrom(race, wall("2026-10-23T12:00"), TZ)).toEqual({ kind: "days", count: 8 });
    expect(awayFrom(race, wall("2026-10-26T12:00"), TZ)).toEqual({ kind: "days", count: 5 });
    // And the spring change (Sunday 2026-03-29, a 23-hour day) the same way.
    expect(awayFrom(wall("2026-03-30T00:30"), wall("2026-03-28T23:30"), TZ)).toEqual({ kind: "days", count: 2 });
  });

  it("is «acum» from the start on — an event the listing still keeps, running", () => {
    const start = wall("2026-10-20T18:30");
    expect(awayFrom(start, wall("2026-10-20T18:29"), TZ)).toEqual({ kind: "today" });
    expect(awayFrom(start, start, TZ)).toEqual({ kind: "now" });
    expect(awayFrom(start, wall("2026-10-21T01:00"), TZ)).toEqual({ kind: "now" });
  });
});

describe("§834 NextEventPanel — the card says it", () => {
  // SAMPLE_NOW is Sunday 2026-09-27, noon in Brașov; the race is `days` calendar days on, at 15:30 UTC (18:30 there, summer or winter).
  const card = async (days: number, locale: "ro" | "en") => {
    currentLocale = locale;
    const race = { ...sampleRace(locale), startsAt: new Date(Date.UTC(2026, 8, 27 + days, 15, 30)) };
    return renderToStaticMarkup(await NextEventPanel({ event: race, locale, now: SAMPLE_NOW, weather: null }));
  };
  const says = async (days: number, locale: "ro" | "en" = "ro") => /data-away="[a-z]+".*?<span>([^<]*)<\/span>/.exec(await card(days, locale))?.[1];

  it("draws a line with a glyph and the step's name, near the day", async () => {
    const html = await card(1, "ro");
    expect(html).toMatch(/data-testid="calendar-next-away" data-away="tomorrow">.*?<svg[^>]*aria-hidden="true"[^>]*data-testid="TodayIcon".*?<span>Mâine<\/span>/);
    // After the date's line, before the pill and the title.
    expect(html.indexOf("calendar-next-away")).toBeGreaterThan(html.indexOf("septembrie 2026"));
    expect(html.indexOf("calendar-next-away")).toBeLessThan(html.indexOf(`id="calendar-next-title"`));
  });

  it("says «Azi» — without the time again, the card's own time line says the hour", async () => {
    const html = await card(0, "ro");
    expect(html).toContain('data-away="today"');
    expect(await says(0)).toBe("Azi");
    expect(html).toContain("18:30");
    expect(html).not.toContain("Azi, la");
  });

  it("says «Mâine», «Peste 5 zile», «Peste 3 săptămâni» and «Peste 2 luni» in Romanian", async () => {
    expect(await says(1)).toBe("Mâine");
    expect(await says(5)).toBe("Peste 5 zile");
    expect(await says(21)).toBe("Peste 3 săptămâni");
    expect(await says(61)).toBe("Peste 2 luni");
  });

  it("says «Today», «Tomorrow», «In 5 days», «In 3 weeks» and «In 2 months» in English", async () => {
    expect(await says(0, "en")).toBe("Today");
    expect(await says(1, "en")).toBe("Tomorrow");
    expect(await says(5, "en")).toBe("In 5 days");
    expect(await says(21, "en")).toBe("In 3 weeks");
    expect(await says(61, "en")).toBe("In 2 months");
  });

  it("takes Romanian's forms: «Peste 2 zile», «Peste 20 de luni» — and English's plain plural", async () => {
    expect(await says(2)).toBe("Peste 2 zile");
    expect(await says(13)).toBe("Peste 13 zile");
    expect(await says(14)).toBe("Peste 2 săptămâni");
    expect(await says(600)).toBe("Peste 20 de luni");
    expect(await says(600, "en")).toBe("In 20 months");
  });

  it("says «Acum» / «Now» once the event has started", async () => {
    currentLocale = "ro";
    const race = { ...sampleRace("ro"), startsAt: new Date(SAMPLE_NOW.getTime() - 30 * 60_000) };
    const html = renderToStaticMarkup(await NextEventPanel({ event: race, locale: "ro", now: SAMPLE_NOW, weather: null }));
    expect(html).toContain('data-away="now"');
    expect(html).toContain("<span>Acum</span>");
    currentLocale = "en";
    const english = renderToStaticMarkup(await NextEventPanel({ event: { ...race, ...sampleRace("en"), startsAt: race.startsAt }, locale: "en", now: SAMPLE_NOW, weather: null }));
    expect(english).toContain("<span>Now</span>");
  });
});

describe("§834 the cache — the card's words roll with the page at the club's midnight and at the event's start", () => {
  const page = readFileSync(path.join(ROOT, "src/app/[locale]/calendar/page.tsx"), "utf8").replace(/\r\n/g, "\n");

  it("holds the static calendar to the club's next midnight, whatever the look, and the next event's start", () => {
    expect(page).toContain("await holdPageUntil([nextWallMidnight(now, CLUB_TIME_ZONE)], now);");
    expect(page).toContain("await holdPageUntil([event.startsAt], now);");
  });

  it("what the hold does: an event later the same day ends the page's life at its start, a running one at the club's midnight", () => {
    const now = new Date("2026-11-20T08:00:00Z"); // 10:00 in Brașov
    const midnight = nextWallMidnight(now, "Europe/Bucharest");
    const startsAt = new Date(now.getTime() + 3 * 3600_000);
    expect(secondsUntilFirst([midnight, startsAt], now)).toBe(3 * 3600);
    const running = new Date(now.getTime() - 30 * 60_000);
    expect(secondsUntilFirst([midnight, running], now)).toBe(Math.ceil((midnight.getTime() - now.getTime()) / 1000));
  });

  it("gives the card the page's own clock, so the page that is held and the words that roll are one", () => {
    expect(page).toMatch(/<NextEventPanel event=\{next\.event\} locale=\{locale\} now=\{now\}/);
  });

  it("counts the card's days on the club's zone — the zone the page rolls at", () => {
    const card = readFileSync(path.join(ROOT, "src/modules/events/ui/NextEventPanel.tsx"), "utf8");
    expect(card).toContain("awayFrom(event.startsAt, now, CLUB_TIME_ZONE)");
  });
});
