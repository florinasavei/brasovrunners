import { unstable_cache } from "next/cache";
import { env } from "@/shared/config/env";
import {
  type HourlyForecast,
  parseOpenMeteo,
  pickHour,
  WEATHER_FORECAST_DAYS,
  type WeatherReading,
  weatherInstant,
  withinWeatherWindow,
} from "./domain/forecast";

/**
 * The weather at an event's start, from Open-Meteo (§NNN; the owner, 2026-09-25: "vreau să afișez
 * și starea vremii bazat pe ceva API — API gratis evident").
 *
 * **Why Open-Meteo.** Free, keyless and without an account: nothing to sign up for, no secret on
 * Vercel, no row on the task board, and nothing to rotate. Its data is CC BY 4.0, so the page
 * credits it ("Prognoză: Open-Meteo") and the reminder names it. Its free tier is for
 * non-commercial use under 10 000 calls a day; the club makes about 24 (one an hour, below).
 *
 * **Server only.** The browser never talks to it (§110's rule for YouTube: a visitor's page fetches
 * nothing from a third party until the visitor asks) — the server asks, and the page carries words.
 *
 * **One request an hour, for the club's place.** Every club event is in Brașov (`CLUB_LOCALITY`,
 * §328), so one forecast for the club's coordinates serves every event page and every reminder:
 * eight days of hours, a few kilobytes, kept in Next's data cache for an hour under the tag
 * `weather:forecast` (`WEATHER_CACHE_TAG`). The page is still rendered per request (§333); the
 * forecast under it is not refetched per request.
 *
 * **A cached answer is not aged by the cache alone.** `unstable_cache`'s stale-while-revalidate
 * hands back the entry it has immediately and revalidates in the background (Next 16.3.4,
 * `unstable-cache.js`) — including when that background revalidation keeps failing, which it
 * swallows rather than surfacing. Left alone, that means an Open-Meteo outage does not empty the
 * cache; it freezes it, and every visitor for as long as the outage lasts reads whatever hour the
 * last good answer happened to hold for their event's start. So `fetchedAt` is checked against
 * `MAX_FORECAST_AGE_MS` wherever a forecast is read (`freshReading`, `readWeatherStatus`): an
 * answer older than that is treated exactly like a failure, never shown.
 *
 * **Failure is silence.** Three seconds and no answer, an HTTP error, a body that is not a
 * forecast, or a cached answer past `MAX_FORECAST_AGE_MS`: `null`, and the page and the reminder
 * say nothing about the weather — never "vremea nu este disponibilă", which tells a runner
 * nothing they can act on. A failure is not cached (the load throws inside `unstable_cache`), and
 * for five minutes after one this instance does not ask again, so an outage costs one visitor
 * three seconds rather than every visitor.
 *
 * `/api/health` does not read it: a page without a forecast is a working page, and a monitor
 * woken by somebody else's API would be a false alarm about the club's site (§98). The system
 * panel names it and its last answer instead (`readWeatherStatus`).
 */

/** Open-Meteo's forecast API — a third party's fixed host, listed in `scripts/docs-check.mjs` (AGENTS.md §8). */
export const OPEN_METEO_BASE = "https://api.open-meteo.com";

/**
 * Where the forecast is asked for: the club's place, Brașov's centre (Piața Sfatului). The same
 * coordinates as the sunset's default (`DEFAULT_CLUB_COORDINATES`, the night-event decision); a
 * forecast is a grid cell of a few kilometres, so Tractorul, Tâmpa and the Olimpia stadium read
 * the same one.
 */
export const WEATHER_PLACE = { latitude: 45.6427, longitude: 25.5887 } as const;

/** The data cache's tag for the forecast — what an expiry would name. */
export const WEATHER_CACHE_TAG = "weather:forecast";

/** How long one answer stands: an hour, the forecast's own step. */
export const WEATHER_CACHE_SECONDS = 60 * 60;

/** How long a request may take before the page goes on without it. */
export const WEATHER_TIMEOUT_MS = 3_000;

/** How long this instance leaves Open-Meteo alone after a failure. */
const QUIET_AFTER_FAILURE_MS = 5 * 60 * 1000;

/**
 * How old a cached answer may be before it is treated as no forecast at all: twice the cache's
 * own step. A routine revalidation never reaches this — the entry is at most `WEATHER_CACHE_SECONDS`
 * old before Next asks again — so only an outage across more than one revalidation trips it. This
 * is the one bound `freshReading` and `readWeatherStatus` both read, so "nothing is shown when the
 * forecast is unavailable" holds through a stale-while-revalidate cache, not only between two
 * routine hours.
 */
