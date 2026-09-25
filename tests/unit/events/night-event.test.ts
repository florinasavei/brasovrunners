import { readFileSync } from "node:fs";
import { createElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createTranslator } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { calendarDayWords } from "@/i18n/dates";
import { courseSummary, nightSummary, type SummaryWords } from "@/modules/content/events/ui/box-summaries";
import { nightChoiceOf, nightEvent, nightOverrideFromChoice, nightShape } from "@/modules/events/domain/night";
import { DEFAULT_CLUB_COORDINATES, isNightEvent, localDay, parseCoordinates, sunTimes, wallClockTime } from "@/modules/events/domain/sun";
import { fromWallTimeInput } from "@/modules/events/domain/zoned-time";
import { clubNightEvent, nightLine, nightTooltip } from "@/modules/events/night-event";
import { calendarDescription, type CalendarEvent, type CalendarLabels } from "@/modules/events/ical";
import type { PublicEvent } from "@/modules/events/repository";
import { orderRoutePills, type Pill } from "@/modules/events/ui/route-pills";
import { buildTemplateContent, type TemplateData } from "@/modules/notifications/templates";

/**
 * BR-REQ-020-01, BR-REQ-050-02, the reminder and the calendar file (`DECISIONS.md` §394, replacing
 * §382's "Necesită frontală" checkbox) — the night event, computed from the sunset.
 *
 * The owner, 2026-09-25: "«Necesită frontală» ar trebui să fie cumva «eveniment de noapte» setat
 * automat în funcție de ora de start și când apune soarele."
 *
 * - the sun (NOAA's algorithm, `sun.ts`) against published sunrise and sunset tables, and the
 *   boundaries of "night": civil dusk and civil dawn of the start's own day, on its own clock;
 * - the override before the sun, and the editor's three choices both ways;
 * - the words: the pill and its tooltip on the card, the page and the hero; the calendar entry;
 *   the `.ics`; the reminder's line; the closed card's summary; the editor's automatic line.
 */
let currentLocale: "ro" | "en" = "ro";

vi.mock("next-intl/server", async () => {
  const { createFormatter, createTranslator } = await import("next-intl");
  const roMessages = (await import("../../../messages/ro.json")).default;
  const enMessages = (await import("../../../messages/en.json")).default;
  return {
    getTranslations: async (namespace: string) =>
      createTranslator({ locale: currentLocale, messages: currentLocale === "ro" ? roMessages : enMessages, namespace: namespace as "Event" }),
    getFormatter: async () => createFormatter({ locale: currentLocale, timeZone: "Europe/Bucharest" }),
    getLocale: async () => currentLocale,
  };
});

// The tooltip writes its title into the markup, so what it would say can be read from a static render.
vi.mock("@mui/material/Tooltip", async () => {
  const react = await import("react");
  return {
    default: ({ title, children }: { title: ReactNode; children: ReactElement }) =>
      react.createElement("span", { "data-tooltip": "" }, react.createElement("span", { "data-tooltip-title": "" }, title), children),
  };
});

const { default: EventFacts } = await import("@/modules/events/ui/EventFacts");
const { default: CalendarEventChip } = await import("@/modules/events/ui/CalendarEventChip");
const { default: EventCalendar } = await import("@/modules/events/ui/EventCalendar");
const { GLYPHS } = await import("@/modules/events/ui/glyphs");
const { default: FlashlightOnIcon } = await import("@mui/icons-material/FlashlightOn");
const { nightAutoLine } = await import("@/modules/content/events/ui/NightEventField");

afterEach(() => {
  currentLocale = "ro";
});

const ZONE = "Europe/Bucharest";
const BRASOV = DEFAULT_CLUB_COORDINATES;
const NOW = new Date("2026-09-24T09:00:00Z");
/** A Wednesday in November at 19:00 in Brașov: an hour and three quarters after dusk. */
const NOVEMBER_19 = new Date("2026-11-18T17:00:00Z");
/** The same Wednesday run in June: nearly three hours before dusk. */
const JUNE_19 = new Date("2027-06-16T16:00:00Z");

/** Minutes between two "HH:mm" wall-clock readings. */
const minutes = (a: string, b: string) => {
  const [ah, am] = a.split(":").map(Number);
  const [bh, bm] = b.split(":").map(Number);
  return Math.abs(ah * 60 + am - (bh * 60 + bm));
};
const at = (wall: string, zone = ZONE) => fromWallTimeInput(wall, zone)!;

describe("§394 the sun — NOAA's algorithm against published tables, within five minutes", () => {
  /*
    References: timeanddate.com's tables (which follow the same NOAA/USNO definitions: the upper limb
    on the horizon, with refraction) for Bucharest and London, and NOAA's own Solar Calculator for
    Brașov. The brief quoted "≈ 21:03 / 05:31" for Brașov's solstice — those are Bucharest's, a
    degree and a quarter further south; Brașov's own are seven minutes later in the evening.
  */
  it.each([
    ["Bucharest, the June solstice", { latitude: 44.4268, longitude: 26.1025 }, "2026-06-21", ZONE, "05:31", "21:03"],
    ["Bucharest, the December solstice", { latitude: 44.4268, longitude: 26.1025 }, "2026-12-21", ZONE, "07:49", "16:39"],
    ["London, the June solstice", { latitude: 51.5074, longitude: -0.1278 }, "2026-06-21", "Europe/London", "04:43", "21:21"],
    ["Brașov, the June solstice", BRASOV, "2026-06-21", ZONE, "05:28", "21:10"],
    ["Brașov, the December solstice", BRASOV, "2026-12-21", ZONE, "07:55", "16:36"],
  ])("%s", (_name, place, day, zone, sunrise, sunset) => {
    const sun = sunTimes(day, place)!;
    expect(minutes(wallClockTime(sun.sunrise!, zone), sunrise)).toBeLessThanOrEqual(5);
    expect(minutes(wallClockTime(sun.sunset!, zone), sunset)).toBeLessThanOrEqual(5);
  });

  it("puts civil dawn before sunrise and civil dusk after sunset, about half an hour apart at Brașov", () => {
    for (const day of ["2026-03-20", "2026-06-21", "2026-09-23", "2026-12-21"]) {
      const sun = sunTimes(day, BRASOV)!;
      const dawnGap = (sun.sunrise!.getTime() - sun.civilDawn!.getTime()) / 60_000;
      const duskGap = (sun.civilDusk!.getTime() - sun.sunset!.getTime()) / 60_000;
      for (const gap of [dawnGap, duskGap]) {
        expect(gap).toBeGreaterThan(25);
        expect(gap).toBeLessThan(45);
      }
    }
  });

  it("reads the day on the event's clock, through the zone's own rules — never a fixed offset", () => {
    // 19:00 on the last Saturday of October is UTC+3; 19:00 the next day is UTC+2.
    expect(at("2026-10-24T19:00").toISOString()).toBe("2026-10-24T16:00:00.000Z");
    expect(at("2026-10-25T19:00").toISOString()).toBe("2026-10-25T17:00:00.000Z");
    // 01:30 on the 19th in Brașov is still the 18th in UTC: the day is the wall clock's.
    expect(localDay(at("2026-11-19T01:30"), ZONE)).toBe("2026-11-19");
    // The sunset of 25 October is printed in winter time, the day before in summer time.
    expect(wallClockTime(sunTimes("2026-10-24", BRASOV)!.sunset!, ZONE)).toMatch(/^18:/);
    expect(wallClockTime(sunTimes("2026-10-25", BRASOV)!.sunset!, ZONE)).toMatch(/^17:/);
  });

  it("answers a day with no sunset: the polar summer is never dark, the polar winter always", () => {
    const svalbard = { latitude: 78.22, longitude: 15.65 };
    expect(sunTimes("2026-06-21", svalbard)).toMatchObject({ sunset: null, civilDusk: null, alwaysLight: true, alwaysDark: false });
    expect(isNightEvent(new Date("2026-06-21T22:00:00Z"), svalbard, "Arctic/Longyearbyen")).toBe(false);
    expect(isNightEvent(new Date("2026-12-21T11:00:00Z"), svalbard, "Arctic/Longyearbyen")).toBe(true);
  });

  it("refuses a string that is not a day", () => {
    expect(sunTimes("2026-02-31", BRASOV)).toBeNull();
    expect(sunTimes("", BRASOV)).toBeNull();
  });
});

