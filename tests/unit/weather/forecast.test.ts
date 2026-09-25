import { describe, expect, it, vi } from "vitest";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import {
  type HourlyForecast,
  parseOpenMeteo,
  pickHour,
  WEATHER_FORECAST_DAYS,
  WEATHER_WINDOW_DAYS,
  weatherInstant,
  withinWeatherWindow,
} from "@/modules/weather/domain/forecast";
import { GLYPH_BY_KIND, WEATHER_GLYPH_NAMES, WEATHER_KINDS, weatherKind } from "@/modules/weather/domain/wmo";
import {
  fetchOpenMeteo,
  freshReading,
  isForecastStale,
  MAX_FORECAST_AGE_MS,
  openMeteoUrl,
  readClubForecast,
  STUB_READING,
  stubForecast,
  WEATHER_CACHE_SECONDS,
  WEATHER_TIMEOUT_MS,
  weatherForEvent,
} from "@/modules/weather/source";
import { WEATHER_GLYPH } from "@/modules/weather/ui/glyphs";
import { weatherWords } from "@/modules/weather/words";
import { OPEN_METEO_API, OPEN_METEO_SITE } from "@/modules/weather/domain/credit";
import { env, envSchema } from "@/shared/config/env";

/**
 * §NNN — the weather at an event's start, from Open-Meteo: the WMO code map, the hour a start
 * reads, the seven-day window, every failure read as no forecast, and the words in both
 * languages. No test here opens a socket: every request goes through a `fetch` handed in.
 */

const HOUR = 60 * 60 * 1000;
/** Saturday 26 September 2026, 08:00 in Brașov (05:00Z) — a start two days after NOW. */
const START = new Date("2026-09-26T05:00:00Z");
const NOW = new Date("2026-09-24T09:00:00Z");

/** Open-Meteo's own answer, in the shape `openMeteoUrl` asks for: Unix seconds and one column per variable. */
function answer(overrides: Partial<Record<"weather_code" | "temperature_2m" | "precipitation_probability" | "wind_speed_10m", (number | null)[]>> = {}) {
  const first = Math.floor(NOW.getTime() / HOUR) * HOUR;
  const time = Array.from({ length: WEATHER_FORECAST_DAYS * 24 }, (_, index) => (first + index * HOUR) / 1000);
  return {
    latitude: 45.64,
    longitude: 25.58,
    hourly_units: { time: "unixtime", temperature_2m: "°C" },
    hourly: {
      time,
      temperature_2m: time.map(() => 13.6),
      precipitation_probability: time.map(() => 35),
      weather_code: time.map(() => 61),
      wind_speed_10m: time.map(() => 9.4),
      ...overrides,
    },
  };
}

const json = (body: unknown, status = 200) =>
  vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })) as unknown as typeof fetch;

function forecast(): HourlyForecast {
  const parsed = parseOpenMeteo(answer(), NOW.getTime());
  if (!parsed) throw new Error("the fixture is not a forecast");
  return parsed;
}

describe("§NNN the WMO weather codes, in words and glyphs", () => {
  it("names every code Open-Meteo documents, and nothing else", () => {
    const documented = [0, 1, 2, 3, 45, 48, 51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 71, 73, 75, 77, 80, 81, 82, 85, 86, 95, 96, 99];
    for (const code of documented) expect(weatherKind(code), `code ${code}`).not.toBeNull();
    for (const code of [4, 10, 50, 60, 100, -1]) expect(weatherKind(code), `code ${code}`).toBeNull();
  });

  it("folds intensity a runner does not need, and keeps the ones that change what they pack", () => {
    expect(weatherKind(61)).toBe("rain");
    expect(weatherKind(63)).toBe("rain");
    expect(weatherKind(65)).toBe("heavyRain");
    expect(weatherKind(82)).toBe("heavyRain");
    expect(weatherKind(80)).toBe("showers");
    expect(weatherKind(66)).toBe("freezingRain");
    expect(weatherKind(99)).toBe("thunderstormHail");
  });

  it("gives every kind a glyph, every glyph an icon, and every kind a word in both catalogues", () => {
    for (const kind of WEATHER_KINDS) {
      expect(WEATHER_GLYPH_NAMES).toContain(GLYPH_BY_KIND[kind]);
      expect(ro.Weather.codes[kind], `ro ${kind}`).toBeTruthy();
      expect(en.Weather.codes[kind], `en ${kind}`).toBeTruthy();
    }
    for (const name of WEATHER_GLYPH_NAMES) expect(WEATHER_GLYPH[name], name).toBeDefined();
    expect(Object.keys(ro.Weather.codes).sort()).toEqual([...WEATHER_KINDS].sort());
    expect(Object.keys(en.Weather.codes).sort()).toEqual([...WEATHER_KINDS].sort());
  });
});