export const MAX_FORECAST_AGE_MS = 2 * WEATHER_CACHE_SECONDS * 1000;

/** Whether a forecast answer is older than `MAX_FORECAST_AGE_MS`. */
export function isForecastStale(forecast: HourlyForecast, now: number): boolean {
  return now - forecast.fetchedAt > MAX_FORECAST_AGE_MS;
}

/** The request, built in one place so the test reads the same address the server asks. */
export function openMeteoUrl(place: { latitude: number; longitude: number } = WEATHER_PLACE): string {
  const query = new URLSearchParams({
    latitude: String(place.latitude),
    longitude: String(place.longitude),
    hourly: "temperature_2m,precipitation_probability,weather_code,wind_speed_10m",
    wind_speed_unit: "kmh",
    timeformat: "unixtime",
    timezone: "GMT",
    forecast_days: String(WEATHER_FORECAST_DAYS),
  });
  return `${OPEN_METEO_BASE}/v1/forecast?${query.toString()}`;
}

/** Why a forecast could not be read — one word for the system panel. */
export type WeatherFailure = "timeout" | "network" | `HTTP ${number}` | "unreadable";

export class WeatherUnavailable extends Error {
  constructor(readonly reason: WeatherFailure) {
    super(`weather forecast unavailable: ${reason}`);
    this.name = "WeatherUnavailable";
  }
}

/**
 * One request to Open-Meteo, answered as a forecast or thrown as the reason it is not one.
 * `fetchImpl` and `timeoutMs` are the seams the tests answer through; the server passes neither.
 */
export async function fetchOpenMeteo(
  fetchImpl: typeof fetch = fetch,
  now: () => number = Date.now,
  timeoutMs: number = WEATHER_TIMEOUT_MS,
): Promise<HourlyForecast> {
  let response: Response;
  try {
    response = await fetchImpl(openMeteoUrl(), {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(timeoutMs),
      // Inside `unstable_cache` Next treats this as uncached anyway; said here for the uncached path.
      cache: "no-store",
    });
  } catch (error) {
    throw new WeatherUnavailable(error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError") ? "timeout" : "network");
  }
  if (!response.ok) throw new WeatherUnavailable(`HTTP ${response.status}`);
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new WeatherUnavailable("unreadable");
  }
  const forecast = parseOpenMeteo(body, now());
  if (!forecast) throw new WeatherUnavailable("unreadable");
  return forecast;
}

/**
 * The end-to-end suite's forecast (`WEATHER_SOURCE=stub`): every hour from the last one to eight
 * days ahead, partly cloudy, 14 °C, a 20% chance of rain and an 11 km/h wind — fixed, so a spec
 * can read the words, and built from the clock, so any start inside the window finds its hour.
 */
export const STUB_READING = { weatherCode: 2, temperatureC: 14, precipitationProbability: 20, windKmh: 11 } as const;

export function stubForecast(now: number): HourlyForecast {
  const HOUR = 60 * 60 * 1000;
  const first = Math.floor(now / HOUR) * HOUR;
  const hours = (WEATHER_FORECAST_DAYS + 1) * 24;
  const time = Array.from({ length: hours }, (_, index) => first + index * HOUR);
  return {
    fetchedAt: now,
    time,
    temperatureC: time.map(() => STUB_READING.temperatureC),
    precipitationProbability: time.map(() => STUB_READING.precipitationProbability),
    weatherCode: time.map(() => STUB_READING.weatherCode),
    windKmh: time.map(() => STUB_READING.windKmh),
  };
}

/** Whether a Next server with a data cache is answering — the same test as the public cache's (§333). */
function dataCacheAvailable(): boolean {
  return process.env.NEXT_RUNTIME === "nodejs" && process.env.NODE_ENV === "production" && process.env.NEXT_PHASE !== "phase-production-build";
}

/**
 * The key's version: a deployment that changes `HourlyForecast`'s shape bumps it, so it never
 * reads an entry another deployment wrote in the old one. Shared across deployments otherwise —
 * the forecast is the same whoever asks.
 */
const CACHE_KEY = ["weather", "open-meteo", "v1", String(WEATHER_PLACE.latitude), String(WEATHER_PLACE.longitude)];

const cachedOpenMeteo = unstable_cache(() => fetchOpenMeteo(), CACHE_KEY, {
  tags: [WEATHER_CACHE_TAG],
  revalidate: WEATHER_CACHE_SECONDS,
});

