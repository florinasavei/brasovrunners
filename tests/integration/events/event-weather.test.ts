import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PublicEvent } from "@/modules/events/repository";

/**
 * BR-REQ-011-01 (§402) — «Vremea» on the event page: the page reads the forecast
 * (`forecastForEvent`, Open-Meteo answered here by a stub `fetch`) and the facts draw it as a row,
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
const { forecastForEvent, forecastsForEvents } = await import("@/modules/weather/source");
const { env } = await import("@/shared/config/env");
const { OPEN_METEO_API, OPEN_METEO_SITE } = await import("@/modules/weather/domain/credit");

afterEach(() => {
  currentLocale = "ro";
  asked = [];
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
    difficultyLevel: 5,
    costType: "FREE",
    costAmount: null,
    costUrl: null,
    publishedAt: NOW,
    ...overrides,
  } as PublicEvent;
}

/** The addresses the stub was asked, in order — where each forecast was read for (§416). */
let asked: URL[] = [];

/**
 * Open-Meteo's answer: eight days of hours from NOW, a thunderstorm at 16 °C with a 70% chance of
 * rain and 23 km/h of wind — and the page's details (§416): feels like 13.8 °C, 2.4 mm, gusts of
 * 41 km/h, 88% humidity, UV 1.2. The start's third hour is 18 °C, so the block's cells differ.
 */
function openMeteo(sky: { code?: number; chance?: number; mm?: number } = {}): typeof fetch {
  const { code = 95, chance = 70, mm = 2.4 } = sky;
  const first = Math.floor(NOW.getTime() / HOUR) * HOUR;
  const time = Array.from({ length: 8 * 24 }, (_, index) => (first + index * HOUR) / 1000);
  const third = (new Date("2026-09-26T07:00:00Z").getTime() - first) / HOUR;
  return vi.fn(async (url: string) => {
    expect(url.startsWith(`${OPEN_METEO_API}/v1/forecast?`)).toBe(true);
    asked.push(new URL(url));
    return new Response(
      JSON.stringify({
        hourly: {
          time,
          temperature_2m: time.map((_, index) => (index === third ? 18 : 16.2)),
          precipitation_probability: time.map(() => chance),
          weather_code: time.map(() => code),
          wind_speed_10m: time.map(() => 23.4),
          apparent_temperature: time.map(() => 13.8),
          precipitation: time.map(() => mm),
          wind_gusts_10m: time.map(() => 41),
          relative_humidity_2m: time.map(() => 88),
          uv_index: time.map(() => 1.2),
        },
      }),
      { status: 200 },
    );
  }) as unknown as typeof fetch;
}

const failing = vi.fn(async () => new Response("Service Unavailable", { status: 503 })) as unknown as typeof fetch;

