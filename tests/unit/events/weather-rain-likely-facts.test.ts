import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { EventForecast, WeatherReading } from "@/modules/weather/domain/forecast";
import type { PublicEvent } from "@/modules/events/repository";

/**
 * BR-REQ-011-01 / §429 (fix round on §401's weather chip: the rain-likely rule also applies to
 * the featured hero's «Vremea» line and the event page's weather block — an umbrella beside the
 * rain percentage, and "ploaie probabilă" / "rain likely" in the accessible text, exactly as
 * `CardWeather` already draws it on the listing card).
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

afterEach(() => {
  currentLocale = "ro";
});

const NOW = new Date("2026-09-01T09:00:00.000Z");

function event(overrides: Partial<PublicEvent> = {}): PublicEvent {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    type: "RACE",
    surface: "ASPHALT",
    eventStatus: "SCHEDULED",
    startsAt: new Date("2026-09-26T05:00:00Z"),
    endsAt: null,
    raceStartsAt: null,
    timezone: "Europe/Bucharest",
    mapUrl: "https://maps.example.test/tractorul",
    routeUrl: null,
    stravaEventUrl: null,
    facebookEventUrl: null,
    coHosts: null,
    coHostName: null,
    coHostUrl: null,
    featured: false,
    isSpecial: false,
    distanceMeters: 10000,
    elevationGainMeters: 300,
    registrationMode: "INTERNAL",
    registrationOpensAt: null,
    registrationClosesAt: null,
    externalRegistrationUrl: null,
    externalProvider: null,
    minAge: 14,
    slug: "test-bvr",
    title: "Test BVR",
    excerpt: "Zece kilometri.",
    locationName: "Parcul Sportiv Tractorul – intrarea dinspre Patinoarul Olimpic",
    locationAddress: "Strada Nicolae Labiș, Brașov",
    locationToBeAnnounced: false,
    difficulty: "EASY",
    costType: "FREE",
    costAmount: null,
    costUrl: null,
    publishedAt: NOW,
    ...overrides,
  } as PublicEvent;
}

const reading = (overrides: Partial<WeatherReading> = {}): WeatherReading => ({
  hourAt: NOW.getTime(),
  code: 3,
  kind: "overcast",
  glyph: "cloud",
  temperatureC: 12,
  precipitationProbability: 30,
  windKmh: 9,
  feelsLikeC: 10,
  precipitationMm: 0,
  gustKmh: 20,
  humidity: 70,
  uvIndex: 1,
  ...overrides,
});

const forecast = (start: WeatherReading): EventForecast => ({ start, hours: [start], place: "typed" });

const withoutStyles = (html: string) => html.replace(/<style[^>]*>[\s\S]*?<\/style>/g, "");
const text = (fragment: string) => fragment.replace(/<[^>]+>/g, "");

/** The umbrella's phrase follows the rain phrase and comes before the wind (§429), never after it. */
function expectUmbrellaBetweenRainAndWind(line: string, rain = "60% șanse de ploaie", likely = "ploaie probabilă", wind = "vânt") {
  const at = line.indexOf(likely);
  expect(line.indexOf(rain), line).toBeGreaterThanOrEqual(0);
  expect(at, line).toBeGreaterThan(line.indexOf(rain));
  expect(at, line).toBeLessThan(line.indexOf(wind));
}

/** The event page's weather block up to its details line: the summary pieces alone. */
const eventWeatherSummary = (html: string) => {
  const block = html.slice(html.indexOf('data-testid="event-weather"'));
  const end = block.search(/data-testid="(weather-details|weather-hours|weather-credit)"/);
  return text(end >= 0 ? block.slice(0, end) : block);
};

