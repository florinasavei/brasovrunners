import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PublicEvent } from "@/modules/events/repository";

/**
 * BR-REQ-020-01 (§NNN) — «Vremea» on the event page: the page reads the forecast
 * (`weatherForEvent`, Open-Meteo answered here by a stub `fetch`) and the facts draw it as a row,
 * glyph, word, temperature, chance of rain and wind, with the credit under it. Absent beyond
 * seven days and absent when the service fails — never a sentence about a missing forecast.
 *
 * Rendered on the server as the page renders it, the rows read back as `<dt>`/`<dd>` pairs.
 */
let currentLocale: "ro" | "en" = "ro";

vi.mock("next-intl/server", async () => {
  const { createFormatter, createTranslator } = await import("next-intl");
  const ro = (await import("../../../messages/ro.json")).default;
  const en = (await import("../../../messages/en.json")).default;
  return {
    getTranslations: async (namespace: string) =>
      createTranslator({ locale: currentLocale, messages: currentLocale === "ro" ? ro : en, namespace: namespace as "Event" }),
    getFormatter: async () => createFormatter({ locale: currentLocale, timeZone: "Europe/Bucharest" }),
    getLocale: async () => currentLocale,
  };
});

const { default: EventFacts } = await import("@/modules/events/ui/EventFacts");
const { weatherForEvent, OPEN_METEO_BASE } = await import("@/modules/weather/source");
const { OPEN_METEO_SITE } = await import("@/modules/weather/domain/credit");

afterEach(() => {
  currentLocale = "ro";
});

const HOUR = 60 * 60 * 1000;
const NOW = new Date("2026-09-24T09:00:00.000Z");

function event(overrides: Partial<PublicEvent> = {}): PublicEvent {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    type: "GROUP_RUN",
    surface: "TRAIL",
    eventStatus: "SCHEDULED",
    // Saturday 26 September 2026, 08:00 in Brașov — two days after NOW.
    startsAt: new Date("2026-09-26T05:00:00Z"),
    endsAt: null,
    raceStartsAt: null,
    timezone: "Europe/Bucharest",
    mapUrl: null,
    routeUrl: null,
    stravaEventUrl: null,
    facebookEventUrl: null,
    coHosts: [{ name: "Salvamont", links: [] }],
    coHostName: null,
    coHostUrl: null,
    featured: false,
    isSpecial: false,
    distanceMeters: 14000,
    elevationGainMeters: 600,
    registrationMode: "NONE",
    registrationOpensAt: null,
    registrationClosesAt: null,
    externalRegistrationUrl: null,
    externalProvider: null,
    minAge: 0,
    slug: "tura-pe-tampa",
    title: "Tură pe Tâmpa",
    excerpt: "Urcare pe Tâmpa.",
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

/** Open-Meteo's answer: eight days of hours from NOW, a thunderstorm at 16 °C with a 70% chance of rain and 23 km/h of wind. */
function openMeteo(): typeof fetch {
  const first = Math.floor(NOW.getTime() / HOUR) * HOUR;
  const time = Array.from({ length: 8 * 24 }, (_, index) => (first + index * HOUR) / 1000);
  return vi.fn(async (url: string) => {
    expect(url.startsWith(`${OPEN_METEO_BASE}/v1/forecast?`)).toBe(true);
    return new Response(
      JSON.stringify({
        hourly: {
          time,
          temperature_2m: time.map(() => 16.2),
          precipitation_probability: time.map(() => 70),
          weather_code: time.map(() => 95),
          wind_speed_10m: time.map(() => 23.4),
        },
      }),
      { status: 200 },
    );
  }) as unknown as typeof fetch;
}

const failing = vi.fn(async () => new Response("Service Unavailable", { status: 503 })) as unknown as typeof fetch;

async function page(overrides: Partial<PublicEvent> = {}, fetchImpl: typeof fetch = openMeteo()) {
  const shown = event(overrides);
  const weather = await weatherForEvent(shown, NOW, { fetch: fetchImpl, source: "open-meteo", timeoutMs: 50 });
  return renderToStaticMarkup(await EventFacts({ event: shown, now: NOW, stacked: true, weather }));
}

const withoutStyles = (html: string) => html.replace(/<style[^>]*>[\s\S]*?<\/style>/g, "");
const text = (fragment: string) => fragment.replace(/<[^>]+>/g, "");

function rows(html: string) {
  return [...withoutStyles(html).matchAll(/<dt\b[^>]*>([\s\S]*?)<\/dt><dd\b[^>]*>([\s\S]*?)<\/dd>/g)].map(([, dt, dd]) => ({
    label: text(dt.replace(/^<(svg|span)\b[^>]*>[\s\S]*?<\/\1>/, "")),
    dt,
    dd,
  }));
}

describe("BR-REQ-020-01 the event page's «Vremea» row (§NNN)", () => {
  it("draws the forecast for the start, after the short facts and before the partners", async () => {
    const html = await page();
    expect(rows(html).map((row) => row.label)).toEqual(["Când", "Unde", "Traseu", "Cost", "Vremea", "Împreună cu"]);
    const weather = rows(html).find((row) => row.label === "Vremea");
    expect(text(weather?.dd ?? "")).toContain("Furtună");
    expect(text(weather?.dd ?? "")).toContain("16 °C");
    expect(text(weather?.dd ?? "")).toContain("70% șanse de ploaie");
    expect(text(weather?.dd ?? "")).toContain("vânt 23 km/h");
    // The forecast's own glyph in the row glyph's place: the storm, one 20-pixel family with the others.
    expect(weather?.dt).toMatch(/^<svg\b/);
  });

  it("credits Open-Meteo with a 44-pixel link, as the data's licence asks", async () => {
    const html = withoutStyles(await page());
    expect(html).toContain(`href="${OPEN_METEO_SITE}"`);
    expect(text(html)).toContain("Prognoză: Open-Meteo");
  });

  it("says it in English on the English page", async () => {
    currentLocale = "en";
    const html = await page();
    const weather = rows(html).find((row) => row.label === "Weather");
    expect(text(weather?.dd ?? "")).toContain("Thunderstorm");
    expect(text(weather?.dd ?? "")).toContain("70% chance of rain");
    expect(text(weather?.dd ?? "")).toContain("wind 23 km/h");
    expect(text(html)).toContain("Forecast: Open-Meteo");
  });

  it("is absent for a start more than seven days away, and asks nothing", async () => {
    const fetchImpl = openMeteo();
    const html = await page({ startsAt: new Date(NOW.getTime() + 8 * 24 * HOUR) }, fetchImpl);
    expect(rows(html).map((row) => row.label)).not.toContain("Vremea");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("is absent — no row, no sentence — when Open-Meteo fails", async () => {
    const html = await page({}, failing);
    expect(rows(html).map((row) => row.label)).toEqual(["Când", "Unde", "Traseu", "Cost", "Împreună cu"]);
    expect(text(html)).not.toContain("Open-Meteo");
  });

  it("is never on the listing card or the hero", async () => {
    const weather = await weatherForEvent(event(), NOW, { fetch: openMeteo(), source: "open-meteo" });
    for (const variant of ["compact", "full"] as const) {
      const html = renderToStaticMarkup(await EventFacts({ event: event(), now: NOW, variant, weather }));
      expect(text(html), variant).not.toContain("Furtună");
    }
  });
});
