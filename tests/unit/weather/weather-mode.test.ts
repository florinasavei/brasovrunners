import { describe, expect, it } from "vitest";
import { eventClockInstants } from "@/modules/events/domain/page-clock";
import { readsForecast, readWeatherMode, WEATHER_MODES, weatherShown } from "@/modules/weather/domain/mode";

/**
 * BR-REQ-011-01 (§NNN) — `weatherShown`, the one resolver the page, the cards and the reminder ask:
 * the forecast, the club's own text in the reader's language, or nothing. Three modes, with and
 * without a text, in both languages; an unknown stored value reads as the forecast.
 */
const NOTES = { ro: { weatherNote: "Pe creastă e polei." }, en: { weatherNote: "The ridge is icy." } } as const;
const NONE = { weatherNote: null };

describe("BR-REQ-011-01 weatherShown (§NNN)", () => {
  for (const locale of ["ro", "en"] as const) {
    describe(`in ${locale}`, () => {
      it("forecast: the forecast, with or without a text — the text is never shown beside it", () => {
        expect(weatherShown({ weatherMode: "forecast" }, NOTES[locale])).toEqual({ kind: "forecast" });
        expect(weatherShown({ weatherMode: "forecast" }, NONE)).toEqual({ kind: "forecast" });
      });

      it("custom: the club's text in this language, trimmed; nothing without one", () => {
        expect(weatherShown({ weatherMode: "custom" }, NOTES[locale])).toEqual({ kind: "custom", text: NOTES[locale].weatherNote });
        expect(weatherShown({ weatherMode: "custom" }, { weatherNote: `  ${NOTES[locale].weatherNote} ` })).toEqual({
          kind: "custom",
          text: NOTES[locale].weatherNote,
        });
        expect(weatherShown({ weatherMode: "custom" }, NONE)).toBeNull();
        expect(weatherShown({ weatherMode: "custom" }, { weatherNote: "   " })).toBeNull();
        expect(weatherShown({ weatherMode: "custom" }, undefined)).toBeNull();
      });

      it("off: nothing, with or without a text", () => {
        expect(weatherShown({ weatherMode: "off" }, NOTES[locale])).toBeNull();
        expect(weatherShown({ weatherMode: "off" }, NONE)).toBeNull();
      });
    });
  }

  it("reads an unknown or missing stored value as the forecast", () => {
    expect(readWeatherMode("both")).toBe("forecast");
    expect(readWeatherMode(null)).toBe("forecast");
    expect(readWeatherMode(undefined)).toBe("forecast");
    expect(weatherShown({ weatherMode: "sunny" }, NOTES.ro)).toEqual({ kind: "forecast" });
    expect(weatherShown({}, NONE)).toEqual({ kind: "forecast" });
    expect(WEATHER_MODES).toEqual(["forecast", "custom", "off"]);
  });

  it("only the forecast asks for a forecast, and only it opens a weather window on the page clock", () => {
    expect(readsForecast({ weatherMode: "forecast" })).toBe(true);
    expect(readsForecast({})).toBe(true);
    expect(readsForecast({ weatherMode: "custom" })).toBe(false);
    expect(readsForecast({ weatherMode: "off" })).toBe(false);

    const startsAt = new Date("2026-10-20T16:00:00.000Z");
    const windowOpens = new Date("2026-10-13T16:00:00.000Z").getTime();
    const has = (mode?: string) => eventClockInstants({ startsAt, weatherMode: mode }).some((at) => at.getTime() === windowOpens);
    expect(has(undefined)).toBe(true);
    expect(has("forecast")).toBe(true);
    expect(has("custom")).toBe(false);
    expect(has("off")).toBe(false);
  });
});
