import { describe, expect, it } from "vitest";
import { eventFactsBlock } from "@/modules/notifications/domain/event-facts";
import { emailSampleEventFacts } from "@/modules/notifications/email-copy-fields";
import type { WeatherReading } from "@/modules/weather/domain/forecast";
import { weatherWords } from "@/modules/weather/words";

// The reminder's weather is one line (§469): the sky's word, the degrees, the rain phrase only when rain is likely.
const reading = (precipitationProbability: number): WeatherReading => ({
  hourAt: 0,
  code: 2,
  kind: "partlyCloudy",
  glyph: "partlyCloudy",
  temperatureC: 14.2,
  precipitationProbability,
  windKmh: 11,
  feelsLikeC: 12,
  precipitationMm: 0.4,
  gustKmh: 30,
  humidity: 80,
  uvIndex: 3,
});

describe("the reminder's weather line", () => {
  it("names the chance when rain is likely, in both languages", () => {
    const ro = eventFactsBlock(emailSampleEventFacts("ro"), "ro", weatherWords(reading(60), "ro")).text;
    const en = eventFactsBlock(emailSampleEventFacts("en"), "en", weatherWords(reading(60), "en")).text;
    expect(ro).toContain("Parțial noros, 14 °C, ploaie probabilă 60 %");
    expect(en).toMatch(/14 °C, rain likely 60%/);
  });

  it("says no rain words on a dry hour, and never the wind or the humidity", () => {
    for (const locale of ["ro", "en"] as const) {
      const text = eventFactsBlock(emailSampleEventFacts(locale), locale, weatherWords(reading(20), locale)).text;
      expect(weatherWords(reading(20), locale).line).toBe(locale === "ro" ? "Parțial noros, 14 °C" : `${weatherWords(reading(20), "en").summary}, 14 °C`);
      expect(text).not.toMatch(/vânt|wind|umiditate|humidity|ploaie|rain/i);
    }
  });

  it("is absent without a forecast", () => {
    expect(eventFactsBlock(emailSampleEventFacts("ro"), "ro").text).not.toContain("Vremea");
    expect(eventFactsBlock(emailSampleEventFacts("en"), "en").text).not.toContain("Weather");
  });
});
