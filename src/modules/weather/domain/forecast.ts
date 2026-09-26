import { z } from "zod";
import type { ForecastPlaceSource } from "./place";
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
  /*
    The details the event page adds under the start hour (§416, amending §402; the owner: "să văd
    mai multe date") — what a runner dresses and packs by, beyond the word and the degrees. Each
    null when the hour has none; the reminder and the cards never read them.
  */
  /** How warm it feels, wind and humidity counted (Open-Meteo's `apparent_temperature`), °C. */
  feelsLikeC: number | null;
  /** How much falls in the hour, mm — the chance says whether, this says how much. */
  precipitationMm: number | null;
  /** The strongest gusts at ten metres in the hour, km/h — what a ridge run on Tâmpa meets. */
  gustKmh: number | null;
  /** Relative humidity at two metres, percent. */
  humidity: number | null;
  /** The UV index — a long summer morning's sunburn. */
  uvIndex: number | null;
};

/**
 * An event's forecast as the page draws it (§416): the start's hour with its details, the hours
 * after it (`pickHours`, the start's first), and which place it was asked for — the page says
 * "for the event's place" or "for Brașov". The listing reads `start` alone.
 */
export type EventForecast = { start: WeatherReading; hours: WeatherReading[]; place: ForecastPlaceSource };

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
  feelsLikeC: (number | null)[];
  precipitationMm: (number | null)[];
  gustKmh: (number | null)[];
  humidity: (number | null)[];
  uvIndex: (number | null)[];
};

const column = z.array(z.number().nullable());

/**
 * Open-Meteo's answer to `hourly=temperature_2m,precipitation_probability,weather_code,
 * wind_speed_10m,…&timeformat=unixtime`: the hours as Unix seconds and one array per variable, the
 * same length. Anything else — an error object, a missing column, arrays that disagree — is not a
 * forecast, and reads as a failure (`null` further up), never as a partial one.
 *
 * The page's details (§416) are asked for in the same request, but an answer without one of them
 * is still a forecast: the word, the degrees, the rain and the wind are what §402 shows, and a
 * detail Open-Meteo stopped sending is a detail the page leaves out, never a forecast it hides.
 * When a detail's column is there, it must be as long as the others, like every column.
 */
const openMeteoAnswer = z.object({
  hourly: z.object({
    time: z.array(z.number()),
    temperature_2m: column,
    precipitation_probability: column,
    weather_code: column,
    wind_speed_10m: column,
    apparent_temperature: column.optional(),
    precipitation: column.optional(),
    wind_gusts_10m: column.optional(),
    relative_humidity_2m: column.optional(),
    uv_index: column.optional(),
  }),
});

