import { unstable_cache } from "next/cache";
import type { Coordinates } from "@/modules/events/domain/sun";
import { env } from "@/shared/config/env";
import { OPEN_METEO_API } from "./domain/credit";
import {
  type EventForecast,
  type HourlyForecast,
  parseOpenMeteo,
  pickHour,
  pickHours,
  WEATHER_FORECAST_DAYS,
  type WeatherReading,
  weatherInstant,
  withinWeatherWindow,
} from "./domain/forecast";
import { forecastPlace, type PlaceColumns, roundPlace } from "./domain/place";

export type { EventForecast } from "./domain/forecast";

/**
 * The weather at an event's start, from Open-Meteo (§402; the owner, 2026-09-25: "vreau să afișez
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
 * **One request an hour per place.** §402 asked once for the club's coordinates; the owner then
 * wanted it "exact pe locația selectată" (§NNN), so each event reads its own place (below) — eight
 * days of hours, a few kilobytes, kept in Next's data cache for an hour under the tag
 * `weather:forecast` (`WEATHER_CACHE_TAG`), keyed by the rounded place. The page is still rendered
 * per request (§333); the forecast under it is not refetched per request.
 *
 * **A cached answer is not aged by the cache alone.** `unstable_cache`'s stale-while-revalidate
 * hands back the entry it has immediately and revalidates in the background (Next 16.3.4,
 * `unstable-cache.js`) — including when that background revalidation keeps failing, which it
 * swallows rather than surfacing. Left alone, that means an Open-Meteo outage does not empty the
 * cache; it freezes it, and every visitor for as long as the outage lasts reads whatever hour the
 * last good answer happened to hold for their event's start. So `fetchedAt` is checked against
 * `MAX_FORECAST_AGE_MS` wherever a forecast is read: an answer older than that is never shown.
 * It is asked again at once instead (`readClubForecast`), within the same three seconds, so a
 * quiet spell costs the next visitor nothing; only when that request fails is there no forecast.
 *
 * **Failure is silence.** Three seconds and no answer, an HTTP error, a body that is not a
 * forecast, or a cached answer past `MAX_FORECAST_AGE_MS` that cannot be refreshed: `null`, and the page and the reminder
 * say nothing about the weather — never "vremea nu este disponibilă", which tells a runner
 * nothing they can act on. A failure is not cached (the load throws inside `unstable_cache`), and
 * for five minutes after one this instance does not ask again, so an outage costs one visitor
 * three seconds rather than every visitor.
 *
 * `/api/health` does not read it: a page without a forecast is a working page, and a monitor
 * woken by somebody else's API would be a false alarm about the club's site (§98). The system
 * panel names it and its last answer instead (`readWeatherStatus`).
 */

/*
  Where the forecast is asked for (§NNN, amending §402's "one forecast for the club's place"): the
  event's own place — the pin its map link carries, else the «Coordonate» the organizer typed,
  else the club's `CLUB_COORDINATES` (§394) — read by `domain/place.ts#forecastPlace`, rounded to
  two decimals (`roundPlace`) so pins a few hundred metres apart share one cached answer. One entry
  per place per hour: the club's handful of meeting points is a handful of requests an hour, still
  far under Open-Meteo's free tier. Open-Meteo's address is `OPEN_METEO_API` (`domain/credit.ts`),
  the one module that holds its host.
*/

/** The data cache's tag for the forecast — what an expiry would name. */
export const WEATHER_CACHE_TAG = "weather:forecast";

/** How long one answer stands: an hour, the forecast's own step. */
export const WEATHER_CACHE_SECONDS = 60 * 60;

/** How long a request may take before the page goes on without it. */
export const WEATHER_TIMEOUT_MS = 3_000;

/** How long this instance leaves Open-Meteo alone after a failure. */
const QUIET_AFTER_FAILURE_MS = 5 * 60 * 1000;

/**
 * How old a cached answer may be before it is not trusted: twice the cache's own step. A busy
 * hour never reaches it; a quiet spell or an outage does. Past it `readClubForecast` asks
 * Open-Meteo again at once and shows that answer, or nothing when it fails; `freshReading` and
 * `readWeatherStatus` read the same bound, so "nothing is shown when the forecast is unavailable"
 * holds through a stale-while-revalidate cache.
 */
export const MAX_FORECAST_AGE_MS = 2 * WEATHER_CACHE_SECONDS * 1000;

/** Whether a forecast answer is older than `MAX_FORECAST_AGE_MS`. */
export function isForecastStale(forecast: HourlyForecast, now: number): boolean {
  return now - forecast.fetchedAt > MAX_FORECAST_AGE_MS;
}

/** The hourly variables asked for, in the order `parseOpenMeteo` reads them. */
export const OPEN_METEO_HOURLY = [
  "temperature_2m",
  "precipitation_probability",
  "weather_code",
  "wind_speed_10m",
  "apparent_temperature",
  "precipitation",
  "wind_gusts_10m",
  "relative_humidity_2m",
  "uv_index",
] as const;