describe("§394 the line: civil dusk to civil dawn of the start's own day", () => {
  const november = sunTimes("2026-11-18", BRASOV)!;

  it("is night from the minute of civil dusk, and not a minute before", () => {
    const dusk = november.civilDusk!;
    expect(isNightEvent(dusk, BRASOV, ZONE)).toBe(true);
    expect(isNightEvent(new Date(dusk.getTime() - 60_000), BRASOV, ZONE)).toBe(false);
    // Twenty minutes after sunset is still civil twilight: a run then does not count.
    expect(isNightEvent(new Date(november.sunset!.getTime() + 20 * 60_000), BRASOV, ZONE)).toBe(false);
  });

  it("is night before civil dawn, and day from it", () => {
    const dawn = november.civilDawn!;
    expect(isNightEvent(new Date(dawn.getTime() - 60_000), BRASOV, ZONE)).toBe(true);
    expect(isNightEvent(dawn, BRASOV, ZONE)).toBe(false);
  });

  it("the Wednesday 19:00 run: night in November and December, day in June and on 7 October", () => {
    expect(isNightEvent(NOVEMBER_19, BRASOV, ZONE)).toBe(true);
    expect(isNightEvent(at("2026-12-16T19:00"), BRASOV, ZONE)).toBe(true);
    expect(isNightEvent(JUNE_19, BRASOV, ZONE)).toBe(false);
    expect(isNightEvent(at("2026-10-07T19:00"), BRASOV, ZONE)).toBe(false);
  });

  it("a start with no time is never a night event", () => {
    expect(isNightEvent(null, BRASOV, ZONE)).toBe(false);
    expect(isNightEvent(new Date(Number.NaN), BRASOV, ZONE)).toBe(false);
  });
});

describe("§394 the club's place — CLUB_COORDINATES", () => {
  it("reads «latitude,longitude» and refuses anything else", () => {
    expect(parseCoordinates("45.6427,25.5887")).toEqual({ latitude: 45.6427, longitude: 25.5887 });
    expect(parseCoordinates(" -33.9 , 18.42 ")).toEqual({ latitude: -33.9, longitude: 18.42 });
    for (const bad of ["", "45.6427", "45,6427;25,5887", "91,0", "0,181", "Brașov"]) expect(parseCoordinates(bad), bad).toBeNull();
  });

  it("defaults to Brașov's centre when unset", async () => {
    const { envSchema } = await import("@/shared/config/env");
    expect(envSchema.parse({}).CLUB_COORDINATES).toEqual(BRASOV);
    expect(envSchema.parse({ CLUB_COORDINATES: "44.4268,26.1025" }).CLUB_COORDINATES).toEqual({ latitude: 44.4268, longitude: 26.1025 });
    expect(() => envSchema.parse({ CLUB_COORDINATES: "Brașov" })).toThrow(/CLUB_COORDINATES/);
  });
});

describe("§394 nightEvent — the override before the sun", () => {
  it("«Automat» (null) is the sun's answer, with the day's sunset", () => {
    expect(nightEvent({ nightOverride: null, timezone: ZONE }, NOVEMBER_19, BRASOV)).toEqual({
      night: true,
      source: "automatic",
      start: "19:00",
      sunset: "16:44",
      sunrise: "07:20",
      endSource: null,
      end: null,
    });
    expect(nightEvent({ nightOverride: null, timezone: ZONE }, JUNE_19, BRASOV)).toMatchObject({ night: false, source: "automatic" });
  });

  it("«Da» is a night event in June and «Nu» is none in November, the sunset still said", () => {
    expect(nightEvent({ nightOverride: true, timezone: ZONE }, JUNE_19, BRASOV)).toMatchObject({ night: true, source: "override" });
    expect(nightEvent({ nightOverride: false, timezone: ZONE }, NOVEMBER_19, BRASOV)).toEqual({
      night: false,
      source: "override",
      start: "19:00",
      sunset: "16:44",
      sunrise: "07:20",
      endSource: null,
      end: null,
    });
  });

  it("the editor's three choices and the column, both ways", () => {
    expect([true, false, null, undefined].map(nightChoiceOf)).toEqual(["yes", "no", "auto", "auto"]);
    expect(["yes", "no", "auto", "", null, "on"].map(nightOverrideFromChoice)).toEqual([true, false, null, null, null, null]);
  });
});

/** "Running up that hill": a Wednesday evening on the Tâmpa, 19:00 in Brașov, in November. */
function event(overrides: Partial<PublicEvent> = {}): PublicEvent {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    type: "GROUP_RUN",
    surface: "TRAIL",
    eventStatus: "SCHEDULED",
    startsAt: NOVEMBER_19,
    endsAt: null,
    raceStartsAt: null,
    timezone: ZONE,
    mapUrl: null,
    routeUrl: null,
    stravaEventUrl: null,
    facebookEventUrl: null,
    coHosts: null,
    coHostName: null,
    coHostUrl: null,
    featured: false,
    isSpecial: false,
    distanceMeters: 8000,
    elevationGainMeters: 250,
    nightOverride: null,
    registrationMode: "NONE",
    registrationOpensAt: null,
    registrationClosesAt: null,
    externalRegistrationUrl: null,
    externalProvider: null,
    minAge: 14,
    slug: "running-up-that-hill",
    title: "Running up that hill",
    excerpt: null,
    locationName: "Stația de telecabină Tâmpa",
    locationAddress: null,
    locationToBeAnnounced: false,
    difficulty: "MODERATE",
    costType: "FREE",
    costAmount: null,
    costUrl: null,
    publishedAt: NOW,
    ...overrides,
  } as PublicEvent;
}

