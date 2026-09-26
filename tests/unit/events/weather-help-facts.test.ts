import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { EventForecast, WeatherReading } from "@/modules/weather/domain/forecast";
import type { PublicEvent } from "@/modules/events/repository";

/**
 * BR-REQ-041-01 / §473: the event page's weather row ends in a discreet «?» (a render, both languages,
 * and absent without a forecast).
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

const helpButton = (html: string) => /<button[^>]*data-testid="event-weather-help"[^>]*>/.exec(html)?.[0] ?? "";

describe("the weather row's help glyph (§473)", () => {
  it("renders the «?» with the Romanian words as its accessible name", async () => {
    const html = withoutStyles(renderToStaticMarkup(await EventFacts({ event: event(), now: NOW, stacked: true, weather: forecast(reading()) })));
    const button = helpButton(html);
    expect(button).toContain('aria-label="Prognoză orientativă, poate varia până la start. Date furnizate de Open-Meteo."');
    expect(html).toContain('data-testid="HelpOutlineOutlinedIcon"');
  });

  it("renders the English words", async () => {
    currentLocale = "en";
    const html = withoutStyles(renderToStaticMarkup(await EventFacts({ event: event(), now: NOW, stacked: true, weather: forecast(reading()) })));
    expect(helpButton(html)).toContain('aria-label="An indicative forecast; it may change before the start. Data from Open-Meteo."');
  });

  it("is absent when there is no forecast", async () => {
    const html = withoutStyles(renderToStaticMarkup(await EventFacts({ event: event(), now: NOW, stacked: true, weather: null })));
    expect(html).not.toContain("event-weather-help");
    expect(html).not.toContain('data-testid="event-weather"');
  });
});