let quietUntil = 0;
let lastFailure: { at: number; reason: WeatherFailure } | null = null;

export type ForecastRead = { ok: true; forecast: HourlyForecast } | { ok: false; reason: WeatherFailure | "off" | "resting" };

/**
 * The club's forecast, from the cache when there is one — never throws.
 *
 * `deps` is the tests' seam: a `fetch` to answer through, and the source to read under, both
 * defaulting to the server's own.
 */
export async function readClubForecast(
  deps: { fetch?: typeof fetch; source?: typeof env.WEATHER_SOURCE; now?: number; timeoutMs?: number } = {},
): Promise<ForecastRead> {
  const source = deps.source ?? env.WEATHER_SOURCE;
  const now = deps.now ?? Date.now();
  if (source === "off") return { ok: false, reason: "off" };
  if (source === "stub") return { ok: true, forecast: stubForecast(now) };
  if (!deps.fetch && now < quietUntil) return { ok: false, reason: "resting" };
  try {
    const forecast = deps.fetch
      ? await fetchOpenMeteo(deps.fetch, () => now, deps.timeoutMs)
      : dataCacheAvailable()
        ? await cachedOpenMeteo()
        : await fetchOpenMeteo();
    return { ok: true, forecast };
  } catch (error) {
    const reason: WeatherFailure = error instanceof WeatherUnavailable ? error.reason : "unreadable";
    if (!deps.fetch) {
      quietUntil = now + QUIET_AFTER_FAILURE_MS;
      lastFailure = { at: now, reason };
      console.warn(`[weather] ${reason}; no forecast shown until it answers`);
    }
    return { ok: false, reason };
  }
}

/**
 * The reading for an already-read forecast, or null when it holds no such hour or is older than
 * `MAX_FORECAST_AGE_MS` — the one gate `weatherForEvent` and `readWeatherStatus` share, so a
 * stale-while-revalidate cache cannot hand either one an outage's old answer as if it were
 * current.
 */
export function freshReading(forecast: HourlyForecast, at: Date, now: number): WeatherReading | null {
  if (isForecastStale(forecast, now)) return null;
  return pickHour(forecast, at);
}

/**
 * The forecast for an event's start, or null — the one call the page and the reminder make.
 *
 * Null without a request when the start is behind us or more than seven days away
 * (`withinWeatherWindow`), when the event is not going ahead, on any failure, and when the
 * cached answer is older than `MAX_FORECAST_AGE_MS` (an outage the cache is still serving through).
 */
export async function weatherForEvent(
  event: { startsAt: Date; raceStartsAt?: Date | null; eventStatus?: string | null },
  now: Date,
  deps: Parameters<typeof readClubForecast>[0] = {},
): Promise<WeatherReading | null> {
  if (event.eventStatus && event.eventStatus !== "SCHEDULED") return null;
  const at = weatherInstant(event);
  if (!withinWeatherWindow(at, now)) return null;
  const read = await readClubForecast({ now: now.getTime(), ...deps });
  return read.ok ? freshReading(read.forecast, at, now.getTime()) : null;
}

/**
 * What the system panel says about the service (§NNN): the source, and its last answer — when it
 * was read and how many hours it holds — or why there is none. Reads the same cached entry the
 * pages read, so opening the panel costs no request inside the hour. A cached answer older than
 * `MAX_FORECAST_AGE_MS` reads as `reason: "stale"`, amber like every other `ok: false` — never
 * green on an entry an outage has been serving for hours or days.
 */
export type WeatherStatus =
  | { source: "off" | "stub" }
  | { source: "open-meteo"; ok: true; fetchedAt: Date; hours: number }
  | { source: "open-meteo"; ok: false; reason: WeatherFailure | "resting" | "stale"; failedAt: Date | null };

export async function readWeatherStatus(): Promise<WeatherStatus> {
  const source = env.WEATHER_SOURCE;
  if (source !== "open-meteo") return { source };
  const read = await readClubForecast();
  if (read.ok) {
    const fetchedAt = read.forecast.fetchedAt;
    if (isForecastStale(read.forecast, Date.now())) return { source, ok: false, reason: "stale", failedAt: new Date(fetchedAt) };
    return { source, ok: true, fetchedAt: new Date(fetchedAt), hours: read.forecast.time.length };
  }
  return {
    source,
    ok: false,
    reason: read.reason === "off" ? "unreadable" : read.reason,
    failedAt: lastFailure ? new Date(lastFailure.at) : null,
  };
}