describe("§NNN the hour a start reads", () => {
  it("reads the hour nearest the start: 08:00 its own, 08:20 the 08:00 hour, 08:30 the 09:00 one", () => {
    const hours = forecast();
    expect(pickHour(hours, START)?.hourAt).toBe(START.getTime());
    expect(pickHour(hours, new Date(START.getTime() + 20 * 60_000))?.hourAt).toBe(START.getTime());
    expect(pickHour(hours, new Date(START.getTime() + 30 * 60_000))?.hourAt).toBe(START.getTime() + HOUR);
  });

  it("carries the hour's numbers, its kind and its glyph name", () => {
    expect(pickHour(forecast(), START)).toEqual({
      hourAt: START.getTime(),
      code: 61,
      kind: "rain",
      glyph: "rain",
      temperatureC: 13.6,
      precipitationProbability: 35,
      windKmh: 9.4,
    });
  });

  it("reads a race at its gun time, anything else at its start", () => {
    const gun = new Date(START.getTime() + HOUR);
    expect(weatherInstant({ startsAt: START, raceStartsAt: gun })).toBe(gun);
    expect(weatherInstant({ startsAt: START, raceStartsAt: null })).toBe(START);
  });

  it("is null for an hour the answer does not hold, a missing code, or a code with no word", () => {
    expect(pickHour(forecast(), new Date(NOW.getTime() + 20 * 24 * HOUR))).toBeNull();
    const index = (START.getTime() - Math.floor(NOW.getTime() / HOUR) * HOUR) / HOUR;
    const codes = (value: number | null) => answer().hourly.weather_code.map((code, i) => (i === index ? value : code));
    expect(pickHour(parseOpenMeteo(answer({ weather_code: codes(null) }), 0) as HourlyForecast, START)).toBeNull();
    expect(pickHour(parseOpenMeteo(answer({ weather_code: codes(4) }), 0) as HourlyForecast, START)).toBeNull();
  });

  it("keeps an hour whose other numbers are missing, without them", () => {
    const nulls = answer().hourly.time.map(() => null);
    const reading = pickHour(parseOpenMeteo(answer({ temperature_2m: nulls, precipitation_probability: nulls, wind_speed_10m: nulls }), 0) as HourlyForecast, START);
    expect(reading).toMatchObject({ kind: "rain", temperatureC: null, precipitationProbability: null, windKmh: null });
  });
});

