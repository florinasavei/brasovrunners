import { z } from "zod";
import { GLYPH_BY_KIND, weatherKind, type WeatherGlyphName, type WeatherKind } from "./wmo";

/**
 * The hourly forecast, read and picked — pure, so the page, the reminder and the tests read one
 * rule (§402; the owner, 2026-09-25: "vreau să afișez și starea vremii bazat pe ceva API — API
 * gratis evident").
 */

/**
 * How far ahead a forecast is shown: seven days, counted from now to the start.
 *
 * Open-Meteo forecasts sixteen days, but a runner planning a race three weeks out reads a number
 * the weather has not decided yet, and the page would print it with the same confidence as
 * tomorrow's. Seven days is where a daily forecast still earns its line — the same week the
 * reminder, the countdown and the participation window live in — and one request covers it.
 */
export const WEATHER_WINDOW_DAYS = 7;

/**
 * The days one request asks for: the window, plus the day it starts in. Open-Meteo counts days
 * from today's midnight (GMT here), so a start 7 × 24 hours from a late-evening now falls on the
 * eighth day of the answer.
 */
export const WEATHER_FORECAST_DAYS = WEATHER_WINDOW_DAYS + 1;

const HOUR_MS = 60 * 60 * 1000;

/** One hour of the forecast, as the page and the reminder say it. */
export type WeatherReading = {
  /** The hour the reading is for, as an instant (milliseconds). */
  hourAt: number;
  code: number;
  kind: WeatherKind;
  glyph: WeatherGlyphName;
  /** Degrees Celsius, as Open-Meteo gives them (one decimal); null when the hour has none. */
  temperatureC: number | null;
  /** The chance of rain in percent (0–100); null when the hour has none. */
  precipitationProbability: number | null;
  /** Wind at ten metres in km/h; null when the hour has none. */
  windKmh: number | null;
};

/**
 * The forecast as it is kept: every hour of the answer, column by column, the way Open-Meteo
 * sends it — a few kilobytes for eight days, which is what one cached entry holds.
 */
export type HourlyForecast = {
  /** When the answer was read — "the last result" the system panel names. */
  fetchedAt: number;
  /** Each hour's instant, in milliseconds. */
  time: number[];
  temperatureC: (number | null)[];
  precipitationProbability: (number | null)[];
  weatherCode: (number | null)[];
  windKmh: (number | null)[];
};

const column = z.array(z.number().nullable());

/**
 * Open-Meteo's answer to `hourly=temperature_2m,precipitation_probability,weather_code,
 * wind_speed_10m&timeformat=unixtime`: the hours as Unix seconds and one array per variable, the
 * same length. Anything else — an error object, a missing column, arrays that disagree — is not a
 * forecast, and reads as a failure (`null` further up), never as a partial one.
 */
const openMeteoAnswer = z.object({
  hourly: z.object({
    time: z.array(z.number()),
    temperature_2m: column,
    precipitation_probability: column,
    weather_code: column,
    wind_speed_10m: column,
  }),
});

/** The answer as a forecast, or null when it is not one. */
export function parseOpenMeteo(body: unknown, fetchedAt: number): HourlyForecast | null {
  const parsed = openMeteoAnswer.safeParse(body);
  if (!parsed.success) return null;
  const hourly = parsed.data.hourly;
  const length = hourly.time.length;
  if (length === 0) return null;
  const columns = [hourly.temperature_2m, hourly.precipitation_probability, hourly.weather_code, hourly.wind_speed_10m];
  if (columns.some((values) => values.length !== length)) return null;
  return {
    fetchedAt,
    time: hourly.time.map((seconds) => seconds * 1000),
    temperatureC: hourly.temperature_2m,
    precipitationProbability: hourly.precipitation_probability,
    weatherCode: hourly.weather_code,
    windKmh: hourly.wind_speed_10m,
  };
}

/**
 * Whether a start is close enough for a forecast: ahead of now, and no more than
 * `WEATHER_WINDOW_DAYS` away. A start already behind us has weather, not a forecast.
 */
export function withinWeatherWindow(startAt: Date, now: Date): boolean {
  const ahead = startAt.getTime() - now.getTime();
  return ahead >= 0 && ahead <= WEATHER_WINDOW_DAYS * 24 * HOUR_MS;
}

/**
 * The reading for the hour nearest the start: 18:20 reads the 18:00 hour, 18:30 and later the
 * 19:00 one — Open-Meteo's hourly values are for the instant on the hour, and the nearest one is
 * the best guess at the start. Null when the answer has no such hour (a start past its last day,
 * an old answer served while a new one is fetched), when the hour's code is missing, or when the
 * code has no word (`weatherKind`).
 */
export function pickHour(forecast: HourlyForecast, startAt: Date): WeatherReading | null {
  const hourAt = Math.round(startAt.getTime() / HOUR_MS) * HOUR_MS;
  const index = forecast.time.indexOf(hourAt);
  if (index < 0) return null;
  const code = forecast.weatherCode[index];
  if (code === null || code === undefined) return null;
  const kind = weatherKind(code);
  if (!kind) return null;
  return {
    hourAt,
    code,
    kind,
    glyph: GLYPH_BY_KIND[kind],
    temperatureC: forecast.temperatureC[index] ?? null,
    precipitationProbability: forecast.precipitationProbability[index] ?? null,
    windKmh: forecast.windKmh[index] ?? null,
  };
}

/**
 * The instant a forecast is read for: a race's gun time when it has one apart from the gathering
 * (§71) — the hour the runner is out on the course — otherwise the start.
 */
export function weatherInstant(event: { startsAt: Date; raceStartsAt?: Date | null }): Date {
  return event.raceStartsAt ?? event.startsAt;
}