const withoutStyles = (html: string) => html.replace(/<style[^>]*>[\s\S]*?<\/style>/g, "");
const text = (fragment: string) => fragment.replace(/<[^>]+>/g, "");

/** Every chip's label, in order. */
function pillLabels(fragment: string): string[] {
  return [...withoutStyles(fragment).matchAll(/class="MuiChip-label[^"]*"[^>]*>([^<]*)</g)].map((match) => match[1]);
}
/** Every tooltip's words, in order. */
function tooltips(fragment: string): string[] {
  return [...withoutStyles(fragment).matchAll(/data-tooltip-title="">([^<]*)</g)].map((match) => match[1]);
}

/** The `<dl>`'s rows: each label with its `<dd>` markup. */
function rows(html: string) {
  return [...withoutStyles(html).matchAll(/<dt\b[^>]*>([\s\S]*?)<\/dt><dd\b[^>]*>([\s\S]*?)<\/dd>/g)].map(([, dt, dd]) => ({ label: text(dt), dd }));
}

describe("§394 orderRoutePills — the night event where §382 put the headlamp", () => {
  const surface: Pill = { glyph: "surface:TRAIL", label: "Trail" };
  const difficulty: Pill = { glyph: "difficulty:MODERATE", label: "Mediu" };
  const distance: Pill = { glyph: "distance", label: "8 km" };
  const elevation: Pill = { glyph: "elevation", label: "250 m D+" };
  const night: Pill = { glyph: "headlamp", label: "Eveniment de noapte", tooltip: "Soarele apune la 16:44" };

  it("surface, difficulty, distance, elevation, then the night event — whatever order it is handed in", () => {
    expect(orderRoutePills({ headlamp: night, elevation, distance, difficulty, surface })).toEqual([surface, difficulty, distance, elevation, night]);
  });

  it("keeps its place when the numbers are missing, and is absent when not handed", () => {
    expect(orderRoutePills({ headlamp: night, surface })).toEqual([surface, night]);
    expect(orderRoutePills({ surface, elevation, headlamp: null })).toEqual([surface, elevation]);
  });

  it("keeps the headlamp's glyph, one file from @mui/icons-material", () => {
    expect(GLYPHS.headlamp).toBe(FlashlightOnIcon);
  });
});

describe("§394 the event page's facts", () => {
  // `event()` defaults to `type: "GROUP_RUN"` (§394), so its pill is «Alergare de noapte».
  it("puts «Alergare de noapte» last in the route's pills, with the headlamp and the sunset in its tooltip", async () => {
    const html = renderToStaticMarkup(await EventFacts({ event: event(), now: NOW, stacked: true }));
    const route = rows(html).find((row) => row.label === "Traseu");
    expect(route).toBeDefined();
    expect(pillLabels(route!.dd)).toEqual(["Trail", "Mediu", "8 km", "250 m D+", "Alergare de noapte"]);
    expect(tooltips(route!.dd)).toEqual(["Soarele apune la 16:44"]);
    expect(route!.dd).toContain('data-testid="FlashlightOnIcon"');
    expect(pillLabels(rows(html).find((row) => row.label === "Cost")!.dd)).toEqual(["Gratuit"]);
  });

  it("says «Night run» and «The sun sets at 16:44» in English", async () => {
    currentLocale = "en";
    const html = renderToStaticMarkup(await EventFacts({ event: event(), now: NOW, stacked: true }));
    const route = rows(html).find((row) => row.label === "Route")!;
    expect(pillLabels(route.dd)).toEqual(["Trail", "Moderate", "8 km", "250 m climb", "Night run"]);
    expect(tooltips(route.dd)).toEqual(["The sun sets at 16:44"]);
  });

  it("says «Eveniment de noapte» on every other type", async () => {
    const html = renderToStaticMarkup(await EventFacts({ event: event({ type: "RACE" }), now: NOW, stacked: true }));
    expect(pillLabels(rows(html).find((row) => row.label === "Traseu")!.dd)).toContain("Eveniment de noapte");
  });

  it("makes a route row on its own when it is the only fact of the route — it is not the overline again", async () => {
    const html = renderToStaticMarkup(
      await EventFacts({ event: event({ distanceMeters: null, elevationGainMeters: null, difficulty: null }), now: NOW, stacked: true }),
    );
    expect(pillLabels(rows(html).find((row) => row.label === "Traseu")!.dd)).toEqual(["Trail", "Alergare de noapte"]);
  });

  it("shows nothing on the June date, and shows it on the June date the organizer said «Da» for", async () => {
    const june = renderToStaticMarkup(await EventFacts({ event: event({ startsAt: JUNE_19 }), now: NOW, stacked: true }));
    expect(june).not.toContain("Alergare de noapte");
    expect(june).not.toContain("FlashlightOnIcon");
    const yes = renderToStaticMarkup(await EventFacts({ event: event({ startsAt: JUNE_19, nightOverride: true }), now: NOW, stacked: true }));
    expect(pillLabels(yes)).toContain("Alergare de noapte");
    expect(tooltips(yes)[0]).toMatch(/^Soarele apune la 21:\d\d$/);
    const no = renderToStaticMarkup(await EventFacts({ event: event({ nightOverride: false }), now: NOW, stacked: true }));
    expect(no).not.toContain("Alergare de noapte");
  });
});

describe("§394 the listing card and the hero", () => {
  it("the card's pills: the route, the night run, then the cost", async () => {
    const html = renderToStaticMarkup(await EventFacts({ event: event(), now: NOW, variant: "compact" }));
    expect(pillLabels(html)).toEqual(["Trail", "Mediu", "8 km", "250 m D+", "Alergare de noapte", "Gratuit"]);
    expect(html).toContain('data-testid="FlashlightOnIcon"');
  });

  it("the card in English, and nothing on a day date", async () => {
    currentLocale = "en";
    expect(pillLabels(renderToStaticMarkup(await EventFacts({ event: event(), now: NOW, variant: "compact" })))).toContain("Night run");
    const day = renderToStaticMarkup(await EventFacts({ event: event({ startsAt: JUNE_19 }), now: NOW, variant: "compact" }));
    expect(day).not.toContain("Night run");
    expect(day).not.toContain("FlashlightOnIcon");
  });

  it("the hero's route line says it after the climb and before the cost, with its glyph", async () => {
    const html = withoutStyles(renderToStaticMarkup(await EventFacts({ event: event(), now: NOW })));
    const route = text(rows(html).find((row) => row.label === "Traseu")!.dd);
    expect(route.indexOf("250 m diferență de nivel")).toBeLessThan(route.indexOf("Alergare de noapte"));
    expect(route.indexOf("Alergare de noapte")).toBeLessThan(route.indexOf("Gratuit"));
    expect(html).toContain('data-testid="FlashlightOnIcon"');
    const day = renderToStaticMarkup(await EventFacts({ event: event({ startsAt: JUNE_19 }), now: NOW }));
    expect(day).not.toContain("Alergare de noapte");
  });
});

describe("§394 the calendar entry names it after the place, with the sunset", () => {
  function chip(values: Partial<Parameters<typeof CalendarEventChip>[0]> = {}) {
    return renderToStaticMarkup(
      createElement(CalendarEventChip, {
        href: "/ro/evenimente/running-up-that-hill",
        time: "19:00",
        title: "Running up that hill",
        glyphs: ["type:GROUP_RUN", "surface:TRAIL"],
        filled: false,
        cancelled: false,
        note: null,
        partner: null,
        dense: true,
        ...values,
      }),
    );
  }

  it("the tooltip's lines: the time and title, the place's note, the night event, the partner", () => {
    const moved = { kind: "moved" as const, text: "Nu în locul obișnuit: Stația de telecabină Tâmpa" };
    const html = chip({ note: moved, night: "Eveniment de noapte: începe la 19:00, apusul la 16:44", partner: "Colaborare" });
    const tooltip = html.slice(html.indexOf("data-tooltip-title"), html.indexOf("<a "));
    const lines = [...tooltip.matchAll(/<span class="[^"]*">([^<]+)<\/span>/g)].map((match) => match[1]);
    expect(lines).toEqual(["19:00 Running up that hill", moved.text, "Eveniment de noapte: începe la 19:00, apusul la 16:44", "Colaborare"]);
  });

  // The fixture is a group run: «Alergare de noapte» in the month view too, as on its card (§394).
  it("the calendar hands each date its own answer, in the reader's language", async () => {
    for (const [locale, words] of [
      ["ro", "Alergare de noapte: începe la 19:00, după apusul de la 16:44"],
      ["en", "Night run: starts at 19:00, after the 16:44 sunset"],
    ] as const) {
      currentLocale = locale;
      const html = renderToStaticMarkup(
        await EventCalendar({
          view: { kind: "month", month: { year: 2026, month: 11 } },
          events: [
            event(),
            // A Sunday morning run in the same month: daylight, no line.
            event({ id: "22222222-2222-2222-2222-222222222222", slug: "duminica", title: "Duminică dimineața", startsAt: at("2026-11-15T09:00") }),
          ],
          now: NOW,
          layout: "grid",
        }),
      );
      const anchors = [...html.matchAll(/<a [^>]*aria-label="([^"]*)"[^>]*>/g)].map((match) => match[1]);
      expect(anchors).toContain(`19:00 Running up that hill. ${words}`);
      expect(anchors).toContain("09:00 Duminică dimineața");
    }
  });
});

describe("§394 the calendar file's description", () => {
  function translator(catalogue: { Event: Record<string, unknown> }): CalendarLabels["t"] {
    return (key, values) => {
      const message = key.split(".").reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], catalogue.Event);
      if (typeof message !== "string") throw new Error(`missing Event.${key}`);
      return Object.entries(values ?? {}).reduce((out, [name, value]) => out.replaceAll(`{${name}}`, String(value)), message);
    };
  }
  const calendarEvent: CalendarEvent = {
    id: "11111111-1111-1111-1111-111111111111",
    title: "Running up that hill",
    startsAt: NOVEMBER_19,
    endsAt: null,
    timezone: ZONE,
    locationName: "Stația de telecabină Tâmpa",
    excerpt: null,
    scheduleJson: null,
    distanceMeters: 8000,
    url: "https://example.test/ro/evenimente/running-up-that-hill",
    updatedAt: null,
    nightOverride: null,
  };

  it("carries the night event on a line of its own under the facts, in the reader's language", () => {
    const roLines = calendarDescription(calendarEvent, { locale: "ro", t: translator(ro) }).split("\n");
    const line = "Eveniment de noapte: începe la 19:00, după apusul de la 16:44 — ia o frontală";
    expect(roLines).toContain(line);
    expect(roLines.indexOf(line)).toBe(roLines.findIndex((entry) => entry.includes("8 km")) + 1);
    expect(calendarDescription(calendarEvent, { locale: "en", t: translator(en) }).split("\n")).toContain("Night event: starts at 19:00, after the 16:44 sunset — bring a headlamp");
  });

  it("says nothing on a day date, nor on a night the organizer said «Nu» for; «Da» in June says it", () => {
    expect(calendarDescription({ ...calendarEvent, startsAt: JUNE_19 }, { locale: "ro", t: translator(ro) })).not.toContain("Eveniment de noapte");
    expect(calendarDescription({ ...calendarEvent, nightOverride: false }, { locale: "en", t: translator(en) })).not.toContain("Night event");
    expect(calendarDescription({ ...calendarEvent, startsAt: JUNE_19, nightOverride: true }, { locale: "ro", t: translator(ro) })).toMatch(
      /Eveniment de noapte: începe la 19:00, apusul la 21:\d\d — ia o frontală/,
    );
  });
});

