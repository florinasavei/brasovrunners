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
 * BR-REQ-011-01 (§484; the requirement §469's weather criteria are numbered under): the weather
 * line says where and for which hours — the hours from the
 * start's to the end's (at most six after the start), the degrees over them, rain likely in any of
 * them, and the place the forecast was read at (the club's locality for the club's own point).
 */
const HOUR = 60 * 60 * 1000;
// 2026-09-26 15:00 UTC = 18:00 in Brașov (EEST).
const START = new Date("2026-09-26T15:00:00.000Z");
const ZONE = "Europe/Bucharest";

/** Twelve hours from the start's (or `from`), each with its own temperature, chance and code. */
function forecast(overrides: { temperature?: number[]; chance?: number[]; code?: number[] } = {}, from: Date = START): HourlyForecast {
  const time = Array.from({ length: 12 }, (_, index) => from.getTime() + index * HOUR);
  const pick = (values: number[] | undefined, fallback: number) => time.map((_, index) => values?.[index] ?? fallback);
  return {
    fetchedAt: from.getTime() - HOUR,
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

describe("pickSpan: the hours the event is out (§484)", () => {
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

  it("takes the sky of the wettest hour when rain is likely in any, however dry the start", () => {
    const span = pickSpan(forecast({ code: [2, 61, 63], chance: [20, 55, 70] }), START, new Date(START.getTime() + 2 * HOUR));
    const sky = summarizeSpan(span).sky;
    expect(sky?.hourAt).toBe(START.getTime() + 2 * HOUR);
    expect(sky).toMatchObject({ kind: "rain", glyph: "rain" });
  });

  it("takes the kind most hours share when it is dry, a tie going to the start's", () => {
    const most = pickSpan(forecast({ code: [2, 3, 3] }), START, new Date(START.getTime() + 2 * HOUR));
    expect(summarizeSpan(most).sky?.kind).toBe("overcast");
    const tie = pickSpan(forecast({ code: [2, 3] }), START, new Date(START.getTime() + HOUR));
    expect(summarizeSpan(tie).sky?.kind).toBe("partlyCloudy");
  });
});

describe("weatherSpanWords: the sentence with where and when (§484)", () => {
  it("one hour: «Vremea la <loc>, <zi> <HH:MM>: …» in Romanian, «Weather at <place>, <day> <HH:MM>: …» in English, no dash", () => {
    const span = pickSpan(forecast(), START, null);
    expect(words(span, "ro", "Parcul Tractorul").sentence).toBe("Vremea la Parcul Tractorul, sâmbătă, 26 sept. 18:00: Parțial noros, 14 °C");
    expect(words(span, "en", "Tractorul Park").sentence).toBe("Weather at Tractorul Park, Saturday, 26 Sept 18:00: Partly cloudy, 14 °C");
  });

  it("several hours: the degrees as a range and the hours as an interval on the event's clock", () => {
    const span = pickSpan(forecast({ temperature: [15.2, 13, 11.6], chance: [20, 70, 30] }), START, new Date(START.getTime() + 2 * HOUR));
    const ro = words(span, "ro", "Tâmpa");
    expect(ro.sentence).toBe("Vremea la Tâmpa, sâmbătă, 26 sept. 18:00–20:00: Parțial noros, 12–15 °C, ploaie probabilă 70 %");
    expect(ro.scope).toBe("la Tâmpa, sâmbătă, 26 sept. 18:00–20:00");
    expect(ro.heading).toBe("Vremea la Tâmpa, sâmbătă, 26 sept. 18:00–20:00");
    expect(ro.line).toBe("Parțial noros, 12–15 °C, ploaie probabilă 70 %");
    expect(words(span, "en", "Tâmpa").sentence).toBe("Weather at Tâmpa, Saturday, 26 Sept 18:00–20:00: Partly cloudy, 12–15 °C, rain likely 70%");
  });

  it("a dry start with rain later: the rainy hour's word and glyph beside «ploaie probabilă», never «Parțial noros»", () => {
    const span = pickSpan(forecast({ code: [2, 2, 61], chance: [10, 20, 70] }), START, new Date(START.getTime() + 2 * HOUR));
    const ro = words(span, "ro", "Tâmpa");
    expect(ro.line).toBe("Ploaie, 14 °C, ploaie probabilă 70 %");
    expect(ro.glyph).toBe("rain");
    expect(words(span, "en", "Tâmpa").line).toBe("Rain, 14 °C, rain likely 70%");
  });

  it("an interval across midnight keeps the start's day: «22:00–01:00»", () => {
    const late = new Date("2026-09-26T19:00:00.000Z"); // 22:00 in Brașov
    const span = pickSpan(forecast({}, late), late, new Date(late.getTime() + 3 * HOUR));
    expect(span).toHaveLength(4);
    expect(words(span, "ro", "Tâmpa").scope).toBe("la Tâmpa, sâmbătă, 26 sept. 22:00–01:00");
    expect(words(span, "en", "Tâmpa").scope).toBe("at Tâmpa, Saturday, 26 Sept 22:00–01:00");
  });

  it("one temperature when the hours round to the same degree", () => {
    const span = pickSpan(forecast({ temperature: [14.2, 13.8] }), START, new Date(START.getTime() + HOUR));
    expect(words(span, "ro", "Tâmpa").temperature).toBe("14 °C");
    expect(words(span, "en", "Tâmpa").sentence).toBe("Weather at Tâmpa, Saturday, 26 Sept 18:00–19:00: Partly cloudy, 14 °C");
  });

  it("says no rain words when every hour's chance is under fifty, in either language", () => {
    const span = pickSpan(forecast({ chance: [20, 45, 49] }), START, new Date(START.getTime() + 2 * HOUR));
    const ro = words(span, "ro", "Tâmpa");
    const en = words(span, "en", "Tâmpa");
    expect(ro.rainLikelyChance).toBeNull();
    expect(en.rainLikelyChance).toBeNull();
    expect(ro.sentence).not.toMatch(/ploaie/i);
    expect(en.sentence).not.toMatch(/rain/i);
    expect(ro.sentence).toBe("Vremea la Tâmpa, sâmbătă, 26 sept. 18:00–20:00: Parțial noros, 14 °C");
  });

  it("names «locul evenimentului» / «the event’s place» when the event names none, and the club's locality on its fallback", () => {
    const span = pickSpan(forecast(), START, null);
    expect(words(span, "ro", null).scope).toBe("la locul evenimentului, sâmbătă, 26 sept. 18:00");
    expect(words(span, "en", null).scope).toBe("at the event’s place, Saturday, 26 Sept 18:00");
    const club = forecastPlaceName("club", "Parcul Tractorul", CLUB_LOCALITY);
    expect(words(span, "ro", club).scope).toBe(`la ${CLUB_LOCALITY}, sâmbătă, 26 sept. 18:00`);
    expect(words(span, "en", club).scope).toBe(`at ${CLUB_LOCALITY}, Saturday, 26 Sept 18:00`);
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