/** The request, built in one place so the test reads the same address the server asks. */
export function openMeteoUrl(place: Coordinates = env.CLUB_COORDINATES): string {
  const query = new URLSearchParams({
    latitude: String(place.latitude),
    longitude: String(place.longitude),
    // §402's four, then the page's details (§NNN): how warm it feels, how much falls, the gusts,
    // the humidity and the UV index — one request, the same few kilobytes.
    hourly: OPEN_METEO_HOURLY.join(","),
    wind_speed_unit: "kmh",
    timeformat: "unixtime",
    timezone: "GMT",
    forecast_days: String(WEATHER_FORECAST_DAYS),
  });
  return `${OPEN_METEO_API}/v1/forecast?${query.toString()}`;
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
  place: Coordinates = env.CLUB_COORDINATES,
): Promise<HourlyForecast> {
  let response: Response;
  try {
    response = await fetchImpl(openMeteoUrl(place), {
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
 * days ahead, partly cloudy, 14 °C, a 20% chance of rain and an 11 km/h wind — and the page's
 * details (§NNN): feels like 12 °C, 0.4 mm, gusts of 24 km/h, 72% humidity, UV index 3 — fixed, so
 * a spec can read the words, and built from the clock, so any start inside the window finds its
 * hour. The same at every place: the stub answers without asking where.
 */
export const STUB_READING = {
  weatherCode: 2,
  temperatureC: 14,
  precipitationProbability: 20,
  windKmh: 11,
  feelsLikeC: 12,
  precipitationMm: 0.4,
  gustKmh: 24,
  humidity: 72,
  uvIndex: 3,
} as const;

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
    feelsLikeC: time.map(() => STUB_READING.feelsLikeC),
    precipitationMm: time.map(() => STUB_READING.precipitationMm),
    gustKmh: time.map(() => STUB_READING.gustKmh),
    humidity: time.map(() => STUB_READING.humidity),
    uvIndex: time.map(() => STUB_READING.uvIndex),
  };
}

/** Whether a Next server with a data cache is answering — the same test as the public cache's (§333). */
function dataCacheAvailable(): boolean {
  return process.env.NEXT_RUNTIME === "nodejs" && process.env.NODE_ENV === "production" && process.env.NEXT_PHASE !== "phase-production-build";
}

/**
 * The key's version: a deployment that changes `HourlyForecast`'s shape bumps it, so it never
 * reads an entry another deployment wrote in the old one. Shared across deployments otherwise —
 * the forecast is the same whoever asks. The place — rounded (`roundPlace`) — is the cached
 * function's argument, which `unstable_cache` folds into the key: one entry per place per hour, and
 * a changed `CLUB_COORDINATES` or a moved pin never reads the old place's entry. `v2` since the
 * page's details joined the answer (§NNN).
 */
const CACHE_KEY = ["weather", "open-meteo", "v2"];

const cachedOpenMeteo = unstable_cache(
  (latitude: number, longitude: number) => fetchOpenMeteo(fetch, Date.now, WEATHER_TIMEOUT_MS, { latitude, longitude }),
  CACHE_KEY,
  { tags: [WEATHER_CACHE_TAG], revalidate: WEATHER_CACHE_SECONDS },
);

let quietUntil = 0;
let lastFailure: { at: number; reason: WeatherFailure } | null = null;

export type ForecastRead = { ok: true; forecast: HourlyForecast } | { ok: false; reason: WeatherFailure | "off" | "resting" };

/** The tests' seam into `readForecast`, and what the page's callers may pass through. */
export type ForecastDeps = {
  fetch?: typeof fetch;
  source?: typeof env.WEATHER_SOURCE;
  now?: number;
  timeoutMs?: number;
  cached?: () => Promise<HourlyForecast>;
};

/** The club's own place's forecast (§394's `CLUB_COORDINATES`) — what the system panel reads. */
export function readClubForecast(deps: ForecastDeps = {}): Promise<ForecastRead> {
  return readForecast(env.CLUB_COORDINATES, deps);
}

/**
 * One place's forecast, from the cache when there is one — never throws. The place is rounded
 * first (`roundPlace`), and the request asks for the rounded place, so what is cached is exactly
 * what the key says.
 *
 * **A cached answer past `MAX_FORECAST_AGE_MS` is asked again at once.** The first request after a
 * quiet spell — a night, a weekend with no visitor — is handed the old entry by
 * stale-while-revalidate, while the revalidation it starts runs behind it. Hiding the row there
 * would hide the forecast from exactly the visitor who came back, although Open-Meteo would answer
 * straight away; so that request asks Open-Meteo itself, within the same three seconds, and shows
 * that answer. Only when that request fails too is there no forecast: then it is an outage, and the
 * old answer is never shown as current.
 *
 * `deps` is the tests' seam: a `fetch` to answer through, the source to read under, and `cached`,
 * standing in for the data cache's entry — each defaulting to the server's own.
 */
export async function readForecast(at: Coordinates, deps: ForecastDeps = {}): Promise<ForecastRead> {
  const source = deps.source ?? env.WEATHER_SOURCE;
  const now = deps.now ?? Date.now();
  if (source === "off") return { ok: false, reason: "off" };
  if (source === "stub") return { ok: true, forecast: stubForecast(now) };
  const seam = Boolean(deps.fetch || deps.cached);
  if (!seam && now < quietUntil) return { ok: false, reason: "resting" };
  const place = roundPlace(at);
  const ask = () =>
    deps.fetch ? fetchOpenMeteo(deps.fetch, () => now, deps.timeoutMs, place) : fetchOpenMeteo(fetch, Date.now, WEATHER_TIMEOUT_MS, place);
  const cached = deps.cached ?? (!deps.fetch && dataCacheAvailable() ? () => cachedOpenMeteo(place.latitude, place.longitude) : null);
  try {
    let forecast = cached ? await cached() : await ask();
    if (isForecastStale(forecast, now)) forecast = await ask();
    return { ok: true, forecast };
  } catch (error) {
    const reason: WeatherFailure = error instanceof WeatherUnavailable ? error.reason : "unreadable";
    if (!seam) {
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

/** What an event carries that the forecast reads: its start, its status, and its place (`PlaceColumns`). */
export type ForecastEvent = { startsAt: Date; raceStartsAt?: Date | null; eventStatus?: string | null } & PlaceColumns;

/**
 * The forecast for an event, or null — the one call the page, the listing and the reminder make.
 *
 * Null without a request when the start is behind us or more than seven days away
 * (`withinWeatherWindow`), when the event is not going ahead, and on any failure — a cached answer
 * older than `MAX_FORECAST_AGE_MS` whose fresh request fails included (an outage the cache would
 * otherwise serve through). Asked for the event's own place (`forecastPlace`).
 */
export async function forecastForEvent(event: ForecastEvent, now: Date, deps: ForecastDeps = {}): Promise<EventForecast | null> {
  if (event.eventStatus && event.eventStatus !== "SCHEDULED") return null;
  const at = weatherInstant(event);
  if (!withinWeatherWindow(at, now)) return null;
  const place = forecastPlace(event, env.CLUB_COORDINATES);
  const read = await readForecast(place.coordinates, { now: now.getTime(), ...deps });
  if (!read.ok) return null;
  const start = freshReading(read.forecast, at, now.getTime());
  if (!start) return null;
  return { start, hours: pickHours(read.forecast, at), place: place.source };
}

/**
 * The start's reading alone, or null — the reminder's line (§402, unchanged) and anything else that
 * says one hour. The same place and the same cached answer as the page's block.
 */
export async function weatherForEvent(event: ForecastEvent, now: Date, deps: ForecastDeps = {}): Promise<WeatherReading | null> {
  return (await forecastForEvent(event, now, deps))?.start ?? null;
}

/**
 * Every listed event's forecast at once, by id (§NNN — the owner: "aș vrea să văd vremea și pe
 * cardul principal"): the listing's hero and cards. An event outside the window asks nothing, and
 * events that meet at one rounded place share one read — the club's weekly runs are one request.
 */
export async function forecastsForEvents(
  events: readonly (ForecastEvent & { id: string })[],
  now: Date,
  deps: ForecastDeps = {},
): Promise<Map<string, EventForecast>> {
  const reads = new Map<string, Promise<ForecastRead>>();
  const found = new Map<string, EventForecast>();
  await Promise.all(
    events.map(async (event) => {
      if (event.eventStatus && event.eventStatus !== "SCHEDULED") return;
      const at = weatherInstant(event);
      if (!withinWeatherWindow(at, now)) return;
      const place = forecastPlace(event, env.CLUB_COORDINATES);
      const rounded = roundPlace(place.coordinates);
      const key = `${rounded.latitude},${rounded.longitude}`;
      let read = reads.get(key);
      if (!read) {
        read = readForecast(rounded, { now: now.getTime(), ...deps });
        reads.set(key, read);
      }
      const answer = await read;
      if (!answer.ok) return;
      const start = freshReading(answer.forecast, at, now.getTime());
      if (start) found.set(event.id, { start, hours: pickHours(answer.forecast, at), place: place.source });
    }),
  );
  return found;
}

/**
 * What the system panel says about the service (§402): the source, and its last answer — when it
 * was read and how many hours it holds — or why there is none. Reads the same cached entry the
 * pages read, so opening the panel costs no request inside the hour. An answer past
 * `MAX_FORECAST_AGE_MS` is asked again as the pages ask it; one that still reads older than that
 * reads as `reason: "stale"`, amber like every other `ok: false` — never green on an entry an
 * outage has been serving for hours or days.
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