describe("the hero's «Vremea» line wears the umbrella when rain is likely (§429)", () => {
  it("adds no umbrella below the rain-likely threshold", async () => {
    const html = withoutStyles(
      renderToStaticMarkup(
        await EventFacts({ event: event(), now: NOW, stacked: false, weather: forecast(reading({ precipitationProbability: 30 })) }),
      ),
    );
    const dd = /data-testid="hero-weather">([\s\S]*?)<\/dd>/.exec(html)?.[1] ?? "";
    expect(dd).not.toContain("UmbrellaIcon");
    expect(text(dd)).not.toContain("ploaie probabilă");
  });

  it("draws the umbrella beside the rain percentage and says «ploaie probabilă» when rain is likely", async () => {
    const html = withoutStyles(
      renderToStaticMarkup(
        await EventFacts({ event: event(), now: NOW, stacked: false, weather: forecast(reading({ precipitationProbability: 60 })) }),
      ),
    );
    const dd = /data-testid="hero-weather">([\s\S]*?)<\/dd>/.exec(html)?.[1] ?? "";
    expect(dd).toContain('data-testid="UmbrellaIcon"');
    expect(text(dd)).toContain("60% șanse de ploaie");
    expect(text(dd)).toContain("ploaie probabilă");
    expectUmbrellaBetweenRainAndWind(text(dd));
  });

  it("with no chance but an amount already falling, the umbrella follows the temperature", async () => {
    const html = withoutStyles(
      renderToStaticMarkup(
        await EventFacts({
          event: event(),
          now: NOW,
          stacked: false,
          weather: forecast(reading({ precipitationProbability: null, precipitationMm: 0.5 })),
        }),
      ),
    );
    const line = text(/data-testid="hero-weather">([\s\S]*?)<\/dd>/.exec(html)?.[1] ?? "");
    expect(line).not.toContain("șanse de ploaie");
    const at = line.indexOf("ploaie probabilă");
    expect(at, line).toBeGreaterThan(line.indexOf("12 °C"));
    expect(line.indexOf("12 °C"), line).toBeGreaterThanOrEqual(0);
    expect(at, line).toBeLessThan(line.indexOf("vânt"));
  });

  it("never draws it on a snowy hour, whatever the chance", async () => {
    const html = withoutStyles(
      renderToStaticMarkup(
        await EventFacts({
          event: event(),
          now: NOW,
          stacked: false,
          weather: forecast(reading({ code: 73, kind: "snow", glyph: "snow", precipitationProbability: 90 })),
        }),
      ),
    );
    const dd = /data-testid="hero-weather">([\s\S]*?)<\/dd>/.exec(html)?.[1] ?? "";
    expect(dd).not.toContain('data-testid="UmbrellaIcon"');
  });
});

describe("the event page's weather block wears the umbrella when rain is likely (§429)", () => {
  it("adds no umbrella below the threshold", async () => {
    const html = withoutStyles(
      renderToStaticMarkup(
        await EventFacts({ event: event(), now: NOW, stacked: true, weather: forecast(reading({ precipitationProbability: 30 })) }),
      ),
    );
    expect(html).not.toContain('data-testid="weather-rain-likely"');
  });

  it("draws the umbrella beside the rain percentage and says «ploaie probabilă» when rain is likely", async () => {
    const html = withoutStyles(
      renderToStaticMarkup(
        await EventFacts({ event: event(), now: NOW, stacked: true, weather: forecast(reading({ precipitationProbability: 60 })) }),
      ),
    );
    expect(html).toContain('data-testid="weather-rain-likely"');
    expect(text(html)).toContain("60% șanse de ploaie");
    expect(text(html)).toContain("ploaie probabilă");
    expectUmbrellaBetweenRainAndWind(eventWeatherSummary(html));
  });

  it("with no chance but an amount already falling, the umbrella follows the temperature", async () => {
    const html = withoutStyles(
      renderToStaticMarkup(
        await EventFacts({
          event: event(),
          now: NOW,
          stacked: true,
          weather: forecast(reading({ precipitationProbability: null, precipitationMm: 0.5 })),
        }),
      ),
    );
    const line = eventWeatherSummary(html);
    expect(line).not.toContain("șanse de ploaie");
    const at = line.indexOf("ploaie probabilă");
    expect(line.indexOf("12 °C"), line).toBeGreaterThanOrEqual(0);
    expect(at, line).toBeGreaterThan(line.indexOf("12 °C"));
    expect(at, line).toBeLessThan(line.indexOf("vânt"));
  });

  it("in English: \"rain likely\"", async () => {
    currentLocale = "en";
    const html = withoutStyles(
      renderToStaticMarkup(
        await EventFacts({ event: event(), now: NOW, stacked: true, weather: forecast(reading({ precipitationProbability: 60 })) }),
      ),
    );
    expect(text(html)).toContain("rain likely");
  });
});