describe("§394 the reminder's line", () => {
  const base: TemplateData = { participantName: "Ana", eventTitle: "Running up that hill" };
  const paragraphs = (locale: "ro" | "en", data: TemplateData, overrides?: Parameters<typeof buildTemplateContent>[4]) =>
    buildTemplateContent("EVENT_REMINDER", locale, data, undefined, overrides).paragraphs.join("\n");

  it("says the sunset and to bring a light, in each language, only when the renderer set it", () => {
    expect(paragraphs("ro", { ...base, nightEventSunset: "16:44" })).toContain("Eveniment de noapte: apusul la 16:44. Ia o frontală.");
    expect(paragraphs("en", { ...base, nightEventSunset: "16:44" })).toContain("Night event: sunset at 16:44. Bring a headlamp.");
    expect(paragraphs("ro", base)).not.toContain("Eveniment de noapte");
    expect(paragraphs("ro", { ...base, nightEventSunset: "" })).toContain("Eveniment de noapte: ia o frontală.");
  });

  it("survives the club's own words for the reminder — a fact about the date, not a matter of style", () => {
    const overrides = { "EVENT_REMINDER:ro": { subject: "Pe curând", paragraphs: ["Ne vedem la start."] } };
    const text = paragraphs("ro", { ...base, nightEventSunset: "16:44" }, overrides);
    expect(text).toContain("Ne vedem la start.");
    expect(text).toContain("Eveniment de noapte: apusul la 16:44. Ia o frontală.");
  });

  it("is never on another message, even when handed the field", () => {
    const confirmed = buildTemplateContent("REGISTRATION_CONFIRMED", "ro", { ...base, nightEventSunset: "16:44" }, undefined).paragraphs.join("\n");
    expect(confirmed).not.toContain("Eveniment de noapte");
  });

  it("«Alergare de noapte» on a group run — the owner calls a run a run (§394)", () => {
    expect(paragraphs("ro", { ...base, nightEventSunset: "16:44", nightEventIsGroupRun: true })).toContain("Alergare de noapte: apusul la 16:44. Ia o frontală.");
    expect(paragraphs("en", { ...base, nightEventSunset: "16:44", nightEventIsGroupRun: true })).toContain("Night run: sunset at 16:44. Bring a headlamp.");
    // Every other type keeps "Eveniment de noapte" / "Night event" (already proven above).
    expect(paragraphs("ro", { ...base, nightEventSunset: "16:44", nightEventIsGroupRun: false })).toContain("Eveniment de noapte: apusul la 16:44. Ia o frontală.");
  });
});