/** The answer as a forecast, or null when it is not one. */
export function parseOpenMeteo(body: unknown, fetchedAt: number): HourlyForecast | null {
  const parsed = openMeteoAnswer.safeParse(body);
  if (!parsed.success) return null;
  const hourly = parsed.data.hourly;
  const length = hourly.time.length;
  if (length === 0) return null;
  const details = [hourly.apparent_temperature, hourly.precipitation, hourly.wind_gusts_10m, hourly.relative_humidity_2m, hourly.uv_index];
  const columns = [hourly.temperature_2m, hourly.precipitation_probability, hourly.weather_code, hourly.wind_speed_10m, ...details.filter((values) => values !== undefined)];
  if (columns.some((values) => values.length !== length)) return null;
  const orNulls = (values: (number | null)[] | undefined) => values ?? hourly.time.map(() => null);
  return {
    fetchedAt,
    time: hourly.time.map((seconds) => seconds * 1000),
    temperatureC: hourly.temperature_2m,
    precipitationProbability: hourly.precipitation_probability,
    weatherCode: hourly.weather_code,
    windKmh: hourly.wind_speed_10m,
    feelsLikeC: orNulls(hourly.apparent_temperature),
    precipitationMm: orNulls(hourly.precipitation),
    gustKmh: orNulls(hourly.wind_gusts_10m),
    humidity: orNulls(hourly.relative_humidity_2m),
    uvIndex: orNulls(hourly.uv_index),
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
  return readingAt(forecast, Math.round(startAt.getTime() / HOUR_MS) * HOUR_MS);
}

/** The reading for one exact hour of the answer, or null — `pickHour`'s rule without the rounding. */
function readingAt(forecast: HourlyForecast, hourAt: number): WeatherReading | null {
  const index = forecast.time.indexOf(hourAt);
  if (index < 0) return null;
  const code = forecast.weatherCode[index];
  if (code === null || code === undefined) return null;
  const kind = weatherKind(code);
  if (!kind) return null;
  // The cache key's version keeps an entry written before the details out (`source.ts`); a column
  // missing all the same reads as "no detail", never as a thrown page.
  const detail = (values: (number | null)[] | undefined) => values?.[index] ?? null;
  return {
    hourAt,
    code,
    kind,
    glyph: GLYPH_BY_KIND[kind],
    temperatureC: forecast.temperatureC[index] ?? null,
    precipitationProbability: forecast.precipitationProbability[index] ?? null,
    windKmh: forecast.windKmh[index] ?? null,
    feelsLikeC: detail(forecast.feelsLikeC),
    precipitationMm: detail(forecast.precipitationMm),
    gustKmh: detail(forecast.gustKmh),
    humidity: detail(forecast.humidity),
    uvIndex: detail(forecast.uvIndex),
  };
}

/**
 * How many hours the event page shows, from the start's own (§416): the start and the two after
 * it — the hour a group run or a 10 km race is out on the course, and what the sky does while
 * they are. Three, because a fourth does not fit a 320-pixel phone beside the others as a row, and
 * a run's weather after the second hour is the long run's, not the club's usual evening.
 */
export const WEATHER_BLOCK_HOURS = 3;

/**
 * The start's hour and the ones after it, up to `WEATHER_BLOCK_HOURS`, each through `pickHour`'s
 * rule — an hour the answer lacks, or whose code has no word, is left out rather than drawn empty.
 * Empty when the start's own hour has no reading: the block is the start's first.
 */
export function pickHours(forecast: HourlyForecast, startAt: Date, count: number = WEATHER_BLOCK_HOURS): WeatherReading[] {
  const first = pickHour(forecast, startAt);
  if (!first) return [];
  const hours = [first];
  for (let step = 1; step < count; step += 1) {
    const reading = readingAt(forecast, first.hourAt + step * HOUR_MS);
    if (reading) hours.push(reading);
  }
  return hours;
}

/**
 * The chance of rain, in percent, from which a listing card's weather pill wears the umbrella
 * (§NNN; the owner, 2026-09-26: "an umbrella when rain is likely"). Fifty: "likely" is more likely
 * than not, the one threshold a runner reads without a legend — below it the sky's own glyph, at
 * or above it the umbrella, whatever the sky's word at the hour.
 */
export const RAIN_LIKELY_PERCENT = 50;

/**
 * The glyphs the umbrella never replaces: snow, frost and the storm say something a runner needs
 * more than "take an umbrella" — what to wear on the feet, or whether to go out on a ridge at all.
 * Open-Meteo's chance is of any precipitation, so a snowy hour's 80% is snow, not rain.
 */
const STRONGER_THAN_UMBRELLA: ReadonlySet<WeatherGlyphName> = new Set(["snow", "snowShowers", "ice", "thunder"]);

/**
 * Below the chance threshold, a forecast amount already falling in the hour: 0.5 mm or more of
 * rain is worth an umbrella even at a lower chance (a showery hour of 45% with 2 mm), the fix
 * round's own reading of Open-Meteo's `precipitationMm` (§NNN).
 */
const RAIN_LIKELY_MM = 0.5;

/**
 * Whether a card says "rain is likely" at the start (§NNN): the chance of rain at the hour is at
 * least `RAIN_LIKELY_PERCENT`, or the forecast amount is already `RAIN_LIKELY_MM` or more — and
 * either way the hour's own glyph is not one that says more (snow, frost, the storm). A missing
 * chance and a missing amount are neither a likely one.
 */
export function rainLikely(reading: Pick<WeatherReading, "precipitationProbability" | "glyph" | "precipitationMm">): boolean {
  if (STRONGER_THAN_UMBRELLA.has(reading.glyph)) return false;
  const byChance = reading.precipitationProbability !== null && reading.precipitationProbability >= RAIN_LIKELY_PERCENT;
  const byAmount = reading.precipitationMm !== null && reading.precipitationMm >= RAIN_LIKELY_MM;
  return byChance || byAmount;
}

/**
 * The instant a forecast is read for: a race's gun time when it has one apart from the gathering
 * (§71) — the hour the runner is out on the course — otherwise the start.
 */
export function weatherInstant(event: { startsAt: Date; raceStartsAt?: Date | null }): Date {
  return event.raceStartsAt ?? event.startsAt;
}
