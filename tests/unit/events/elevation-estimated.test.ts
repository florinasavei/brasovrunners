import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { courseSummary, type SummaryWords } from "@/modules/content/events/ui/box-summaries";
import { elevationWords, estimatedElevation } from "@/modules/events/domain/elevation";
import { calendarDescription, type CalendarEvent, type CalendarLabels } from "@/modules/events/ical";
import { eventFactsBlock } from "@/modules/notifications/domain/event-facts";
import { emailSampleEventFacts } from "@/modules/notifications/email-copy-fields";

/**
 * §585 (amending §388 and §392) — the owner, 2026-09-30: «la elevație, trebuie să pot pune
 * "estimativ"». One function, `elevationWords`, says the climb on every surface: «≈ 350 m D+» on
 * the pill, «circa 350 m diferență de nivel» wherever the words stand alone — the
 * pill's tooltip and what a screen reader hears, the emails' facts block and its text twin, the
 * calendar entry — and never the bare number for a climb the club ticked «Estimativ».
 */
let currentLocale: "ro" | "en" = "ro";

vi.mock("next-intl/server", async () => {
  const { createFormatter, createTranslator } = await import("next-intl");
  return {
    getTranslations: async (namespace: string) =>
      createTranslator({ locale: currentLocale, messages: currentLocale === "ro" ? ro : en, namespace: namespace as "Event" }),
    getFormatter: async () => createFormatter({ locale: currentLocale, timeZone: "Europe/Bucharest" }),
  };
});

const { getFormatter, getTranslations } = await import("next-intl/server");
const { buildRoutePills, routePillParts } = await import("@/modules/events/ui/route-pills");
const { default: RoutePills } = await import("@/modules/events/ui/RoutePills");

afterEach(() => {
  currentLocale = "ro";
});

const LONG = { ro: "circa 350 m diferență de nivel", en: "about 350 m of elevation gain" } as const;
const SHORT = { ro: "≈ 350 m D+", en: "≈ 350 m climb" } as const;
const EXACT = { ro: { short: "350 m D+", long: "350 m diferență de nivel" }, en: { short: "350 m climb", long: "350 m elevation gain" } } as const;

/** A route with a climb and nothing that makes a night pill: a Sunday morning. */
const ROUTE = {
  type: "RACE" as const,
  surface: "TRAIL" as const,
  difficultyLevel: null,
  distanceMeters: 12_000,
  elevationGainMeters: 350,
  startsAt: new Date("2026-10-04T06:00:00Z"),
  endsAt: null,
  scheduleItems: null,
  timezone: "Europe/Bucharest",
  nightOverride: false,
  costType: null,
  registrationMode: "INTERNAL" as const,
  mapUrl: null,
  latitude: null,
  longitude: null,
  locationToBeAnnounced: false,
};

describe("§585 elevationWords — the one source of the climb's words", () => {
  for (const locale of ["ro", "en"] as const) {
    it(`says an estimate with «≈» and in words, and an exact climb as before (${locale})`, async () => {
      currentLocale = locale;
      const t = await getTranslations("Event");
      const format = (value: number) => String(value);
      expect(elevationWords({ elevationGainMeters: 350, elevationGainEstimated: true }, t, format)).toEqual({ short: SHORT[locale], long: LONG[locale], estimated: true });
      expect(elevationWords({ elevationGainMeters: 350, elevationGainEstimated: false }, t, format)).toEqual({ ...EXACT[locale], estimated: false });
      // A cached row from before the column reads as exact.
      expect(elevationWords({ elevationGainMeters: 350 }, t, format)).toEqual({ ...EXACT[locale], estimated: false });
      // Plain words: within the owner's 200 characters, and never the platform's own name for itself.
      for (const text of [SHORT[locale], LONG[locale]]) {
        expect(text.length).toBeLessThanOrEqual(200);
        expect(text).not.toMatch(/platforma|de obicei/);
      }
    });
  }

  it("says nothing without a climb, ticked or not", async () => {
    const t = await getTranslations("Event");
    for (const meters of [null, undefined, 0]) {
      expect(elevationWords({ elevationGainMeters: meters, elevationGainEstimated: true }, t, String)).toBeNull();
      expect(elevationWords({ elevationGainMeters: meters, elevationGainEstimated: false }, t, String)).toBeNull();
    }
  });

  it("formats the number in the reader's language", async () => {
    const t = await getTranslations("Event");
    const format = await getFormatter();
    expect(elevationWords({ elevationGainMeters: 1250, elevationGainEstimated: true }, t, (value) => format.number(value))?.short).toBe("≈ 1.250 m D+");
  });
});

