import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CALENDAR_TONES, calendarTone, kindQuery, matchesKind, parseKindChoice } from "@/modules/events/domain/calendar-kind";
import { NO_FILTER } from "@/modules/events/domain/listing-filter";
import { nextCalendarEvent } from "@/modules/events/domain/next-event";
import { liveTwinPathname } from "@/i18n/live-twin";
import { toneDotSx, toneEntrySx } from "@/modules/events/ui/calendar-tone-sx";
import { COLOR, COLOR_DARK } from "@/theme/brand";
import { CALENDAR_TONE_TOKENS } from "@/theme/brand-pairs";
import { UNDER_LOOK, UNDER_LOOK_DARK } from "@/theme/look";

/**
 * The facelift's phase 4 — the calendar under «Aspectul nou» (`docs/REDESIGN.md`): the kind as a
 * filter of the address, the three colours by kind and their tokens, the next-event panel's date,
 * the live twin for a kind, the chips as GET links that keep every other filter, the subscribe
 * box's Outlook row, and the page's rule that with the setting off nothing new is read or drawn.
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
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode; prefetch?: boolean; scroll?: boolean }) => {
    const { prefetch, scroll, ...attributes } = rest;
    void prefetch;
    void scroll;
    return createElement("a", { href, ...attributes }, children);
  },
}));
vi.mock("@/modules/content/member-codes/ui/CopyCodeButton", () => ({
  default: ({ label }: { label: string }) => createElement("button", { "data-stub": "copy" }, label),
}));

const { default: KindChips } = await import("@/modules/events/ui/KindChips");
const { default: SubscribeBox, outlookSubscribeUrl } = await import("@/modules/events/ui/SubscribeBox");
const { default: CalendarLegend, calendarLegendWords } = await import("@/modules/events/ui/CalendarLegend");

afterEach(() => {
  currentLocale = "ro";
});

const ROOT = path.resolve(__dirname, "../../..");
const search = (query: string) => new URLSearchParams(query);
const unescape = (html: string) => html.replace(/&amp;/g, "&");

describe("the kind as a filter of the address", () => {
  it("reads one kind, ignores what names none, and writes it back", () => {
    expect(parseKindChoice({})).toBeNull();
    expect(parseKindChoice({ kind: "weekly" })).toBe("weekly");
    expect(parseKindChoice({ kind: " Special " })).toBe("special");
    expect(parseKindChoice({ kind: "nope" })).toBeNull();
    expect(parseKindChoice({ kind: ["nope", "special", "weekly"] })).toBe("special");
    expect(kindQuery(null)).toEqual({});
    expect(kindQuery("weekly")).toEqual({ kind: "weekly" });
  });

  it("keeps a weekly date for weekly, every other date for special, and every date for none", () => {
    const weekly = { seriesCadence: "WEEKLY" };
    const once = { seriesCadence: null };
    expect(matchesKind(weekly, "weekly")).toBe(true);
    expect(matchesKind(once, "weekly")).toBe(false);
    expect(matchesKind(once, "special")).toBe(true);
    expect(matchesKind({ seriesCadence: "MONTHLY" }, "special")).toBe(true);
    expect(matchesKind(weekly, null) && matchesKind(once, null)).toBe(true);
  });

  it("sends a kind on the calendar to its live twin, and leaves the listing to the CDN", () => {
    expect(liveTwinPathname("/ro/calendar", search("kind=weekly"), false)).toBe("/ro/live/calendar");
    expect(liveTwinPathname("/en/calendar/2026-10", search("kind=special"), false)).toBe("/en/live/calendar/2026-10");
    expect(liveTwinPathname("/ro/calendar/2026-10", search("kind=nope"), false)).toBeNull();
    expect(liveTwinPathname("/ro/events", search("kind=weekly"), false)).toBeNull();
  });
});

describe("three colours by kind", () => {
  it("colours a weekly run pink, a special event green and a social date grey", () => {
    expect(calendarTone({ seriesCadence: "WEEKLY", type: "GROUP_RUN" })).toBe("weekly");
    expect(calendarTone({ seriesCadence: null, type: "RACE" })).toBe("special");
    expect(calendarTone({ seriesCadence: null, type: "HIKE" })).toBe("special");
    expect(calendarTone({ seriesCadence: "MONTHLY", type: "GROUP_RUN" })).toBe("special");
    expect(calendarTone({ seriesCadence: null, type: "COFFEE" })).toBe("other");
    expect(calendarTone({ seriesCadence: null, type: "GEAR_TEST" })).toBe("other");
    // A weekly coffee is a weekly date: the kind first.
    expect(calendarTone({ seriesCadence: "WEEKLY", type: "COFFEE" })).toBe("weekly");
  });

  it("writes every colour under the look's scope only, from the one table, light and dark", () => {
    for (const tone of CALENDAR_TONES) {
      const { fill, ink, dot } = CALENDAR_TONE_TOKENS[tone];
      const entry = toneEntrySx(tone);
      expect(Object.keys(entry)).toEqual([UNDER_LOOK, UNDER_LOOK_DARK]);
      expect(entry[UNDER_LOOK]).toMatchObject({ bgcolor: COLOR[fill], color: COLOR[ink] });
      expect(entry[UNDER_LOOK_DARK]).toMatchObject({ bgcolor: COLOR_DARK[fill], color: COLOR_DARK[ink] });
      const mark = toneDotSx(tone);
      // Off, the dot is not drawn at all.
      expect(mark.display).toBe("none");
      expect(mark[UNDER_LOOK]).toMatchObject({ bgcolor: COLOR[dot] });
    }
  });

  it("says each colour's word in the legend, in both languages", async () => {
    const { getTranslations } = await import("next-intl/server");
    const legend = async () => renderToStaticMarkup(createElement(CalendarLegend, calendarLegendWords(await getTranslations("Events"))));
    const ro = await legend();
    for (const word of ["Alergări săptămânale", "Evenimente speciale", "Alte evenimente"]) expect(ro).toContain(word);
    currentLocale = "en";
    const en = await legend();
    for (const word of ["Weekly runs", "Special events", "Other events"]) expect(en).toContain(word);
  });
});

describe("the next-event panel's date", () => {
  const at = (iso: string, extra: Partial<{ eventStatus: string; id: string }> = {}) => ({ startsAt: new Date(iso), eventStatus: "SCHEDULED", id: iso, ...extra });

  it("is the soonest date still going ahead that the filters let through", () => {
    const rows = [at("2026-10-20T15:00:00Z"), at("2026-10-12T15:00:00Z", { eventStatus: "CANCELLED" }), at("2026-10-14T15:00:00Z"), at("2026-10-13T15:00:00Z", { id: "skip" })];
    expect(nextCalendarEvent(rows, (row) => row.id !== "skip")?.id).toBe("2026-10-14T15:00:00Z");
    expect(nextCalendarEvent(rows, () => false)).toBeNull();
    expect(nextCalendarEvent([], () => true)).toBeNull();
  });
});

describe("KindChips: GET links that keep every other filter", () => {
  it("links each kind and each surface on the period's path, with scripts off", async () => {
    const html = unescape(
      renderToStaticMarkup(await KindChips({ path: "/ro/calendar/2026-10", kind: "weekly", filter: { ...NO_FILTER, type: ["GROUP_RUN"], surface: ["TRAIL"] }, surfaces: ["ASPHALT", "TRAIL"] })),
    );
    // «Toate evenimentele» drops the kind and keeps the panel's ticks.
    expect(html).toContain('href="/ro/calendar/2026-10?type=GROUP_RUN&surface=TRAIL"');
    // A kind is one choice: «Evenimente speciale» replaces «Alergări săptămânale».
    expect(html).toContain('href="/ro/calendar/2026-10?kind=special&type=GROUP_RUN&surface=TRAIL"');
    // A surface ticks and unticks itself, the kind and the rest kept.
    expect(html).toContain('href="/ro/calendar/2026-10?kind=weekly&type=GROUP_RUN&surface=ASPHALT&surface=TRAIL"');
    expect(html).toContain('href="/ro/calendar/2026-10?kind=weekly&type=GROUP_RUN"');
    expect(html.match(/aria-current="page"/g)).toHaveLength(2);
    for (const word of ["Toate evenimentele", "Alergări săptămânale", "Evenimente speciale", "Asfalt", "Trail"]) expect(html).toContain(word);
  });

  it("is the bare period's path when nothing is chosen", async () => {
    currentLocale = "en";
    const html = renderToStaticMarkup(await KindChips({ path: "/en/calendar/2026-10", kind: "special", filter: NO_FILTER, surfaces: [] }));
    expect(html).toContain('href="/en/calendar/2026-10"');
    expect(html).toContain("All events");
  });
});

describe("SubscribeBox", () => {
  it("has a row each for Google, Apple, Outlook and the .ics, and the address to copy, all from APP_BASE_URL", async () => {
    const base = "http://localhost:3000";
    const html = unescape(renderToStaticMarkup(await SubscribeBox({ locale: "ro", baseUrl: base })));
    const feed = `${base}/ro/events/calendar.ics`;
    expect(html).toContain("Vrei să nu ratezi alergările?");
    expect(html).toContain("https://calendar.google.com/calendar/r?cid=");
    expect(html).toContain('href="webcal://localhost:3000/ro/events/calendar.ics"');
    expect(html).toContain(`href="${outlookSubscribeUrl(feed)}"`);
    expect(outlookSubscribeUrl(feed)).toBe(`https://outlook.live.com/calendar/0/addfromweb?url=${encodeURIComponent(feed)}&name=Bra%C8%99ov%20Runners`);
    expect(html).toContain('href="/ro/events/calendar.ics"');
    expect(html).toContain(`value="${feed}"`);
    for (const word of ["Google Calendar", "Apple Calendar", "Outlook Calendar", "Descarcă fișierul .ics"]) expect(html).toContain(word);
  });
});

describe("the calendar page under the look", () => {
  const page = readFileSync(path.join(ROOT, "src/app/[locale]/calendar/page.tsx"), "utf8");

  it("reads the next event only while «Aspectul nou» is on", () => {
    expect(page).toMatch(/const next = look\.on \? await readNextEvent\(/);
  });

  it("keeps one h1, the wordmark before it, and today's intro hidden only under the look", () => {
    expect(page.match(/variant="h1"/g)).toHaveLength(1);
    expect(page.indexOf("<Wordmark />")).toBeLessThan(page.indexOf('variant="h1"'));
    expect(page).toContain("OFF_UNDER_LOOK");
  });

  it("hands the panel the kind as carried ticks and moves the surface to the chips", () => {
    expect(page).toContain("carry={kindQuery(kind)}");
    expect(page).toContain('lookChips={["surface"]}');
  });
});
