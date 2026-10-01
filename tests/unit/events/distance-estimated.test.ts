import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { eventFieldsSchema } from "@/modules/content/events/fields";
import { courseSummary, type SummaryWords } from "@/modules/content/events/ui/box-summaries";
import { distanceWords, estimatedDistance } from "@/modules/events/domain/distance";
import { calendarDescription, type CalendarEvent, type CalendarLabels } from "@/modules/events/ical";
import { eventFactsBlock } from "@/modules/notifications/domain/event-facts";
import { emailSampleEventFacts } from "@/modules/notifications/email-copy-fields";

/**
 * §598 (the twin of §585, amending §388 and §392) — the owner, 2026-09-30: «la distanță vreau să
 * pot pune aproximativ, ca și la elevație, tot așa cu bifă». One function, `distanceWords`, says the
 * distance on every surface: «≈ 10 km» on the pill, «circa 10 km» wherever the words
 * stand alone — the pill's tooltip and what a screen reader hears, the emails' facts block and its
 * text twin, the calendar entry, the share picture — and an exact distance exactly as before.
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

const LONG = { ro: "circa 12 km", en: "about 12 km" } as const;
const SHORT = "≈ 12 km";
const EXACT = "12 km";

/** A route with a distance and nothing that makes a night pill: a Sunday morning. */
const ROUTE = {
  type: "RACE" as const,
  surface: "TRAIL" as const,
  difficultyLevel: null,
  distanceMeters: 12_000,
  elevationGainMeters: null,
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

describe("§598 distanceWords — the one source of the distance's words", () => {
  for (const locale of ["ro", "en"] as const) {
    it(`says an approximate distance with «≈» and in words, and an exact one as before (${locale})`, async () => {
      currentLocale = locale;
      const t = await getTranslations("Event");
      expect(distanceWords({ distanceMeters: 12_000, distanceEstimated: true }, t, String)).toEqual({ short: SHORT, long: LONG[locale], estimated: true });
      expect(distanceWords({ distanceMeters: 12_000, distanceEstimated: false }, t, String)).toEqual({ short: EXACT, long: EXACT, estimated: false });
      // A cached row from before the column reads as exact.
      expect(distanceWords({ distanceMeters: 12_000 }, t, String)).toEqual({ short: EXACT, long: EXACT, estimated: false });
    });
  }

  it("says nothing without a distance, ticked or not", async () => {
    const t = await getTranslations("Event");
    for (const meters of [null, undefined, 0]) {
      expect(distanceWords({ distanceMeters: meters, distanceEstimated: true }, t, String)).toBeNull();
      expect(distanceWords({ distanceMeters: meters, distanceEstimated: false }, t, String)).toBeNull();
    }
  });

  it("formats the kilometres in the reader's language, to one decimal", async () => {
    const t = await getTranslations("Event");
    const format = await getFormatter();
    const km = (value: number) => format.number(value, { maximumFractionDigits: 1 });
    expect(distanceWords({ distanceMeters: 10_500, distanceEstimated: true }, t, km)?.short).toBe("≈ 10,5 km");
    currentLocale = "en";
    const tEn = await getTranslations("Event");
    const formatEn = await getFormatter();
    expect(distanceWords({ distanceMeters: 10_500, distanceEstimated: true }, tEn, (value) => formatEn.number(value, { maximumFractionDigits: 1 }))?.long).toBe(
      "about 10.5 km",
    );
  });
});

describe("§598 the editor's tick is dropped without a distance", () => {
  it("keeps the tick only beside a distance", () => {
    expect(estimatedDistance(12_000, true)).toBe(true);
    expect(estimatedDistance(12_000, false)).toBe(false);
    expect(estimatedDistance(null, true)).toBe(false);
    expect(estimatedDistance(undefined, true)).toBe(false);
    expect(estimatedDistance(0, true)).toBe(false);
  });

  it("the schema reads an absent tick as exact, and never refuses one", () => {
    expect(eventFieldsSchema.shape.distanceEstimated.parse(undefined)).toBe(false);
    expect(eventFieldsSchema.shape.distanceEstimated.parse(true)).toBe(true);
  });

  it("the closed «Traseu» card says «≈ 12 km» for an approximate distance", () => {
    const words = ro.Admin.editor.boxes.summary as SummaryWords;
    const wordsEn = en.Admin.editor.boxes.summary as SummaryWords;
    const course = { distanceMeters: 12_000, elevationGainMeters: 350, routeUrl: null, nightOverride: false };
    expect(courseSummary(words, { ...course, distanceEstimated: true }, { surface: "Trail" })).toBe("Trail · ≈ 12 km · +350 m · de zi");
    expect(courseSummary(wordsEn, { ...course, distanceEstimated: true }, { surface: "Trail" })).toContain("≈ 12 km");
    expect(courseSummary(words, { ...course, distanceEstimated: false }, { surface: "Trail" })).toBe("Trail · 12 km · +350 m · de zi");
  });
});

describe("§598 amending §388 — the route pill", () => {
  for (const locale of ["ro", "en"] as const) {
    it(`an approximate distance reads «≈» on the pill, and the long form on hover, to a screen reader and in an email (${locale})`, async () => {
      currentLocale = locale;
      const t = await getTranslations("Event");
      const format = await getFormatter();
      const pill = routePillParts({ ...ROUTE, distanceEstimated: true }, t, format).distance;
      expect(pill).toEqual({ glyph: "distance", label: SHORT, tooltip: LONG[locale], srLabel: LONG[locale], plain: LONG[locale] });
      // An exact distance is the pill it always was: no tooltip, no second name.
      expect(routePillParts({ ...ROUTE, distanceEstimated: false }, t, format).distance).toEqual({ glyph: "distance", label: EXACT });
    });
  }

  it("draws «≈ 12 km» with its tooltip, and names the chip in words", async () => {
    const t = await getTranslations("Event");
    const format = await getFormatter();
    const html = renderToStaticMarkup(createElement(RoutePills, { pills: buildRoutePills({ ...ROUTE, distanceEstimated: true }, t, format) }));
    expect(html).toContain(`<span aria-hidden="true">${SHORT}</span>`);
    expect(html).toContain(LONG.ro);
    expect(html).toContain('data-has-tooltip="true"');
    const exact = renderToStaticMarkup(createElement(RoutePills, { pills: buildRoutePills({ ...ROUTE, distanceEstimated: false }, t, format) }));
    expect(exact).toContain(EXACT);
    expect(exact).not.toContain("≈");
  });
});

describe("§598 amending §392 — the emails' facts block", () => {
  for (const locale of ["ro", "en"] as const) {
    it(`says the approximate distance in words, in the HTML part and in its text twin (${locale})`, () => {
      const facts = { ...emailSampleEventFacts(locale), distanceMeters: 12_000, distanceEstimated: true };
      const block = eventFactsBlock(facts, locale);
      expect(block.text).toContain(LONG[locale]);
      expect(block.html).toContain(LONG[locale]);
      expect(block.text).not.toContain(`· ${EXACT} ·`);
      expect(eventFactsBlock({ ...facts, distanceEstimated: false }, locale).text).toContain(`· ${EXACT} ·`);
    });
  }
});

describe("§598 the calendar entry's facts line (§107, §159)", () => {
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
    distanceMeters: 12_000,
    distanceEstimated: true,
    nightOverride: false,
  };

  it("writes «🏃 circa 12 km» in each language, and «🏃 12 km» when exact", () => {
    expect(calendarDescription(event, { locale: "ro", t: translator(ro) })).toContain(`🏃 ${LONG.ro}`);
    expect(calendarDescription(event, { locale: "en", t: translator(en) })).toContain(`🏃 ${LONG.en}`);
    const exact = calendarDescription({ ...event, distanceEstimated: false }, { locale: "ro", t: translator(ro) });
    expect(exact).toContain(`🏃 ${EXACT}`);
    expect(exact).not.toContain(LONG.ro);
  });
});
