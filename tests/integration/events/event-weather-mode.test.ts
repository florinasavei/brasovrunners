import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PublicEvent } from "@/modules/events/repository";

/**
 * BR-REQ-011-01 (§NNN) — «Vremea» is the club's to choose, per event: the page's row and the cards'
 * pill follow `events.weather_mode`.
 *
 * - `forecast` — unchanged: the forecast read at the event's place, the row, the pill.
 * - `custom` — the club's own text in the page's language, as the row's whole value: no Open-Meteo
 *   request, no credit, no «?», no pill on the card; a language without a text has no row (§28).
 * - `off` — no row, no pill, no request.
 *
 * Open-Meteo is a stub `fetch` (`event-weather.test.ts`'s shape), counted, so "no request" is proven
 * rather than assumed.
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

afterEach(() => {
  currentLocale = "ro";
});

const HOUR = 60 * 60 * 1000;
const NOW = new Date("2026-09-24T09:00:00.000Z");
const ICY = "Pe creastă e polei, veniți cu colțari.";

function event(overrides: Partial<PublicEvent> = {}): PublicEvent {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    type: "GROUP_RUN",
    surface: "TRAIL",
    eventStatus: "SCHEDULED",
    // Saturday 26 September 2026, 08:00 in Brașov — two days after NOW, inside the seven days.
    startsAt: new Date("2026-09-26T05:00:00Z"),
    endsAt: null,
    raceStartsAt: null,
    timezone: "Europe/Bucharest",
    mapUrl: null,
    routeUrl: null,
    stravaEventUrl: null,
    facebookEventUrl: null,
    coHosts: [],
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
    weatherMode: "forecast",
    weatherNote: null,
    ...overrides,
  } as PublicEvent;
}

/** Open-Meteo's answer: eight days of a thunderstorm at 16 °C — the shape `event-weather.test.ts` reads. */
function openMeteo() {
  const first = Math.floor(NOW.getTime() / HOUR) * HOUR;
  const time = Array.from({ length: 8 * 24 }, (_, index) => (first + index * HOUR) / 1000);
  return vi.fn(async () =>
    new Response(
      JSON.stringify({
        hourly: {
          time,
          temperature_2m: time.map(() => 16.2),
          precipitation_probability: time.map(() => 70),
          weather_code: time.map(() => 95),
          wind_speed_10m: time.map(() => 23.4),
          apparent_temperature: time.map(() => 13.8),
          precipitation: time.map(() => 2.4),
          wind_gusts_10m: time.map(() => 41),
          relative_humidity_2m: time.map(() => 88),
          uv_index: time.map(() => 1.2),
        },
      }),
      { status: 200 },
    ),
  );
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

/** The page as `events/[slug]/page.tsx` makes it: the forecast read by the caller, then the facts. */
async function page(overrides: Partial<PublicEvent> = {}) {
  const fetchImpl = openMeteo();
  const shown = event(overrides);
  const weather = await forecastForEvent(shown, NOW, { fetch: fetchImpl as unknown as typeof fetch, source: "open-meteo", timeoutMs: 50 });
  const html = withoutStyles(renderToStaticMarkup(await EventFacts({ event: shown, now: NOW, stacked: true, weather })));
  const row = rows(html).find((candidate) => candidate.label === "Vremea" || candidate.label === "Weather");
  return { html, row, asked: fetchImpl.mock.calls.length };
}

describe("BR-REQ-011-01 «Vremea» follows the club's choice on the event page (§NNN)", () => {
  it("forecast: the forecast's row, read at Open-Meteo, as before", async () => {
    const { row, asked } = await page({ weatherMode: "forecast", weatherNote: ICY });
    expect(asked).toBe(1);
    expect(text(row?.dd ?? "")).toContain("Furtună");
    // The club's text is never shown beside the forecast: one or the other.
    expect(text(row?.dd ?? "")).not.toContain(ICY);
    expect(row?.dd).toContain('data-testid="event-weather-help"');
  });

  it("custom: the club's sentence as the row, with no request, no credit and no «?»", async () => {
    const { html, row, asked } = await page({ weatherMode: "custom", weatherNote: ICY });
    expect(asked).toBe(0);
    expect(row?.label).toBe("Vremea");
    expect(text(row?.dd ?? "")).toBe(ICY);
    expect(row?.dd).toContain('data-testid="event-weather-note"');
    expect(html).not.toContain('data-testid="event-weather-help"');
    expect(html).not.toContain('data-testid="event-weather"');
    expect(text(html)).not.toContain("Open-Meteo");
    expect(text(html)).not.toContain("Furtună");
  });

  it("custom: escapes the club's words like every text", async () => {
    const { row } = await page({ weatherMode: "custom", weatherNote: "<b>Polei</b> & ceață" });
    expect(row?.dd).toContain("&lt;b&gt;Polei&lt;/b&gt; &amp; ceață");
    expect(row?.dd).not.toContain("<b>");
  });

  it("custom: in English, the English text; a language without one has no row — never the other's words (§28)", async () => {
    currentLocale = "en";
    const english = await page({ weatherMode: "custom", weatherNote: "The ridge is icy." });
    expect(english.row?.label).toBe("Weather");
    expect(text(english.row?.dd ?? "")).toBe("The ridge is icy.");

    const none = await page({ weatherMode: "custom", weatherNote: null });
    expect(none.row).toBeUndefined();
    expect(none.asked).toBe(0);
  });

  it("off: no row, no request, whatever text is kept", async () => {
    const { html, row, asked } = await page({ weatherMode: "off", weatherNote: ICY });
    expect(asked).toBe(0);
    expect(row).toBeUndefined();
    expect(text(html)).not.toContain(ICY);
    expect(html).not.toContain('data-testid="event-weather');
  });
});

describe("BR-REQ-041-01 the cards' weather pill only in «Prognoza automată» (§NNN)", () => {
  it("the listing asks only for the events whose weather is the forecast", async () => {
    const fetchImpl = openMeteo();
    const found = await forecastsForEvents(
      [
        event({ id: "a", weatherMode: "forecast" }),
        event({ id: "b", weatherMode: "custom", weatherNote: ICY, latitude: 45.6, longitude: 25.4 }),
        event({ id: "c", weatherMode: "off", latitude: 45.7, longitude: 25.3 }),
      ],
      NOW,
      { fetch: fetchImpl as unknown as typeof fetch, source: "open-meteo" },
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect([...found.keys()]).toEqual(["a"]);
  });

  it("a card draws no pill for the club's text or none, even when handed a reading", async () => {
    const reading = (await forecastForEvent(event(), NOW, { fetch: openMeteo() as unknown as typeof fetch, source: "open-meteo" }))?.start ?? null;
    expect(reading).not.toBeNull();
    const forecastCard = renderToStaticMarkup(await EventFacts({ event: event(), now: NOW, variant: "compact", cardWeather: reading }));
    expect(forecastCard).toContain('data-testid="card-weather"');
    for (const mode of ["custom", "off"]) {
      const html = renderToStaticMarkup(await EventFacts({ event: event({ weatherMode: mode, weatherNote: ICY }), now: NOW, variant: "compact", cardWeather: reading }));
      expect(html).not.toContain('data-testid="card-weather"');
      expect(text(html)).not.toContain(ICY);
    }
  });
});
