import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CALENDAR_TONES, calendarTone, kindQuery, matchesKind, parseKindChoice } from "@/modules/events/domain/calendar-kind";
import { NO_FILTER } from "@/modules/events/domain/listing-filter";
import { nextCalendarEvent } from "@/modules/events/domain/next-event";
import { liveTwinPathname } from "@/i18n/live-twin";
import { legendDotSx, toneDotSx, toneEntrySx } from "@/modules/events/ui/calendar-tone-sx";
import { LOOK_PRIMARY_TOKENS } from "@/modules/appearance/domain/site-look";
import { COLOR, COLOR_DARK, LOOK_ACCENT } from "@/theme/brand";
import { CALENDAR_TONE_TOKENS } from "@/theme/brand-pairs";
import { LOOK_ACCENT_TINT, UNDER_LOOK, UNDER_LOOK_DARK } from "@/theme/look";

/**
 * The facelift's phase 4 — the calendar under «Aspectul nou» (`docs/REDESIGN.md`): the kind as a
 * filter of the address, the three colours by kind and their tokens, the next-event panel's date,
 * the live twin for a kind, the chips as GET links that keep every other filter, the subscribe
 * box's two Outlook rows, and the page's rule that with the setting off nothing new is read or drawn.
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

/**
 * What a tone's token is drawn in under the look: an accent shade as the slot of MUI's primary the
 * setting's stylesheet writes it into (`LOOK_PRIMARY_TOKENS`), the band as `LOOK_ACCENT_TINT`, any
 * other token its own colour in the scheme.
 */
