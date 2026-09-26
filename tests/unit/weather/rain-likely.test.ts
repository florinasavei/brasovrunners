import { describe, expect, it } from "vitest";
import { RAIN_LIKELY_PERCENT, rainLikely } from "@/modules/weather/domain/forecast";
import { WEATHER_GLYPH_NAMES } from "@/modules/weather/domain/wmo";
import { weatherWords } from "@/modules/weather/words";

/**
 * BR-REQ-041-01 (§NNN, amending §416) — a listing card's weather pill wears the umbrella when rain
 * is likely at the start: a chance of 50% or more, unless the hour's own glyph says more (snow,
 * frost, the storm), because Open-Meteo's chance is of any precipitation.
 */
describe("BR-REQ-041-01 rain is likely at the start (§NNN)", () => {
  it("is likely from fifty percent, never below it, never without a chance", () => {
    expect(RAIN_LIKELY_PERCENT).toBe(50);
    expect(rainLikely({ precipitationProbability: 49, glyph: "partlyCloudy" })).toBe(false);
    expect(rainLikely({ precipitationProbability: 50, glyph: "partlyCloudy" })).toBe(true);
    expect(rainLikely({ precipitationProbability: 100, glyph: "clear" })).toBe(true);
    expect(rainLikely({ precipitationProbability: null, glyph: "rain" })).toBe(false);
  });

  it("leaves snow, frost and the storm their own glyph, and umbrellas every other sky", () => {
    const kept = new Set(["snow", "snowShowers", "ice", "thunder"]);
    for (const glyph of WEATHER_GLYPH_NAMES) {
      expect(rainLikely({ precipitationProbability: 80, glyph }), glyph).toBe(!kept.has(glyph));
    }
  });

  it("says the chance as a phrase in both languages, and nothing without one", () => {
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
    expect(weatherWords(reading, "ro").rain).toBe("60% șanse de ploaie");
    expect(weatherWords(reading, "en").rain).toBe(weatherWords(reading, "en").details[1]);
    expect(weatherWords({ ...reading, precipitationProbability: null }, "ro").rain).toBeNull();
  });
});
