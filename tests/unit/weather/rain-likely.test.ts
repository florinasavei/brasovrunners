import { describe, expect, it } from "vitest";
import { RAIN_LIKELY_PERCENT, rainLikely } from "@/modules/weather/domain/forecast";
import { WEATHER_GLYPH_NAMES } from "@/modules/weather/domain/wmo";
import { weatherWords } from "@/modules/weather/words";

/**
 * BR-REQ-041-01 (§NNN, amending §416) — a listing card's weather pill wears the umbrella when rain
 * is likely at the start: a chance of 50% or more, or a forecast amount of 0.5 mm or more already
 * falling in the hour, unless the hour's own glyph says more (snow, frost, the storm), because
 * Open-Meteo's chance is of any precipitation.
 */
describe("BR-REQ-041-01 rain is likely at the start (§NNN)", () => {
  it("is likely from fifty percent, never below it, never without a chance or an amount", () => {
    expect(RAIN_LIKELY_PERCENT).toBe(50);
    expect(rainLikely({ precipitationProbability: 49, glyph: "partlyCloudy", precipitationMm: null })).toBe(false);
    expect(rainLikely({ precipitationProbability: 50, glyph: "partlyCloudy", precipitationMm: null })).toBe(true);
    expect(rainLikely({ precipitationProbability: 100, glyph: "clear", precipitationMm: null })).toBe(true);
    expect(rainLikely({ precipitationProbability: null, glyph: "rain", precipitationMm: null })).toBe(false);
  });

  it("is also likely from an amount already falling, even at a lower chance", () => {
    // A showery hour of 45% with 2 mm: below the chance threshold, above the amount one.
    expect(rainLikely({ precipitationProbability: 45, glyph: "showers", precipitationMm: 2 })).toBe(true);
    expect(rainLikely({ precipitationProbability: 45, glyph: "showers", precipitationMm: 0.4 })).toBe(false);
    expect(rainLikely({ precipitationProbability: null, glyph: "showers", precipitationMm: 0.5 })).toBe(true);
    // Still never on snow, frost or the storm, whatever the amount.
    expect(rainLikely({ precipitationProbability: null, glyph: "snow", precipitationMm: 5 })).toBe(false);
  });

  it("leaves snow, frost and the storm their own glyph, and umbrellas every other sky", () => {
    const kept = new Set(["snow", "snowShowers", "ice", "thunder"]);
    for (const glyph of WEATHER_GLYPH_NAMES) {
      expect(rainLikely({ precipitationProbability: 80, glyph, precipitationMm: null }), glyph).toBe(!kept.has(glyph));
    }
  });

  it("says the chance as a phrase in both languages, and nothing without one, among the details", () => {
    const reading = {
      hourAt: 0,
      code: 2,
      kind: "partlyCloudy",
      glyph: "partlyCloudy",
      temperatureC: 14,
      precipitationProbability: 60,
      windKmh: 11,
      feelsLikeC: null,
      precipitationMm: null,
      gustKmh: null,
      humidity: null,
      uvIndex: null,
    } as const;
    // The rain phrase is `details[1]` here (temperature first): no field of its own on
    // `WeatherWords` carries it — `rainShort` is the number alone, `rainLikely` the fixed phrase.
    expect(weatherWords(reading, "ro").details[1]).toBe("60% șanse de ploaie");
    expect(weatherWords(reading, "en").details[1]).toBe("60% chance of rain");
    // Without a chance the phrase is simply gone: the temperature and the wind, nothing between.
    expect(weatherWords({ ...reading, precipitationProbability: null }, "ro").details).toEqual(["14 °C", "vânt 11 km/h"]);
  });
});