describe("§NNN the seven days a forecast is shown for", () => {
  it("is ahead of now and no more than seven days away", () => {
    expect(WEATHER_WINDOW_DAYS).toBe(7);
    expect(withinWeatherWindow(START, NOW)).toBe(true);
    expect(withinWeatherWindow(new Date(NOW.getTime() + 7 * 24 * HOUR), NOW)).toBe(true);
    expect(withinWeatherWindow(new Date(NOW.getTime() + 7 * 24 * HOUR + 60_000), NOW)).toBe(false);
    expect(withinWeatherWindow(new Date(NOW.getTime() - 60_000), NOW)).toBe(false);
  });

  it("asks for one day more than the window, so a start seven days from a late evening is inside the answer", () => {
    expect(WEATHER_FORECAST_DAYS).toBe(8);
    expect(new URL(openMeteoUrl()).searchParams.get("forecast_days")).toBe("8");
  });

  it("makes no request for a start beyond the window, behind us, or of an event not going ahead", async () => {
    const fetchImpl = json(answer());
    const far = new Date(NOW.getTime() + 8 * 24 * HOUR);
    expect(await weatherForEvent({ startsAt: far }, NOW, { fetch: fetchImpl, source: "open-meteo" })).toBeNull();
    expect(await weatherForEvent({ startsAt: new Date(NOW.getTime() - HOUR) }, NOW, { fetch: fetchImpl, source: "open-meteo" })).toBeNull();
    expect(await weatherForEvent({ startsAt: START, eventStatus: "CANCELLED" }, NOW, { fetch: fetchImpl, source: "open-meteo" })).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("§NNN the request, and every failure read as no forecast", () => {
  it("asks Open-Meteo's forecast for the club's place, hourly, in Unix time and km/h", async () => {
    const fetchImpl = json(answer());
    await fetchOpenMeteo(fetchImpl, () => NOW.getTime());
    const url = new URL(String((fetchImpl as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][0]));
    expect(`${url.origin}${url.pathname}`).toBe(`${OPEN_METEO_API}/v1/forecast`);
    expect(url.searchParams.get("hourly")).toBe("temperature_2m,precipitation_probability,weather_code,wind_speed_10m");
    expect(url.searchParams.get("timeformat")).toBe("unixtime");
    expect(url.searchParams.get("wind_speed_unit")).toBe("kmh");
    // No key: the API is public, and the request carries nothing of the club's.
    expect(url.searchParams.has("apikey")).toBe(false);
  });

  it("waits three seconds and keeps an answer an hour", () => {
    expect(WEATHER_TIMEOUT_MS).toBe(3_000);
    expect(WEATHER_CACHE_SECONDS).toBe(3_600);
  });

  it("reads the start's forecast when Open-Meteo answers", async () => {
    const reading = await weatherForEvent({ startsAt: START }, NOW, { fetch: json(answer()), source: "open-meteo" });
    expect(reading).toMatchObject({ kind: "rain", temperatureC: 13.6 });
  });

  it("is null on an HTTP error, a body that is not a forecast, a network failure and a timeout", async () => {
    const cases: Array<[string, typeof fetch, string]> = [
      ["HTTP 503", json({ error: true, reason: "busy" }, 503), "HTTP 503"],
      ["an error object", json({ error: true, reason: "Parameter is wrong" }), "unreadable"],
      ["columns that disagree", json(answer({ weather_code: [1, 2, 3] })), "unreadable"],
      ["not JSON", vi.fn(async () => new Response("<html>", { status: 200 })) as unknown as typeof fetch, "unreadable"],
      ["a network failure", vi.fn(async () => Promise.reject(new TypeError("fetch failed"))) as unknown as typeof fetch, "network"],
      [
        "no answer in time",
        vi.fn(
          (_url: string, init?: RequestInit) =>
            new Promise<Response>((_resolve, reject) => {
              init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
            }),
        ) as unknown as typeof fetch,
        "timeout",
      ],
    ];
    for (const [name, fetchImpl, reason] of cases) {
      const read = await readClubForecast({ fetch: fetchImpl, source: "open-meteo", now: NOW.getTime(), timeoutMs: 20 });
      expect(read, name).toEqual({ ok: false, reason });
      expect(await weatherForEvent({ startsAt: START }, NOW, { fetch: fetchImpl, source: "open-meteo", timeoutMs: 20 }), name).toBeNull();
    }
  });

  it("never opens a socket in the tests (`off`), and the end-to-end stub answers without one", async () => {
    const fetchImpl = json(answer());
    expect(await readClubForecast({ fetch: fetchImpl, source: "off" })).toEqual({ ok: false, reason: "off" });
    const stub = await weatherForEvent({ startsAt: START }, NOW, { fetch: fetchImpl, source: "stub" });
    expect(stub).toMatchObject({
      code: STUB_READING.weatherCode,
      kind: "partlyCloudy",
      temperatureC: STUB_READING.temperatureC,
      precipitationProbability: STUB_READING.precipitationProbability,
      windKmh: STUB_READING.windKmh,
    });
    expect(fetchImpl).not.toHaveBeenCalled();
    // The stub covers the whole window from its clock, so any start inside it finds its hour.
    const hours = stubForecast(NOW.getTime());
    expect(pickHour(hours, new Date(NOW.getTime() + WEATHER_WINDOW_DAYS * 24 * HOUR))).not.toBeNull();
  });
});

describe("§NNN a cached answer too old to trust", () => {
  it("bounds the age at twice the cache's own step", () => {
    expect(MAX_FORECAST_AGE_MS).toBe(2 * WEATHER_CACHE_SECONDS * 1000);
  });

  it("is not stale a moment after it was fetched, or exactly at the bound", () => {
    const fresh = forecast();
    expect(isForecastStale(fresh, NOW.getTime())).toBe(false);
    expect(isForecastStale(fresh, NOW.getTime() + MAX_FORECAST_AGE_MS)).toBe(false);
  });

  it("is stale past the bound — stale-while-revalidate cannot serve an outage's old answer as current", () => {
    const fresh = forecast();
    expect(isForecastStale(fresh, NOW.getTime() + MAX_FORECAST_AGE_MS + 1)).toBe(true);
  });

  it("reads no hour from a forecast fetched 3 hours before now, even though the hour is in it", () => {
    const stale = { ...forecast(), fetchedAt: NOW.getTime() - 3 * HOUR };
    expect(freshReading(stale, START, NOW.getTime())).toBeNull();
    // The same forecast, fresh, does hold that hour — staleness is the only difference.
    expect(freshReading(forecast(), START, NOW.getTime())).not.toBeNull();
  });

  it("asks again at once when the cache hands back an old entry after a quiet spell, and shows that answer", async () => {
    const old = { ...forecast(), fetchedAt: NOW.getTime() - 3 * HOUR, weatherCode: forecast().weatherCode.map(() => 0) };
    const cached = vi.fn(async () => old);
    const fetchImpl = json(answer());
    const reading = await weatherForEvent({ startsAt: START }, NOW, { cached, fetch: fetchImpl, source: "open-meteo" });
    // The fresh answer's rain, not the old entry's clear sky.
    expect(reading).toMatchObject({ kind: "rain", temperatureC: 13.6 });
    expect(cached).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("shows nothing when the old entry's fresh request fails — an outage, not a quiet spell", async () => {
    const cached = vi.fn(async () => ({ ...forecast(), fetchedAt: NOW.getTime() - 3 * HOUR }));
    const failing = json({ error: true, reason: "busy" }, 503);
    expect(await weatherForEvent({ startsAt: START }, NOW, { cached, fetch: failing, source: "open-meteo" })).toBeNull();
    expect(await readClubForecast({ cached, fetch: failing, source: "open-meteo", now: NOW.getTime() })).toEqual({ ok: false, reason: "HTTP 503" });
    expect(failing).toHaveBeenCalledTimes(2);
  });

  it("asks nothing when the cached entry is inside the bound", async () => {
    const cached = vi.fn(async () => forecast());
    const fetchImpl = json(answer());
    expect(await weatherForEvent({ startsAt: START }, NOW, { cached, fetch: fetchImpl, source: "open-meteo" })).not.toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("§NNN the place is the club's own", () => {
  it("asks for `CLUB_COORDINATES`, the place the night-event decision reads (§394)", () => {
    const url = new URL(openMeteoUrl());
    expect(Number(url.searchParams.get("latitude"))).toBe(env.CLUB_COORDINATES.latitude);
    expect(Number(url.searchParams.get("longitude"))).toBe(env.CLUB_COORDINATES.longitude);
    const elsewhere = new URL(openMeteoUrl({ latitude: 45.5, longitude: 25.4 }));
    expect(elsewhere.searchParams.get("latitude")).toBe("45.5");
  });

  it("derives the API from the one Open-Meteo host the credit links to", () => {
    expect(new URL(OPEN_METEO_API).host).toBe(`api.${new URL(OPEN_METEO_SITE).host}`);
  });
});

describe("§NNN where the forecast comes from, by environment", () => {
  it("is off in the tests, the stub for the end-to-end server, and Open-Meteo everywhere else", () => {
    expect(envSchema.parse({ APP_ENV: "test" }).WEATHER_SOURCE).toBe("off");
    expect(envSchema.parse({ APP_ENV: "test", E2E_WEATHER_STUB: "true" }).WEATHER_SOURCE).toBe("stub");
    expect(envSchema.parse({ APP_ENV: "local", E2E_WEATHER_STUB: "true" }).WEATHER_SOURCE).toBe("stub");
    expect(envSchema.parse({ APP_ENV: "local" }).WEATHER_SOURCE).toBe("open-meteo");
    expect(envSchema.parse({ APP_ENV: "qa" }).WEATHER_SOURCE).toBe("open-meteo");
  });

  it("never prints an invented forecast on production", () => {
    expect(envSchema.parse({ APP_ENV: "production", E2E_WEATHER_STUB: "true" }).WEATHER_SOURCE).toBe("open-meteo");
  });
});

describe("§NNN the forecast in words, in both languages", () => {
  const reading = { hourAt: START.getTime(), code: 2, kind: "partlyCloudy", glyph: "partlyCloudy", temperatureC: 13.6, precipitationProbability: 20, windKmh: 11.4 } as const;

  it("says the kind, whole degrees, the chance of rain and the wind in Romanian", () => {
    const words = weatherWords(reading, "ro");
    expect(words.label).toBe("Vremea");
    expect(words.summary).toBe("Parțial noros");
    expect(words.details).toEqual(["14 °C", "20% șanse de ploaie", "vânt 11 km/h"]);
    expect(words.credit).toBe("Prognoză: Open-Meteo");
  });

  it("and in English", () => {
    const words = weatherWords(reading, "en");
    expect(words.label).toBe("Weather");
    expect(words.summary).toBe("Partly cloudy");
    expect(words.details).toEqual(["14 °C", "20% chance of rain", "wind 11 km/h"]);
    expect(words.credit).toBe("Forecast: Open-Meteo");
  });

  it("never says «-0 °C», keeps a frost's minus, and leaves out a number the hour does not have", () => {
    expect(weatherWords({ ...reading, temperatureC: -0.3 }, "ro").details[0]).toBe("0 °C");
    expect(weatherWords({ ...reading, temperatureC: -4.6 }, "en").details[0]).toMatch(/^[-−]5 °C$/);
    expect(weatherWords({ ...reading, precipitationProbability: null, windKmh: null }, "ro").details).toEqual(["14 °C"]);
  });
});
