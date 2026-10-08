import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { GLYPH_BY_KIND, WEATHER_GLYPH_NAMES, weatherKind } from "@/modules/weather/domain/wmo";
import type { WeatherReading } from "@/modules/weather/domain/forecast";
import { WEATHER_GLYPH } from "@/modules/weather/ui/glyphs";
import RainyIcon from "@/modules/weather/ui/RainyIcon";
import { weatherWords } from "@/modules/weather/words";

/**
 * BR-REQ-041-01 / BR-REQ-011-01 (§NNN, amending §402, §416, §429) — the rain is a raining cloud and
 * a percentage, never a closed umbrella: showers and heavy rain draw `RainyIcon` (Material Symbols'
 * «rainy», drawn here), and a card's pill says the hour's chance after a drop, «20 %», whenever the
 * forecast has one that does not round to 0.
 */
const glyphTestId = (name: (typeof WEATHER_GLYPH_NAMES)[number]) =>
  /data-testid="([^"]+)"/.exec(renderToStaticMarkup(createElement(WEATHER_GLYPH[name])))?.[1];

describe("§NNN the sky's glyph for showers and heavy rain is a raining cloud", () => {
  it("maps showers to RainyIcon, and WMO 80–82 and 65 to it", () => {
    expect(WEATHER_GLYPH.showers).toBe(RainyIcon);
    expect(glyphTestId("showers")).toBe("RainyIcon");
    for (const code of [65, 80, 81, 82]) {
      const kind = weatherKind(code);
      expect(kind && GLYPH_BY_KIND[kind], String(code)).toBe("showers");
    }
  });

  it("keeps the drop for rain and the fine drops for drizzle, and draws no umbrella anywhere in the map", () => {
    expect(glyphTestId("rain")).toBe("WaterDropIcon");
    expect(glyphTestId("drizzle")).toBe("GrainIcon");
    for (const name of WEATHER_GLYPH_NAMES) {
      const html = renderToStaticMarkup(createElement(WEATHER_GLYPH[name]));
      expect(html, name).not.toContain("Umbrella");
      expect(html, name).not.toContain("BeachAccess");
    }
  });

  it("is one path on the 24-unit grid, taking fontSize and colour like every Material glyph", () => {
    const html = renderToStaticMarkup(createElement(RainyIcon, { fontSize: "small", color: "primary" }));
    expect(html).toContain('viewBox="0 0 24 24"');
    expect(html).toContain('data-testid="RainyIcon"');
    expect(html).toContain("MuiSvgIcon-fontSizeSmall");
    expect(html).toContain("MuiSvgIcon-colorPrimary");
    expect(html.match(/<path\b/g)).toHaveLength(1);
  });
});

describe("§NNN a card's pill says the chance in figures", () => {
  const reading = (precipitationProbability: number | null): WeatherReading => ({
    hourAt: 0,
    code: 3,
    kind: "overcast",
    glyph: "cloud",
    temperatureC: 9,
    precipitationProbability,
    windKmh: 11,
    feelsLikeC: null,
    precipitationMm: null,
    gustKmh: null,
    humidity: null,
    uvIndex: null,
  });

  it("writes «20 %» in Romanian and \"20%\" in English, with the chance in words for the ear", () => {
    expect(weatherWords(reading(20), "ro")).toMatchObject({ chanceShort: "20 %", chanceSpoken: "20% șanse de ploaie" });
    expect(weatherWords(reading(20), "en")).toMatchObject({ chanceShort: "20%", chanceSpoken: "20% chance of rain" });
    expect(weatherWords(reading(100), "ro").chanceShort).toBe("100 %");
    expect(weatherWords(reading(59.6), "ro").chanceShort).toBe("60 %");
  });

  it("says nothing at 0 %, at a chance that rounds to it, or without a chance", () => {
    for (const dry of [0, 0.4, null]) {
      expect(weatherWords(reading(dry), "ro"), String(dry)).toMatchObject({ chanceShort: null, chanceSpoken: null });
      expect(weatherWords(reading(dry), "en"), String(dry)).toMatchObject({ chanceShort: null, chanceSpoken: null });
    }
    expect(weatherWords(reading(0.5), "ro").chanceShort).toBe("1 %");
  });

  it("leaves the reminder's one line as §469 set it: no figure on a dry hour, «ploaie probabilă N %» on a likely one", () => {
    expect(weatherWords(reading(20), "ro").line).toBe("Înnorat, 9 °C");
    expect(weatherWords(reading(60), "ro").line).toBe("Înnorat, 9 °C, ploaie probabilă 60 %");
  });

  it("is one short key in both catalogues", () => {
    expect(ro.Weather.chanceShort).toBe("{percent} %");
    expect(en.Weather.chanceShort).toBe("{percent}%");
    expect(ro.Weather.chanceShort.length).toBeLessThan(200);
  });
});