async function page(overrides: Partial<PublicEvent> = {}, fetchImpl: typeof fetch = openMeteo()) {
  const shown = event(overrides);
  const weather = await forecastForEvent(shown, NOW, { fetch: fetchImpl, source: "open-meteo", timeoutMs: 50 });
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

describe("BR-REQ-011-01 the event page's «Vremea» row (§402)", () => {
  it("draws the forecast for the start, after the short facts and before the partners", async () => {
    const html = await page();
    expect(rows(html).map((row) => row.label)).toEqual(["Când", "Unde", "Traseu", "Cost", "Vremea"]);
    const weather = rows(html).find((row) => row.label === "Vremea");
    expect(text(weather?.dd ?? "")).toContain("Furtună");
    expect(text(weather?.dd ?? "")).toContain("16 °C");
    expect(text(weather?.dd ?? "")).not.toContain("km/h");
    // The forecast's own glyph in the row glyph's place: the storm, one 20-pixel family with the others.
    expect(weather?.dt).toMatch(/^<svg\b/);
  });

  it("carries no Open-Meteo credit in the facts — the site footer's fold credits it (§455; tests/unit/shared/site-footer.test.ts)", async () => {
    const html = withoutStyles(await page());
    expect(html).not.toContain(`href="${OPEN_METEO_SITE}"`);
    expect(text(html)).not.toContain("Open-Meteo");
  });

  it("says it in English on the English page", async () => {
    currentLocale = "en";
    const html = await page();
    const weather = rows(html).find((row) => row.label === "Weather");
    expect(text(weather?.dd ?? "")).toContain("Thunderstorm");
    expect(text(weather?.dd ?? "")).not.toContain("km/h");
    expect(html).not.toContain(`href="${OPEN_METEO_SITE}"`);
    expect(text(html)).not.toContain("Open-Meteo");
  });

  it("is absent for a start more than seven days away, and asks nothing", async () => {
    const fetchImpl = openMeteo();
    const html = await page({ startsAt: new Date(NOW.getTime() + 8 * 24 * HOUR) }, fetchImpl);
    expect(rows(html).map((row) => row.label)).not.toContain("Vremea");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("is absent — no row, no sentence — when Open-Meteo fails", async () => {
    const html = await page({}, failing); // the partners are a section of their own since §401, not a facts row
    expect(rows(html).map((row) => row.label)).toEqual(["Când", "Unde", "Traseu", "Cost"]);
    expect(text(html)).not.toContain("Open-Meteo");
  });

  it("is on the hero as one line without a credit (the footer's since §455), and never inside the compact card's facts (§416)", async () => {
    const weather = await forecastForEvent(event(), NOW, { fetch: openMeteo(), source: "open-meteo" });
    const hero = withoutStyles(renderToStaticMarkup(await EventFacts({ event: event(), now: NOW, variant: "full", weather })));
    expect(text(hero)).toContain("Furtună");
    expect(text(hero)).toContain("16 °C");
    expect(hero).not.toContain(`href="${OPEN_METEO_SITE}"`);
    expect(text(hero)).not.toContain("Open-Meteo");
    // The hero is a summary: the page's details and hours stay the page's.
    expect(hero).not.toContain('data-testid="weather-hours"');
    expect(text(hero)).not.toContain("rafale");
    const card = renderToStaticMarkup(await EventFacts({ event: event(), now: NOW, variant: "compact", weather }));
    expect(text(card)).not.toContain("Furtună");
  });
});

describe("BR-REQ-011-01 the event page's weather is one line (§469, replacing §416's hours and details)", () => {
  const weatherDd = async (overrides: Partial<PublicEvent> = {}) => {
    const html = withoutStyles(await page(overrides));
    return rows(html).find((row) => row.label === "Vremea" || row.label === "Weather")?.dd ?? "";
  };

  it("says the start's summary and nothing more: no hours strip, no details line, no place line", async () => {
    const dd = await weatherDd();
    expect(text(dd)).toContain("Furtună");
    expect(text(dd)).toContain("16 °C");
    expect(dd).not.toContain('data-testid="weather-hours"');
    expect(dd).not.toContain('data-testid="weather-details"');
    expect(dd).not.toContain('data-testid="weather-credit"');
    expect(text(dd)).not.toContain("rafale");
    expect(text(dd)).not.toContain("Pentru Brașov");
    expect(text(dd)).not.toContain("km/h");
  });

  const rainy = () => openMeteo({ code: 61, chance: 80, mm: 1 });
  const dry = () => openMeteo({ code: 2, chance: 10, mm: 0 });
  const line = async (locale: "ro" | "en", fetchImpl: typeof fetch) => {
    currentLocale = locale;
    const html = withoutStyles(await page({}, fetchImpl));
    return rows(html).find((row) => row.label === "Vremea" || row.label === "Weather")?.dd ?? "";
  };

  it("RO, rain likely: the word, the degrees and the umbrella with «ploaie probabilă» — no chance, no wind", async () => {
    const dd = await line("ro", rainy());
    expect(text(dd)).toContain("Ploaie");
    expect(text(dd)).toContain("16 °C");
    expect(text(dd)).toContain("ploaie probabilă");
    expect(dd).toContain('data-testid="weather-rain-likely"');
    expect(text(dd)).not.toContain("km/h");
    expect(text(dd)).not.toContain("șanse");
  });

  it("RO, rain unlikely: the word and the degrees alone", async () => {
    const dd = await line("ro", dry());
    expect(text(dd)).toContain("Parțial noros");
    expect(text(dd)).toContain("16 °C");
    expect(dd).not.toContain('data-testid="weather-rain-likely"');
    expect(text(dd)).not.toMatch(/ploaie|km\/h|%/);
  });

  it("EN, rain likely and unlikely", async () => {
    const wet = await line("en", rainy());
    expect(text(wet)).toContain("Rain");
    expect(text(wet)).toContain("16 °C");
    expect(text(wet)).toContain("rain likely");
    expect(text(wet)).not.toMatch(/km\/h|chance/);
    const fine = await line("en", dry());
    expect(text(fine)).toContain("Partly cloudy");
    expect(text(fine)).not.toMatch(/rain|km\/h|%/);
  });

  it("is no row at all without a forecast", async () => {
    const html = await page({}, failing);
    expect(rows(html).map((row) => row.label)).not.toContain("Vremea");
    expect(html).not.toContain('data-testid="event-weather"');
  });

  it("is read at the pin the map link carries", async () => {
    await weatherDd({ mapUrl: "https://www.google.com/maps?q=45.6427,25.5887" });
    expect(asked).toHaveLength(1);
    expect(asked[0].searchParams.get("latitude")).toBe("45.643");
    expect(asked[0].searchParams.get("longitude")).toBe("25.589");
  });

  it("is read at the typed «Coordonate» when the link is a short one, which is never followed", async () => {
    await weatherDd({ mapUrl: "https://maps.app.goo.gl/AbCdEf123", latitude: 45.6384, longitude: 25.5921 });
    expect(asked).toHaveLength(1);
    expect(asked[0].searchParams.get("latitude")).toBe("45.638");
    expect(asked[0].searchParams.get("longitude")).toBe("25.592");
  });

  it("falls back to the club's place", async () => {
    await weatherDd({ mapUrl: "https://maps.app.goo.gl/AbCdEf123" });
    expect(Number(asked[0].searchParams.get("latitude"))).toBeCloseTo(env.CLUB_COORDINATES.latitude, 3);
    expect(Number(asked[0].searchParams.get("longitude"))).toBeCloseTo(env.CLUB_COORDINATES.longitude, 3);
  });

  it("reads the club's place for a place still to be announced, never the withheld pin (§328)", async () => {
    await page({ locationToBeAnnounced: true, mapUrl: "https://www.google.com/maps?q=45.5,25.3", latitude: 45.5, longitude: 25.3 });
    expect(Number(asked[0].searchParams.get("latitude"))).toBeCloseTo(env.CLUB_COORDINATES.latitude, 3);
  });
});

describe("BR-REQ-041-01 the listing reads every card's forecast at once (§416)", () => {
  const at = (id: string, overrides: Partial<PublicEvent> = {}) => event({ id, ...overrides });

  it("shares one request among the events at one rounded place, and asks again for another place", async () => {
    const fetchImpl = openMeteo();
    const found = await forecastsForEvents(
      [
        at("a"),
        at("b", { startsAt: new Date("2026-09-27T05:00:00Z") }),
        at("c", { latitude: 45.6384, longitude: 25.5921 }),
        at("d", { mapUrl: "https://www.google.com/maps?q=45.63841,25.59209" }),
      ],
      NOW,
      { fetch: fetchImpl, source: "open-meteo" },
    );
    // a and b at the club's centre, c and d at one trailhead (the same three decimals): two requests.
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect([...found.keys()].sort()).toEqual(["a", "b", "c", "d"]);
    expect(found.get("a")?.place).toBe("club");
    expect(found.get("c")?.place).toBe("typed");
    expect(found.get("d")?.place).toBe("map");
    expect(found.get("a")?.start.temperatureC).toBe(16.2);
  });

  it("asks nothing for an event beyond seven days, behind us, or cancelled — and has no entry for it", async () => {
    const fetchImpl = openMeteo();
    const found = await forecastsForEvents(
      [
        at("far", { startsAt: new Date(NOW.getTime() + 8 * 24 * HOUR) }),
        at("past", { startsAt: new Date(NOW.getTime() - HOUR) }),
        at("off", { eventStatus: "CANCELLED" }),
      ],
      NOW,
      { fetch: fetchImpl, source: "open-meteo" },
    );
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(found.size).toBe(0);
  });

  it("has no entry when Open-Meteo fails", async () => {
    const found = await forecastsForEvents([at("a")], NOW, { fetch: failing, source: "open-meteo", timeoutMs: 50 });
    expect(found.size).toBe(0);
  });
});
