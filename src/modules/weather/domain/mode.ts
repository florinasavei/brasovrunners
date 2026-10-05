import { isWrittenText } from "@/shared/forms/both-languages";

/**
 * Whose weather an event shows (§NNN, amending §402 and §469): the club decides, per event, between
 * the forecast, its own words, or nothing — a mountain race where the valley's forecast misleads, a
 * run where the organizer knows the trail will be icy.
 *
 * - `forecast` — «Prognoza automată», the default and what every event did before: Open-Meteo at the
 *   event's place (§416), the page's «Vremea» row, the cards' pill (§429), the reminder's line, inside
 *   the seven days (`withinWeatherWindow`).
 * - `custom` — «Text scris de club»: the club's short text (`event_translations.weather_note`) in place
 *   of the forecast on the page's row and the reminder's line, in the reader's language. No request to
 *   Open-Meteo, no credit and no «?» (the words are the club's), and no pill on the cards — a sentence
 *   is not a pill. A language without a text shows no row (§28: never the other language's words).
 * - `off` — «Fără vreme»: no row, no pill, no reminder line, no request.
 *
 * One or the other, never both: the owner's words, «I want to choose if I take the weather info
 * automatically from the API or put custom info».
 *
 * Pure: no request, no configuration — the page, the cards, the reminder, the page clock and the
 * editor read one rule.
 */
export const WEATHER_MODES = ["forecast", "custom", "off"] as const;
export type WeatherMode = (typeof WEATHER_MODES)[number];

/** The default: the forecast, as every event had it before the choice existed. */
export const DEFAULT_WEATHER_MODE: WeatherMode = "forecast";

/** The club's own text, at most 200 characters, plain — a line, not a paragraph (§511). */
export const MAX_WEATHER_NOTE = 200;

/**
 * The stored value read defensively: anything outside the three (a row from before the column, an
 * unknown value a later release might write) reads as the forecast, the behaviour it had before.
 */
export function readWeatherMode(value: unknown): WeatherMode {
  return typeof value === "string" && (WEATHER_MODES as readonly string[]).includes(value) ? (value as WeatherMode) : DEFAULT_WEATHER_MODE;
}

/** What a reader shows for the weather: the forecast (to be read), the club's own sentence, or nothing. */
export type WeatherShown = { kind: "forecast" } | { kind: "custom"; text: string } | null;

/**
 * The one resolver the page, the cards and the reminder ask: `event.weatherMode` and this language's
 * `translation.weatherNote` — the row of the reader's language, never the other's. Whether a forecast
 * exists (the seven days, the service's answer) is the forecast reader's business, not this one's.
 */
export function weatherShown(
  event: { weatherMode?: string | null },
  translation: { weatherNote?: string | null } | null | undefined,
): WeatherShown {
  const mode = readWeatherMode(event.weatherMode);
  if (mode === "off") return null;
  if (mode === "forecast") return { kind: "forecast" };
  const text = translation?.weatherNote;
  return isWrittenText(text) ? { kind: "custom", text: (text ?? "").trim() } : null;
}

/** Whether the event's weather is the forecast — the one mode that asks Open-Meteo and keeps a page to the hour. */
export function readsForecast(event: { weatherMode?: string | null }): boolean {
  return readWeatherMode(event.weatherMode) === "forecast";
}
