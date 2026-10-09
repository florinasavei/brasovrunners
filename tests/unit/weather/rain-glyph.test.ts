import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { GLYPH_BY_KIND, WEATHER_GLYPH_NAMES, weatherKind } from "@/modules/weather/domain/wmo";
import type { WeatherReading } from "@/modules/weather/domain/forecast";
import WaterDropIcon from "@mui/icons-material/WaterDrop";
import type { Glyph } from "@/modules/events/ui/glyphs";
import { WEATHER_GLYPH } from "@/modules/weather/ui/glyphs";
import RainyHeavyIcon from "@/modules/weather/ui/RainyHeavyIcon";
import RainyIcon from "@/modules/weather/ui/RainyIcon";
import RainyLightIcon from "@/modules/weather/ui/RainyLightIcon";
import { weatherWords } from "@/modules/weather/words";

/**
 * BR-REQ-041-01 / BR-REQ-011-01 (§677, amending §402, §416, §429; §682, amending §677) — the rain is
 * a raining cloud and a percentage, never a closed umbrella and never the chance's drop: drizzle,
 * plain rain and showers draw one family of three clouds by intensity (`RainyLightIcon`,
 * `RainyIcon`, `RainyHeavyIcon`, drawn here from Material Symbols' «rainy»), and a card's pill says
 * the hour's chance after a drop, «20 %», whenever the forecast has one that does not round to 0.
 */
const glyphTestId = (name: (typeof WEATHER_GLYPH_NAMES)[number]) =>
  /data-testid="([^"]+)"/.exec(renderToStaticMarkup(createElement(WEATHER_GLYPH[name])))?.[1];

const RAIN_CLOUDS = [
  { glyph: "drizzle", icon: RainyLightIcon, testId: "RainyLightIcon", codes: [51, 53, 55] },
  { glyph: "rain", icon: RainyIcon, testId: "RainyIcon", codes: [61, 63] },
  { glyph: "showers", icon: RainyHeavyIcon, testId: "RainyHeavyIcon", codes: [65, 80, 81, 82] },
] as const;

const pathOf = (icon: Glyph) => /<path d="([^"]+)"/.exec(renderToStaticMarkup(createElement(icon)))?.[1] ?? "";

describe("§682 three rain intensities, three clouds — no sky glyph is the chance's drop", () => {
  it("maps drizzle, plain rain and showers to the light, the plain and the heavy rain cloud, by their WMO codes", () => {
    for (const { glyph, icon, testId, codes } of RAIN_CLOUDS) {
      expect(WEATHER_GLYPH[glyph], glyph).toBe(icon);
      expect(glyphTestId(glyph), glyph).toBe(testId);
      for (const code of codes) {
        const kind = weatherKind(code);
        expect(kind && GLYPH_BY_KIND[kind], String(code)).toBe(glyph);
      }
    }
  });

  it("has no entry that is the drop, and draws no umbrella for any sky", () => {
    const dropPath = pathOf(WaterDropIcon);
    for (const name of WEATHER_GLYPH_NAMES) {
      expect(WEATHER_GLYPH[name], name).not.toBe(WaterDropIcon);
      expect(pathOf(WEATHER_GLYPH[name]), name).not.toBe(dropPath);
      const html = renderToStaticMarkup(createElement(WEATHER_GLYPH[name]));
      expect(html, name).not.toContain("WaterDrop");
      expect(html, name).not.toContain("Umbrella");
      expect(html, name).not.toContain("BeachAccess");
    }
  });

  it("keeps freezing drizzle and freezing rain on the frost's glyph", () => {
    for (const code of [56, 57, 66, 67]) {
      const kind = weatherKind(code);
      expect(kind && GLYPH_BY_KIND[kind], String(code)).toBe("ice");
    }
  });

  it("is three different glyphs sharing one cloud, the strokes growing with the intensity", () => {
    const [light, plain, heavy] = RAIN_CLOUDS.map(({ icon }) => pathOf(icon));
    expect(new Set([light, plain, heavy]).size).toBe(3);
    // The cloud is the last subpath, the same in all three after its move to (7.5, 16) — absolute in
    // the light and heavy clouds, relative in «rainy» as Google wrote it: one family.
    const cloud = (d: string) => d.slice(d.search(/[Mm][^Mm]*$/)).replace(/^[Mm][^q]*/, "");
    expect(plain).toContain("Zm-.45-5.9q");
    expect(light).toContain("ZM7.5 16q");
    expect(heavy).toContain("ZM7.5 16q");
    expect(cloud(plain)).toMatch(/^q-2\.275 0-3\.887-1\.612T2 10\.5/);
    expect(cloud(light)).toBe(cloud(plain));
    expect(cloud(heavy)).toBe(cloud(plain));
    // One closed subpath per stroke, then the cloud: two, three, four strokes.
    const strokes = (d: string) => (d.match(/Z/g) ?? []).length - 1;
    expect([light, plain, heavy].map(strokes)).toEqual([2, 3, 4]);
  });

  it("is one path on the 24-unit grid each, taking fontSize and colour like every Material glyph", () => {
    for (const { icon, testId } of RAIN_CLOUDS) {
      const html = renderToStaticMarkup(createElement(icon, { fontSize: "small", color: "primary" }));
      expect(html, testId).toContain('viewBox="0 0 24 24"');
      expect(html, testId).toContain(`data-testid="${testId}"`);
      expect(html, testId).toContain("MuiSvgIcon-fontSizeSmall");
      expect(html, testId).toContain("MuiSvgIcon-colorPrimary");
      expect(html.match(/<path\b/g), testId).toHaveLength(1);
      // Every figure of the path fits the 24-unit box.
      for (const figure of pathOf(icon).match(/-?(?:\d+\.?\d*|\.\d+)/g) ?? []) {
        expect(Math.abs(Number(figure)), `${testId} ${figure}`).toBeLessThanOrEqual(24);
      }
    }
  });
});

describe("§677 a card's pill says the chance in figures", () => {
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