describe("§585 the editor's tick is dropped without a number", () => {
  it("keeps the tick only beside a climb", () => {
    expect(estimatedElevation(350, true)).toBe(true);
    expect(estimatedElevation(350, false)).toBe(false);
    expect(estimatedElevation(null, true)).toBe(false);
    expect(estimatedElevation(undefined, true)).toBe(false);
    expect(estimatedElevation(0, true)).toBe(false);
  });

  it("the closed «Traseu» card says «≈ +350 m» for an estimate", () => {
    const words = ro.Admin.editor.boxes.summary as SummaryWords;
    const wordsEn = en.Admin.editor.boxes.summary as SummaryWords;
    const course = { distanceMeters: 12_000, elevationGainMeters: 350, routeUrl: null, nightOverride: false };
    expect(courseSummary(words, { ...course, elevationGainEstimated: true }, { surface: "Trail" })).toBe("Trail · 12 km · ≈ +350 m · de zi");
    expect(courseSummary(wordsEn, { ...course, elevationGainEstimated: true }, { surface: "Trail" })).toContain("≈ +350 m");
    expect(courseSummary(words, { ...course, elevationGainEstimated: false }, { surface: "Trail" })).toBe("Trail · 12 km · +350 m · de zi");
  });
});

describe("§585 amending §388 — the route pill", () => {
  for (const locale of ["ro", "en"] as const) {
    it(`an estimate reads «≈» on the pill, and the long form on hover, to a screen reader and in an email (${locale})`, async () => {
      currentLocale = locale;
      const t = await getTranslations("Event");
      const format = await getFormatter();
      const pill = routePillParts({ ...ROUTE, elevationGainEstimated: true }, t, format).elevation;
      expect(pill).toEqual({ glyph: "elevation", label: SHORT[locale], tooltip: LONG[locale], srLabel: LONG[locale], plain: LONG[locale] });
      // An exact climb is the pill it always was: no tooltip, no second name.
      expect(routePillParts({ ...ROUTE, elevationGainEstimated: false }, t, format).elevation).toEqual({ glyph: "elevation", label: EXACT[locale].short });
    });
  }

  it("draws «≈ 350 m D+» with its tooltip, and names the chip in words", async () => {
    const t = await getTranslations("Event");
    const format = await getFormatter();
    const html = renderToStaticMarkup(createElement(RoutePills, { pills: buildRoutePills({ ...ROUTE, elevationGainEstimated: true }, t, format) }));
    // The visible «≈ 350 m D+» is hidden from a screen reader, which hears the long form instead.
    expect(html).toContain(`<span aria-hidden="true">${SHORT.ro}</span>`);
    expect(html).toContain(LONG.ro);
    expect(html).toContain('data-has-tooltip="true"');
    const exact = renderToStaticMarkup(createElement(RoutePills, { pills: buildRoutePills({ ...ROUTE, elevationGainEstimated: false }, t, format) }));
    expect(exact).toContain(EXACT.ro.short);
    expect(exact).not.toContain("≈");
    expect(exact).not.toContain("data-has-tooltip");
  });
});

describe("§585 amending §392 — the emails' facts block", () => {
  for (const locale of ["ro", "en"] as const) {
    it(`says the estimate in words, in the HTML part and in its text twin (${locale})`, () => {
      const facts = { ...emailSampleEventFacts(locale), elevationGainMeters: 350, elevationGainEstimated: true };
      const block = eventFactsBlock(facts, locale);
      expect(block.text).toMatch(new RegExp(`^${locale === "ro" ? "Traseu" : "Route"}: .*· 12 km · ${LONG[locale].replace(/[()]/g, "\\$&")}$`, "m"));
      expect(block.html).toContain(LONG[locale]);
      // Never the bare number of an estimate.
      expect(block.text).not.toContain(EXACT[locale].short);
      expect(block.html).not.toContain(EXACT[locale].short);
      // An exact climb keeps the pill's words.
      expect(eventFactsBlock({ ...facts, elevationGainEstimated: false }, locale).text).toContain(`12 km · ${EXACT[locale].short}`);
    });
  }
});

describe("§585 the calendar entry's facts line (§107, §159)", () => {
  function translator(catalogue: { Event: Record<string, unknown> }): CalendarLabels["t"] {
    return (key, values) => {
      const message = key.split(".").reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], catalogue.Event);
      if (typeof message !== "string") throw new Error(`missing Event.${key}`);
      return Object.entries(values ?? {}).reduce((text, [name, value]) => text.replaceAll(`{${name}}`, String(value)), message);
    };
  }
  const event: CalendarEvent = {
    id: "11111111-1111-1111-1111-111111111111",
    title: "Crosul",
    type: "RACE",
    startsAt: new Date("2026-10-11T06:00:00.000Z"),
    endsAt: null,
    locationName: "Parcul Tractorul",
    excerpt: null,
    scheduleJson: null,
    url: "https://example.test/ro/evenimente/crosul",
    updatedAt: null,
    distanceMeters: 10_000,
    elevationGainMeters: 350,
    elevationGainEstimated: true,
    nightOverride: false,
  };

  it("writes «↗ circa 350 m diferență de nivel» in each language", () => {
    expect(calendarDescription(event, { locale: "ro", t: translator(ro) })).toContain(`↗ ${LONG.ro}`);
    expect(calendarDescription(event, { locale: "en", t: translator(en) })).toContain(`↗ ${LONG.en}`);
    expect(calendarDescription({ ...event, elevationGainEstimated: false }, { locale: "ro", t: translator(ro) })).toContain(`↗ ${EXACT.ro.long}`);
  });
});