describe("§394 the editor: the closed card's word and the automatic line", () => {
  const roWords = ro.Admin.editor.boxes.summary as SummaryWords;
  const enWords = en.Admin.editor.boxes.summary as SummaryWords;

  it("«de noapte (automat)», «de noapte», «de zi» — and «de zi (automat)» for an automatic day (§394)", () => {
    expect(nightSummary(roWords, null, true)).toBe("de noapte (automat)");
    expect(nightSummary(roWords, true, false)).toBe("de noapte");
    expect(nightSummary(roWords, false, true)).toBe("de zi");
    expect(nightSummary(roWords, null, false)).toBe("de zi (automat)");
    expect([nightSummary(enWords, null, true), nightSummary(enWords, true, false), nightSummary(enWords, false, true), nightSummary(enWords, null, false)]).toEqual([
      "night (automatic)",
      "night",
      "day",
      "day (automatic)",
    ]);
  });

  it("in the «Traseul» card's line, after the climb", () => {
    const course = { distanceMeters: 8000, elevationGainMeters: 250, routeUrl: null, nightOverride: null };
    expect(courseSummary(roWords, course, { surface: "Trail", difficulty: "Mediu", night: true })).toBe("Trail · Mediu · 8 km · +250 m · de noapte (automat)");
    expect(courseSummary(roWords, { ...course, nightOverride: false }, { surface: null, difficulty: null, night: true })).toBe("8 km · +250 m · de zi");
    // §394 nit: the closed card names an automatic daytime date too, not just an automatic night one.
    expect(courseSummary(roWords, course, { surface: null, difficulty: null, night: false })).toBe("8 km · +250 m · de zi (automat)");
  });

  const lineWords = (catalogue: typeof ro | typeof en, locale: string) => ({
    autoLine: catalogue.Admin.editor.night.autoLine,
    autoLineDawn: catalogue.Admin.editor.night.autoLineDawn,
    autoLineNoTime: catalogue.Admin.editor.night.autoLineNoTime,
    autoLineNoDate: catalogue.Admin.editor.night.autoLineNoDate,
    verdictNight: catalogue.Admin.editor.night.verdictNight,
    verdictDay: catalogue.Admin.editor.night.verdictDay,
    endLine: catalogue.Admin.editor.night.endLine,
    endLineProgramme: catalogue.Admin.editor.night.endLineProgramme,
    day: calendarDayWords(locale),
  });

  it("the automatic line for the date and time in the form, in both languages — the same sun as the pill", () => {
    const november = { date: "2026-11-18", time: "19:00", timeZone: ZONE };
    expect(nightAutoLine(lineWords(ro, "ro"), november, BRASOV).line).toBe("Automat: pe mie., 18 nov. 2026, începe la 19:00, apusul la 16:44 — eveniment de noapte");
    expect(nightAutoLine(lineWords(en, "en"), november, BRASOV).line).toBe("Automatic: on Wed, 18 Nov 2026, starts at 19:00, sunset at 16:44 — a night event");
    expect(nightAutoLine(lineWords(ro, "ro"), { date: "2027-06-16", time: "19:00", timeZone: ZONE }, BRASOV).line).toMatch(
      /^Automat: pe mie\., 16 iun\. 2027, începe la 19:00, apusul la 21:\d\d — nu e eveniment de noapte$/,
    );
  });

  it("a 05:30 January start names that day's sunrise, never the evening's sunset, in both languages (§404)", () => {
    const january = { date: "2027-01-13", time: "05:30", timeZone: ZONE };
    expect(nightAutoLine(lineWords(ro, "ro"), january, BRASOV).line).toBe(
      "Automat: pe mie., 13 ian. 2027, începe la 05:30, înainte de răsăritul de la 07:55 — eveniment de noapte",
    );
    expect(nightAutoLine(lineWords(en, "en"), january, BRASOV).line).toBe(
      "Automatic: on Wed, 13 Jan 2027, starts at 05:30, before sunrise at 07:55 — a night event",
    );
    // After sunrise the same morning is a day date, and the ordinary line names the sunset.
    expect(nightAutoLine(lineWords(ro, "ro"), { ...january, time: "09:00" }, BRASOV).line).toBe(
      "Automat: pe mie., 13 ian. 2027, începe la 09:00, apusul la 16:57 — nu e eveniment de noapte",
    );
  });

  it("asks for the time when there is only a date, and for the date when there is none", () => {
    expect(nightAutoLine(lineWords(ro, "ro"), { date: "2026-11-18", time: "", timeZone: ZONE }, BRASOV).line).toBe(
      "Automat: pe mie., 18 nov. 2026, apusul la 16:44 — alege ora startului",
    );
    expect(nightAutoLine(lineWords(en, "en"), { date: "", time: "19:00", timeZone: ZONE }, BRASOV).line).toBe(en.Admin.editor.night.autoLineNoDate);
  });

  // §394 — the owner, 2026-09-25: the start AND the end decide; a run that starts in daylight
  // and finishes after dusk is a night run. Three cases: dark at the start, dark only at the end
  // (the end alone decides), and light throughout.
  describe("the span, not the start alone, decides (§394)", () => {
    // 21:00 in Brașov in June is well after civil dusk: dark at the start already.
    it("dark at the start: night whatever the duration says", () => {
      const verdict = nightAutoLine(lineWords(ro, "ro"), { date: "2026-06-17", time: "23:00", timeZone: ZONE }, BRASOV, 30);
      expect(verdict.line).toContain("eveniment de noapte");
      expect(verdict.endLine).toBeNull();
    });

    // 19:00 in June is daylight, but civil dusk is well before 22:00: two hours later is dark.
    it("light at the start, dark by the end: the duration alone makes it a night run", () => {
      const verdict = nightAutoLine(lineWords(ro, "ro"), { date: "2026-06-17", time: "19:00", timeZone: ZONE }, BRASOV, 180);
      expect(verdict.line).toContain("eveniment de noapte");
      // The end is named with its time, in the words of «Durata» (§394, review round 3).
      expect(verdict.endLine).toBe("Startul e înainte de amurg, dar alergarea ține până la 22:00 și prinde întunericul — tot eveniment de noapte.");
    });

    // The server's own fallback: no «Durata», but timed programme rows on the start's own date —
    // the latest one's end (or start) is the span's end, exactly as `nightEvent` reads it.
    it("no duration, programme rows on the day: the last row decides, and the line says so", () => {
      const rows = [
        { date: "2026-11-18", time: "16:00", endTime: "" },
        { date: "2026-11-18", time: "17:00", endTime: "17:45" },
        // Another day's row is not this date's own.
        { date: "2026-11-19", time: "23:00", endTime: "" },
      ];
      const start = { date: "2026-11-18", time: "15:30", timeZone: ZONE };
      const ro1 = nightAutoLine(lineWords(ro, "ro"), start, BRASOV, null, rows);
      expect(ro1.line).toContain("— eveniment de noapte");
      expect(ro1.endLine).toBe(
        "Startul e înainte de amurg, dar programul zilei ține până la 17:45 (ultimul punct) și prinde întunericul — tot eveniment de noapte.",
      );
      expect(nightAutoLine(lineWords(en, "en"), start, BRASOV, null, rows).endLine).toBe(
        "The start is before dusk, but the day's programme runs until 17:45 (its last row) and reaches the dark — still a night event.",
      );
      // «Durata» wins over the programme, as on the server: 30 minutes ends at 16:00, in the light.
      const short = nightAutoLine(lineWords(ro, "ro"), start, BRASOV, 30, rows);
      expect(short.line).toContain("nu e eveniment de noapte");
      expect(short.endLine).toBeNull();
      // And the island agrees with the server's `nightEvent` on the same rows.
      const server = nightEvent(
        {
          nightOverride: null,
          timezone: ZONE,
          scheduleItems: [
            { startsAt: at("2026-11-18T16:00").toISOString(), endsAt: null, label: { ro: "Start", en: "Start" }, place: null },
            { startsAt: at("2026-11-18T17:00").toISOString(), endsAt: at("2026-11-18T17:45").toISOString(), label: { ro: "Final", en: "Finish" }, place: null },
          ],
        },
        at("2026-11-18T15:30"),
        BRASOV,
      );
      expect(server).toMatchObject({ night: true, endSource: "programme", end: "17:45" });
    });

    it("light throughout: not a night run, and the end is never named", () => {
      const verdict = nightAutoLine(lineWords(ro, "ro"), { date: "2026-06-17", time: "10:00", timeZone: ZONE }, BRASOV, 60);
      expect(verdict.line).toContain("nu e eveniment de noapte");
      expect(verdict.endLine).toBeNull();
    });
  });

  it("nightEvent: the same three cases, from the domain function with a schema end", () => {
    // Dark at the start already (23:00 in June): the end plays no part.
    const darkStart = nightEvent({ nightOverride: null, timezone: ZONE, endsAt: new Date("2026-06-17T20:30:00Z") }, new Date("2026-06-17T20:00:00Z"), BRASOV);
    expect(darkStart.night).toBe(true);
    expect(darkStart.endSource).toBeNull();

    // Light at 19:00, but the schema's own end (22:00) is after dusk.
    const darkEnd = nightEvent({ nightOverride: null, timezone: ZONE, endsAt: new Date("2026-06-17T19:00:00Z") }, new Date("2026-06-17T16:00:00Z"), BRASOV);
    expect(darkEnd.night).toBe(true);
    expect(darkEnd.endSource).toBe("event");
    expect(darkEnd.end).toBe("22:00");

    // Light throughout, no end stated beyond the start.
    const lightThroughout = nightEvent({ nightOverride: null, timezone: ZONE }, new Date("2026-06-17T07:00:00Z"), BRASOV);
    expect(lightThroughout.night).toBe(false);
    expect(lightThroughout.endSource).toBeNull();
  });

  it("nightEvent: without a schema end, falls back to the latest timed programme row of the occurrence's own date", () => {
    const facts = nightEvent(
      {
        nightOverride: null,
        timezone: ZONE,
        scheduleItems: [
          { startsAt: "2026-06-17T16:00:00.000Z", endsAt: "2026-06-17T19:00:00.000Z", label: { ro: "Start", en: "Start" }, place: null },
        ],
      },
      new Date("2026-06-17T16:00:00Z"),
      BRASOV,
    );
    expect(facts.night).toBe(true);
    expect(facts.endSource).toBe("programme");
    expect(facts.end).toBe("22:00");
  });

  // §394 (review round 3): «any part of that span». An overnight ultra that starts at 16:00 in June
  // and finishes at 08:00 the next morning has both ends in daylight and a whole night inside.
  it("nightEvent: a span with both ends in daylight but the night inside it is a night event", () => {
    const overnight = nightEvent(
      { nightOverride: null, timezone: ZONE, endsAt: at("2026-06-18T08:00") },
      at("2026-06-17T16:00"),
      BRASOV,
    );
    expect(overnight).toMatchObject({ night: true, source: "automatic", endSource: "event", end: "08:00" });
    // The same start ending at 18:00 the same day: light throughout.
    expect(nightEvent({ nightOverride: null, timezone: ZONE, endsAt: at("2026-06-17T18:00") }, at("2026-06-17T16:00"), BRASOV).night).toBe(false);
    // And the island says the same about the same span: 16 hours from 16:00.
    const island = nightAutoLine(lineWords(en, "en"), { date: "2026-06-17", time: "16:00", timeZone: ZONE }, BRASOV, 16 * 60);
    expect(island.line).toContain("— a night event");
    expect(island.endLine).toBe("The start is before dusk, but the run lasts until 08:00 and reaches the dark — still a night event.");
  });

  it("the pill's tooltip says only the sunset, whatever named the end, in both languages (§415)", async () => {
    // 16:00 on 18 November, ninety minutes: dusk falls inside the run. §404's «End» shape still
    // decides the calendar and reminder lines, but the tooltip says only «Soarele apune la 16:44» — the
    // owner, 2026-09-25: "pe tooltip trebuie doar să zic când apune soarele".
    const late = event({ startsAt: at("2026-11-18T16:00"), endsAt: at("2026-11-18T17:30") });
    const roHtml = renderToStaticMarkup(await EventFacts({ event: late, now: NOW, stacked: true }));
    expect(tooltips(roHtml)).toContain("Soarele apune la 16:44");
    currentLocale = "en";
    const enHtml = renderToStaticMarkup(await EventFacts({ event: late, now: NOW, stacked: true }));
    expect(tooltips(enHtml)).toContain("The sun sets at 16:44");
    currentLocale = "ro";
    const fromProgramme = event({
      startsAt: at("2026-11-18T16:00"),
      scheduleItems: [
        { startsAt: at("2026-11-18T16:00").toISOString(), endsAt: at("2026-11-18T17:40").toISOString(), label: { ro: "Tura", en: "The loop" }, place: null },
      ],
    } as Partial<PublicEvent>);
    const programmeHtml = renderToStaticMarkup(await EventFacts({ event: fromProgramme, now: NOW, stacked: true }));
    expect(tooltips(programmeHtml)).toContain("Soarele apune la 16:44");
  });

  it("carries every word in both catalogues", () => {
    for (const catalogue of [ro, en]) {
      const night = catalogue.Admin.editor.night;
      for (const key of [
        "label",
        "auto",
        "yes",
        "no",
        "autoLine",
        "autoLineDawn",
        "autoLineNoTime",
        "autoLineNoDate",
        "verdictNight",
        "verdictDay",
        "endLine",
        "endLineProgramme",
        "series",
        "help",
      ] as const) {
        expect(night[key].length, key).toBeGreaterThan(0);
      }
      for (const key of [
        "pill",
        "runPill",
        "tooltip",
        "times",
        "timesEnd",
        "timesEndProgramme",
        "timesAfter",
        "timesDawn",
        "calendar",
        "ics",
      ] as const)
        expect(catalogue.Event.night[key].length, key).toBeGreaterThan(0);
    }
    expect(ro.Admin.editor.night.auto).toBe("Automat (după apus)");
    expect(ro.Event.night.pill).toBe("Eveniment de noapte");
    expect(en.Event.night.pill).toBe("Night event");
  });

  it("the box posts the radio by the name the action reads (the integration suite proves the save)", () => {
    expect(readFileSync("src/modules/content/events/ui/boxes/CourseBox.tsx", "utf8")).toContain('name="event.nightOverride"');
  });
});