function drawn(token: string, scheme: Record<string, string>): string {
  if (token === "accentTint") return LOOK_ACCENT_TINT;
  const slot = Object.entries(LOOK_PRIMARY_TOKENS.light).find(([key, name]) => key !== "contrastText" && name === token)?.[0];
  return slot ? `primary.${slot}` : scheme[token];
}

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
      expect(entry[UNDER_LOOK]).toMatchObject({ bgcolor: drawn(fill, COLOR), color: drawn(ink, COLOR) });
      expect(entry[UNDER_LOOK_DARK]).toMatchObject({ bgcolor: drawn(fill, COLOR_DARK), color: drawn(ink, COLOR_DARK) });
      const mark = toneDotSx(tone);
      // Off, the dot is not drawn at all.
      expect(mark.display).toBe("none");
      expect(mark[UNDER_LOOK]).toMatchObject({ bgcolor: drawn(dot, COLOR) });
      expect(mark[UNDER_LOOK_DARK]).toMatchObject({ bgcolor: drawn(dot, COLOR_DARK) });
      expect(legendDotSx(tone)).toMatchObject({ bgcolor: drawn(dot, COLOR), [UNDER_LOOK_DARK]: { bgcolor: drawn(dot, COLOR_DARK) } });
    }
  });

  it("draws the weekly runs in the club's accent, through the layout's variables, never in the pink's own colour", () => {
    // The pale band and the hot shade, as the setting's stylesheet writes them, one value for both schemes; the words keep the ink.
    expect(toneEntrySx("weekly")[UNDER_LOOK]).toMatchObject({ bgcolor: LOOK_ACCENT_TINT, color: COLOR.ink });
    expect(toneEntrySx("weekly")[UNDER_LOOK_DARK]).toMatchObject({ bgcolor: LOOK_ACCENT_TINT, color: COLOR_DARK.ink });
    expect(toneDotSx("weekly")[UNDER_LOOK]).toMatchObject({ bgcolor: "primary.light" });
    expect(legendDotSx("weekly").bgcolor).toBe("primary.light");
    // The green and the grey are the platform's: their own tokens, light and dark.
    expect(toneEntrySx("special")[UNDER_LOOK]).toMatchObject({ bgcolor: COLOR.kindSpecial, color: COLOR.kindSpecialInk });
    expect(toneEntrySx("special")[UNDER_LOOK_DARK]).toMatchObject({ bgcolor: COLOR_DARK.kindSpecial, color: COLOR_DARK.kindSpecialInk });
    expect(toneEntrySx("other")[UNDER_LOOK]).toMatchObject({ bgcolor: COLOR.kindOther, color: COLOR.ink });
    expect(toneEntrySx("other")[UNDER_LOOK_DARK]).toMatchObject({ bgcolor: COLOR_DARK.kindOther, color: COLOR_DARK.ink });
    // No tone names a shade of the pink itself, in either scheme: the accent the club chose reaches every entry.
    const pink = [...Object.values(LOOK_ACCENT.pink.light), ...Object.values(LOOK_ACCENT.pink.dark)];
    for (const tone of CALENDAR_TONES) {
      const sx = JSON.stringify([toneEntrySx(tone), toneDotSx(tone), legendDotSx(tone)]);
      for (const hex of pink) expect(sx, `${tone} names ${hex}`).not.toContain(hex);
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

  it("is one scrolling row with its scrollbar shown, and the chips are ChipLink's own small pills (§720 amended)", async () => {
    const html = renderToStaticMarkup(await KindChips({ path: "/ro/calendar/2026-10", kind: null, filter: NO_FILTER, surfaces: ["TRAIL"] }));
    expect(html).toContain('data-testid="calendar-kind-chips"');
    expect(html).toContain('role="group"');
    const source = readFileSync(path.join(ROOT, "src/modules/events/ui/KindChips.tsx"), "utf8");
    expect(source).toContain("<ScrollRow");
    expect(source).not.toMatch(/scrollbarWidth: "none"|height: 32/);
    // Smaller on a phone only (§734, amending §733): every pill value names `sm` as MUI's small chip, 24 pixels.
    expect(source).toContain('height: { xs: "20px", sm: "24px" }');
  });

  it("is the bare period's path when nothing is chosen", async () => {
    currentLocale = "en";
    const html = renderToStaticMarkup(await KindChips({ path: "/en/calendar/2026-10", kind: "special", filter: NO_FILTER, surfaces: [] }));
    expect(html).toContain('href="/en/calendar/2026-10"');
    expect(html).toContain("All events");
  });
});

describe("SubscribeBox", () => {
  const base = "http://localhost:3000";
  const feed = `${base}/ro/events/calendar.ics`;

  it("has a row each for Google, Apple, Outlook (both kinds of account) and the .ics, and the address to copy, all from APP_BASE_URL", async () => {
    const html = unescape(renderToStaticMarkup(await SubscribeBox({ locale: "ro", baseUrl: base })));
    expect(html).toContain("Vrei să nu ratezi alergările?");
    expect(html).toContain("https://calendar.google.com/calendar/r?cid=");
    expect(html).toContain('href="webcal://localhost:3000/ro/events/calendar.ics"');
    expect(html).toContain(`href="${outlookSubscribeUrl(feed, "personal")}"`);
    expect(html).toContain(`href="${outlookSubscribeUrl(feed, "work")}"`);
    expect(html).toContain('data-testid="subscribe-outlook"');
    expect(html).toContain('data-testid="subscribe-outlook-work"');
    expect(html).toContain('href="/ro/events/calendar.ics"');
    expect(html).toContain(`value="${feed}"`);
    for (const word of ["Google Calendar", "Apple Calendar", "Outlook.com (cont personal)", "Outlook la serviciu sau la școală", "Descarcă fișierul .ics"]) expect(html).toContain(word);
  });

  it("sends Outlook on the web the feed as webcal://, with the slash after addfromweb (the add-to-calendar-button format; no test can open it: outlook.com refuses robots)", () => {
    for (const [account, host] of [
      ["personal", "outlook.live.com"],
      ["work", "outlook.office.com"],
    ] as const) {
      const url = new URL(outlookSubscribeUrl(feed, account));
      expect(url.host).toBe(host);
      expect(url.pathname).toBe("/calendar/0/addfromweb/");
      expect(url.searchParams.get("url")).toBe("webcal://localhost:3000/ro/events/calendar.ics");
      expect(url.searchParams.get("name")).toBe("Brașov Runners");
    }
    expect(outlookSubscribeUrl(feed, "personal")).toBe(
      "https://outlook.live.com/calendar/0/addfromweb/?url=webcal%3A%2F%2Flocalhost%3A3000%2Fro%2Fevents%2Fcalendar.ics&name=Bra%C8%99ov%20Runners",
    );
  });

  it("speaks of its own rows under the address, never of an «Apple / Outlook» button it does not have", async () => {
    for (const [locale, hint] of [
      ["ro", "Aplicația Outlook de pe telefon nu adaugă"],
      ["en", "The Outlook phone app cannot add"],
    ] as const) {
      currentLocale = locale;
      const html = renderToStaticMarkup(await SubscribeBox({ locale, baseUrl: base }));
      expect(html).toContain(hint);
      expect(html).not.toContain("Apple / Outlook");
    }
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
