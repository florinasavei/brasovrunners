import { describe, expect, it } from "vitest";
import { CLUB_LOCALITY } from "@/modules/events/domain/place";
import {
  forecastPlaceName,
  type HourlyForecast,
  pickSpan,
  summarizeSpan,
  WEATHER_SPAN_MAX_HOURS,
  type WeatherReading,
} from "@/modules/weather/domain/forecast";
import { weatherSpanWords } from "@/modules/weather/words";

/**
 * BR-REQ-041-01 (§NNN): the weather line says where and for which hours — the hours from the
 * start's to the end's (at most six after the start), the degrees over them, rain likely in any of
 * them, and the place the forecast was read at (the club's locality for the club's own point).
 */
const HOUR = 60 * 60 * 1000;
// 2026-09-26 15:00 UTC = 18:00 in Brașov (EEST).
const START = new Date("2026-09-26T15:00:00.000Z");
const ZONE = "Europe/Bucharest";

/** Twelve hours from the start's, each with its own temperature, chance and code. */
function forecast(overrides: { temperature?: number[]; chance?: number[]; code?: number[] } = {}): HourlyForecast {
  const time = Array.from({ length: 12 }, (_, index) => START.getTime() + index * HOUR);
  const pick = (values: number[] | undefined, fallback: number) => time.map((_, index) => values?.[index] ?? fallback);
  return {
    fetchedAt: START.getTime() - HOUR,
    time,
    temperatureC: pick(overrides.temperature, 14),
    precipitationProbability: pick(overrides.chance, 20),
    weatherCode: pick(overrides.code, 2),
    windKmh: time.map(() => 11),
    feelsLikeC: time.map(() => null),
    precipitationMm: time.map(() => null),
    gustKmh: time.map(() => null),
    humidity: time.map(() => null),
    uvIndex: time.map(() => null),
  };
}

const words = (span: WeatherReading[], locale: "ro" | "en", place: string | null) =>
  weatherSpanWords({ start: span[0], span }, locale, { place, timeZone: ZONE });

describe("pickSpan: the hours the event is out (§NNN)", () => {
  it("is the start's hour alone when the event names no end", () => {
    const span = pickSpan(forecast(), START, null);
    expect(span.map((hour) => hour.hourAt)).toEqual([START.getTime()]);
  });

  it("runs from the start's hour to the end's nearest hour", () => {
    const span = pickSpan(forecast(), START, new Date(START.getTime() + 2 * HOUR + 20 * 60 * 1000));
    expect(span.map((hour) => (hour.hourAt - START.getTime()) / HOUR)).toEqual([0, 1, 2]);
  });

  it("is the start's alone when the end is at or before it", () => {
    expect(pickSpan(forecast(), START, new Date(START.getTime() - HOUR))).toHaveLength(1);
  });

  it("stops six hours after the start, however long the event", () => {
    expect(WEATHER_SPAN_MAX_HOURS).toBe(6);
    const span = pickSpan(forecast(), START, new Date(START.getTime() + 30 * HOUR));
    expect(span).toHaveLength(WEATHER_SPAN_MAX_HOURS + 1);
    expect(span.at(-1)?.hourAt).toBe(START.getTime() + 6 * HOUR);
  });

  it("is empty when the answer has no hour for the start", () => {
    expect(pickSpan(forecast(), new Date(START.getTime() - 5 * HOUR), null)).toEqual([]);
  });
});

describe("summarizeSpan", () => {
  it("takes the coldest and warmest degrees and the highest chance among the hours where rain is likely", () => {
    const span = pickSpan(forecast({ temperature: [15, 13, 12], chance: [20, 70, 55] }), START, new Date(START.getTime() + 2 * HOUR));
    expect(summarizeSpan(span)).toMatchObject({ minC: 12, maxC: 15, rainLikely: true, rainChance: 70 });
  });

  it("says no rain when no hour is likely", () => {
    const span = pickSpan(forecast({ chance: [20, 40, 49] }), START, new Date(START.getTime() + 2 * HOUR));
    expect(summarizeSpan(span)).toMatchObject({ rainLikely: false, rainChance: null });
  });
});

describe("weatherSpanWords: the line with where and when (§NNN)", () => {
  it("one hour: the start's sky, the degrees and «(place, la 18:00)» in Romanian, «at 18:00» in English", () => {
    const span = pickSpan(forecast(), START, null);
    expect(words(span, "ro", "Parcul Tractorul").line).toBe("Parțial noros, 14 °C (Parcul Tractorul, la 18:00)");
    expect(words(span, "en", "Tractorul Park").line).toBe("Partly cloudy, 14 °C (Tractorul Park, at 18:00)");
  });

  it("several hours: the degrees as a range and the hours as an interval on the event's clock", () => {
    const span = pickSpan(forecast({ temperature: [15.2, 13, 11.6], chance: [20, 70, 30] }), START, new Date(START.getTime() + 2 * HOUR));
    const ro = words(span, "ro", "Tâmpa");
    expect(ro.line).toBe("Parțial noros, 12–15 °C, ploaie probabilă 70 % (Tâmpa, 18:00–20:00)");
    expect(ro.scope).toBe("Tâmpa, 18:00–20:00");
    expect(words(span, "en", "Tâmpa").line).toBe("Partly cloudy, 12–15 °C, rain likely 70% (Tâmpa, 18:00–20:00)");
  });

  it("one temperature when the hours round to the same degree", () => {
    const span = pickSpan(forecast({ temperature: [14.2, 13.8] }), START, new Date(START.getTime() + HOUR));
    expect(words(span, "ro", "Tâmpa").temperature).toBe("14 °C");
  });

  it("names «locul evenimentului» / «the event’s place» when the event names none", () => {
    const span = pickSpan(forecast(), START, null);
    expect(words(span, "ro", null).scope).toBe("locul evenimentului, la 18:00");
    expect(words(span, "en", null).scope).toBe("the event’s place, at 18:00");
  });
});

describe("forecastPlaceName: the place the numbers are for", () => {
  it("is the club's locality for the club's own point, whatever the meeting point is called", () => {
    expect(forecastPlaceName("club", "Parcul Tractorul", CLUB_LOCALITY)).toBe(CLUB_LOCALITY);
  });

  it("is the meeting point for a map pin or a typed pair, and null when it has no name", () => {
    expect(forecastPlaceName("map", " Tâmpa ", CLUB_LOCALITY)).toBe("Tâmpa");
    expect(forecastPlaceName("typed", "Tâmpa", CLUB_LOCALITY)).toBe("Tâmpa");
    expect(forecastPlaceName("typed", "  ", CLUB_LOCALITY)).toBeNull();
    expect(forecastPlaceName("map", null, CLUB_LOCALITY)).toBeNull();
  });
});