describe("§394 the migration", () => {
  it("is 0076_night_override in the journal, landing on top of the external discount note's 0075 (the backfill is proven in tests/integration/db)", () => {
    const journal = JSON.parse(readFileSync("src/db/migrations/meta/_journal.json", "utf8")) as { entries: Array<{ idx: number; tag: string }> };
    expect(journal.entries.find((entry) => entry.tag === "0076_night_override")?.idx).toBe(76);
    expect(journal.entries.find((entry) => entry.tag === "0075_discount_note")?.idx).toBe(75);
    // §382's own migration stays as it shipped: history is not rewritten.
    expect(readFileSync("src/db/migrations/0070_headlamp_required.sql", "utf8").trim()).toBe(
      'ALTER TABLE "events" ADD COLUMN "headlamp_required" boolean DEFAULT false NOT NULL;',
    );
  });
});

/**
 * §404 — the owner, 2026-09-25, on the calendar line «Apusul la 19:00, sfârșitul la 20:40» of a 19:00
 * run: "evenimentul începe atunci, nu apusul începe atunci!". Every sentence names the start first,
 * then the sunset, then the end when it is the reason — so a sunset that happens to fall on the
 * start's own minute can no longer be read as the start.
 */
describe("§404 the night sentences name the start, the sunset and the end", () => {
  /** "Running up that hill" on Wednesday 30 September 2026, 19:00 in Brașov, 100 minutes long. */
  const SEPT_30_19 = at("2026-09-30T19:00");
  const SEPT_30_2040 = at("2026-09-30T20:40");

  it("the sunset of 30 September 2026 at the club's place is the sky's, not the run's start", () => {
    /*
      Published: meteogram.org's Brașov table (45°36'N 25°36'E) gives sunset 19:00 for 30
      September 2026 (read 2026-09-25). The computed 19:00 agrees — the coincidence with the
      run's 19:00 start is the calendar's, not a bug: `sunset` comes from `sunTimes` of the day,
      the start from the occurrence, and they are separate fields.
    */
    const sun = sunTimes("2026-09-30", BRASOV)!;
    const sunset = wallClockTime(sun.sunset!, ZONE);
    expect(sunset).toBe("19:00");
    // The wall-clock minute above reads "19:00" anywhere within that minute; this pins the
    // computed instant itself inside it, against `sunTimes`'s own value.
    const sept30Start = at("2026-09-30T19:00:00");
    const sept30End = at("2026-09-30T19:01:00");
    expect(sun.sunset!.getTime()).toBeGreaterThanOrEqual(sept30Start.getTime());
    expect(sun.sunset!.getTime()).toBeLessThan(sept30End.getTime());
    expect(nightEvent({ nightOverride: true, timezone: ZONE }, at("2026-09-30T17:30"), BRASOV)).toMatchObject({ start: "17:30", sunset: "19:00" });
    expect(nightEvent({ nightOverride: true, timezone: ZONE }, at("2026-09-30T21:15"), BRASOV)).toMatchObject({ start: "21:15", sunset: "19:00" });
  });

  it("the owner's run: light at 19:00 (dusk 19:29), dark by its 20:40 end — the end is named", () => {
    expect(nightEvent({ nightOverride: null, timezone: ZONE, endsAt: SEPT_30_2040 }, SEPT_30_19, BRASOV)).toEqual({
      night: true,
      source: "automatic",
      start: "19:00",
      sunset: "19:00",
      sunrise: "07:14",
      endSource: "event",
      end: "20:40",
    });
  });

  const tr = (catalogue: typeof ro | typeof en, locale: "ro" | "en") => createTranslator({ locale, messages: catalogue, namespace: "Event" }) as unknown as (key: string, values?: Record<string, string | number>) => string;
  const shapes = {
    start: nightEvent({ nightOverride: null, timezone: ZONE }, at("2026-09-30T20:00"), BRASOV),
    end: nightEvent({ nightOverride: null, timezone: ZONE, endsAt: SEPT_30_2040 }, SEPT_30_19, BRASOV),
    programme: nightEvent(
      {
        nightOverride: null,
        timezone: ZONE,
        programme: [{ startsAt: SEPT_30_19, endsAt: at("2026-09-30T20:15") }],
      },
      SEPT_30_19,
      BRASOV,
    ),
    // §404: civil dawn on 30 September is 06:44, sunrise 07:14 — a 06:30 start is a night event
    // (before civil dawn) with no end ever named, and before that day's sunrise too, so the
    // `After` shape ("after the sunset") would read backwards for this early-morning run.
    dawn: nightEvent({ nightOverride: null, timezone: ZONE }, at("2026-09-30T06:30"), BRASOV),
    // The review's own case (§404): a 05:30 group run on Wednesday 13 January 2027 at the club's
    // place (`CLUB_COORDINATES`, through `clubNightEvent`) — sunrise 07:55, sunset 16:57. Never
    // «după apusul de la 16:57»: the evening is eleven hours away.
    january: clubNightEvent({ nightOverride: null, timezone: ZONE, startsAt: at("2027-01-13T05:30") }),
  };

  it("a 05:30 January start at the club's place is the dawn shape, the sunrise named (§404)", () => {
    expect(shapes.january).toEqual({ night: true, source: "automatic", start: "05:30", sunset: "16:57", sunrise: "07:55", endSource: null, end: null });
    expect(nightShape(shapes.january)).toEqual({ suffix: "Dawn", values: { start: "05:30", sunrise: "07:55" } });
  });

  it("a 07:40 January start at the club's place — after civil dawn, before sunrise — is a day verdict with the plain shape, not the dawn words (§404)", () => {
    const dayVerdict = clubNightEvent({ nightOverride: null, timezone: ZONE, startsAt: at("2027-01-13T07:40") });
    expect(dayVerdict.night).toBe(false);
    expect(nightShape(dayVerdict)).toEqual({ suffix: "", values: { start: "07:40", sunset: "16:57" } });
  });

  it("an automatic night event whose start is before civil dawn carries the day's sunrise too, with no end named (§404)", () => {
    expect(shapes.dawn).toEqual({
      night: true,
      source: "automatic",
      start: "06:30",
      sunset: "19:00",
      sunrise: "07:14",
      endSource: null,
      end: null,
    });
  });

  // §415: the tooltip says only the sunset — the owner, 2026-09-25, "pe tooltip trebuie doar să
  // zic când apune soarele" — whatever shape §404 picks for the calendar, the `.ics` and the
  // reminder. Every shape here shares the same day's sunset, "19:00", except "january" (16:57).
  // "dawn" and "january" are both pre-dawn starts (§404's `Dawn` shape): the sunset is hours
  // after the run ends, so the tooltip names the sunrise instead (§415).
  it.each([
    ["ro", "start", "Soarele apune la 19:00"],
    ["ro", "end", "Soarele apune la 19:00"],
    ["ro", "programme", "Soarele apune la 19:00"],
    ["ro", "dawn", "Soarele răsare la 07:14"],
    ["en", "start", "The sun sets at 19:00"],
    ["en", "end", "The sun sets at 19:00"],
    ["en", "programme", "The sun sets at 19:00"],
    ["en", "dawn", "The sun rises at 07:14"],
    ["ro", "january", "Soarele răsare la 07:55"],
    ["en", "january", "The sun rises at 07:55"],
  ] as const)("the pill's tooltip, %s, %s", (locale, shape, words) => {
    expect(nightTooltip(shapes[shape], tr(locale === "ro" ? ro : en, locale))).toBe(words);
  });

  it.each([
    ["ro", "start", "calendar", false, "Eveniment de noapte: începe la 20:00, după apusul de la 19:00"],
    ["ro", "end", "calendar", true, "Alergare de noapte: începe la 19:00, apusul la 19:00, se termină la 20:40"],
    ["ro", "programme", "ics", false, "Eveniment de noapte: începe la 19:00, apusul la 19:00, ultimul punct din program la 20:15 — ia o frontală"],
    ["en", "start", "ics", true, "Night run: starts at 20:00, after the 19:00 sunset — bring a headlamp"],
    ["en", "end", "calendar", false, "Night event: starts at 19:00, sunset at 19:00, ends at 20:40"],
    ["en", "programme", "calendar", true, "Night run: starts at 19:00, sunset at 19:00, the programme's last row at 20:15"],
    ["ro", "dawn", "ics", true, "Alergare de noapte: începe la 06:30, înainte de răsăritul de la 07:14 — ia o frontală"],
    ["en", "dawn", "calendar", false, "Night event: starts at 06:30, before sunrise at 07:14"],
    ["ro", "january", "calendar", true, "Alergare de noapte: începe la 05:30, înainte de răsăritul de la 07:55"],
    ["en", "january", "ics", true, "Night run: starts at 05:30, before sunrise at 07:55 — bring a headlamp"],
  ] as const)("the calendar and .ics lines, %s, %s, %s", (locale, shape, kind, run, words) => {
    expect(nightLine(shapes[shape], tr(locale === "ro" ? ro : en, locale), run, kind)).toBe(words);
  });

  it("no time to name: the tooltip is absent and the line is the label alone", () => {
    const none = nightEvent({ nightOverride: true, timezone: ZONE }, null, BRASOV);
    expect(nightTooltip(none, tr(ro, "ro"))).toBeNull();
    expect(nightLine(none, tr(en, "en"), true, "ics")).toBe("Night run");
  });

  describe("the reminder's line names them too", () => {
    const base: TemplateData = { participantName: "Ana", eventTitle: "Running up that hill", nightEventSunset: "19:00", nightEventStart: "19:00" };
    const line = (locale: "ro" | "en", data: TemplateData) =>
      buildTemplateContent("EVENT_REMINDER", locale, data, undefined).paragraphs.find((paragraph) => typeof paragraph === "string" && /noapte|Night/.test(paragraph));
    it.each([
      ["ro", {}, "Eveniment de noapte: începe la 19:00, apusul la 19:00. Ia o frontală."],
      ["ro", { nightEventEnd: "20:40", nightEventEndSource: "event" }, "Eveniment de noapte: începe la 19:00, apusul la 19:00, se termină la 20:40. Ia o frontală."],
      ["ro", { nightEventEnd: "20:15", nightEventEndSource: "programme", nightEventIsGroupRun: true }, "Alergare de noapte: începe la 19:00, apusul la 19:00, ultimul punct din program la 20:15. Ia o frontală."],
      // The start already past sunset, no end ever named (§404): the sunset alone would read as
      // the reason, so the line says the start came after it.
      ["ro", { nightEventAfter: true }, "Eveniment de noapte: începe la 19:00, după apusul de la 19:00. Ia o frontală."],
      ["en", {}, "Night event: starts at 19:00, sunset at 19:00. Bring a headlamp."],
      ["en", { nightEventEnd: "20:40", nightEventEndSource: "event", nightEventIsGroupRun: true }, "Night run: starts at 19:00, sunset at 19:00, ends at 20:40. Bring a headlamp."],
      ["en", { nightEventEnd: "20:15", nightEventEndSource: "programme" }, "Night event: starts at 19:00, sunset at 19:00, the programme's last row at 20:15. Bring a headlamp."],
      ["en", { nightEventAfter: true }, "Night event: starts at 19:00, after the 19:00 sunset. Bring a headlamp."],
      // The dawn shape (§404): a 05:30 January group run names that day's sunrise, never the
      // evening's sunset.
      [
        "ro",
        { nightEventStart: "05:30", nightEventSunset: "16:57", nightEventSunrise: "07:55", nightEventIsGroupRun: true },
        "Alergare de noapte: începe la 05:30, înainte de răsăritul de la 07:55. Ia o frontală.",
      ],
      [
        "en",
        { nightEventStart: "05:30", nightEventSunset: "16:57", nightEventSunrise: "07:55", nightEventIsGroupRun: true },
        "Night run: starts at 05:30, before sunrise at 07:55. Bring a headlamp.",
      ],
    ] as const)("%s %j", (locale, extra, words) => {
      expect(line(locale, { ...base, ...extra })).toBe(words);
    });
  });
});
