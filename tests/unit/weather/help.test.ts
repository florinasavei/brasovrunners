import { describe, expect, it } from "vitest";
import type { WeatherReading } from "@/modules/weather/domain/forecast";
import { weatherWords } from "@/modules/weather/words";

// §473: the event page's weather line ends in a discreet «?» whose tooltip says the forecast may
// vary and names Open-Meteo as the data's source, in the reader's language.
describe("BR-REQ-041-01 the weather line's help tooltip (§473)", () => {
  const reading = { kind: "clear", temperatureC: 12, precipitationProbability: 10, windKmh: 5 } as unknown as WeatherReading;

  it("says it may vary and credits Open-Meteo, in Romanian", () => {
    const help = weatherWords(reading, "ro").help;
    expect(help).toContain("poate varia");
    expect(help).toContain("Open-Meteo");
  });

  it("says it may change and credits Open-Meteo, in English", () => {
    const help = weatherWords(reading, "en").help;
    expect(help).toContain("may change");
    expect(help).toContain("Open-Meteo");
  });
});
