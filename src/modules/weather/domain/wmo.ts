/**
 * The WMO weather interpretation codes Open-Meteo answers with (§NNN), as a word and a glyph.
 *
 * Open-Meteo's `weather_code` is the WMO 4677 subset its documentation lists: 0 clear, 1–3 cloud
 * cover, 45/48 fog, 51–57 drizzle, 61–67 rain, 71–77 snow, 80–82 rain showers, 85–86 snow
 * showers, 95–99 thunderstorms. Each is mapped to a **kind** — the key of its word in the
 * `Weather.codes` catalogue, in both languages — and a **glyph name**, which the page's facts
 * turn into one Material icon (`weather/ui/glyphs.ts`). Names rather than components, so this
 * file is pure and the email, which draws no icon, reads the same table.
 *
 * Intensity is folded where a runner does not need it: a slight and a moderate rain are both
 * "Ploaie"; only heavy rain has a word of its own, because it is the one that changes what a
 * runner packs. A code outside the list — Open-Meteo has never sent one — maps to nothing, and a
 * forecast with no word is not shown at all (`pickHour` in `forecast.ts`): a temperature under a
 * blank is a riddle, not a forecast.
 */

export const WEATHER_KINDS = [
  "clear",
  "mainlyClear",
  "partlyCloudy",
  "overcast",
  "fog",
  "drizzle",
  "freezingDrizzle",
  "rain",
  "heavyRain",
  "freezingRain",
  "snow",
  "showers",
  "snowShowers",
  "thunderstorm",
  "thunderstormHail",
] as const;

export type WeatherKind = (typeof WEATHER_KINDS)[number];

export const WEATHER_GLYPH_NAMES = ["clear", "partlyCloudy", "cloud", "fog", "drizzle", "rain", "showers", "snow", "ice", "snowShowers", "thunder"] as const;

export type WeatherGlyphName = (typeof WEATHER_GLYPH_NAMES)[number];

const KIND_BY_CODE: Record<number, WeatherKind> = {
  0: "clear",
  1: "mainlyClear",
  2: "partlyCloudy",
  3: "overcast",
  45: "fog",
  48: "fog",
  51: "drizzle",
  53: "drizzle",
  55: "drizzle",
  56: "freezingDrizzle",
  57: "freezingDrizzle",
  61: "rain",
  63: "rain",
  65: "heavyRain",
  66: "freezingRain",
  67: "freezingRain",
  71: "snow",
  73: "snow",
  75: "snow",
  77: "snow",
  80: "showers",
  81: "showers",
  82: "heavyRain",
  85: "snowShowers",
  86: "snowShowers",
  95: "thunderstorm",
  96: "thunderstormHail",
  99: "thunderstormHail",
};

/** One glyph per kind: the sun, a cloud with a gap, a cloud, the mist, drops, a raindrop, an umbrella, snow, frost, snow from a cloud, the storm. */
export const GLYPH_BY_KIND: Record<WeatherKind, WeatherGlyphName> = {
  clear: "clear",
  mainlyClear: "clear",
  partlyCloudy: "partlyCloudy",
  overcast: "cloud",
  fog: "fog",
  drizzle: "drizzle",
  freezingDrizzle: "ice",
  rain: "rain",
  heavyRain: "showers",
  freezingRain: "ice",
  snow: "snow",
  showers: "showers",
  snowShowers: "snowShowers",
  thunderstorm: "thunder",
  thunderstormHail: "thunder",
};

/** The kind a WMO code reads as, or null for a code the list does not name. */
export function weatherKind(code: number): WeatherKind | null {
  return Object.hasOwn(KIND_BY_CODE, code) ? KIND_BY_CODE[code] : null;
}
