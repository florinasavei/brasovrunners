import { createTranslator } from "next-intl";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import type { WeatherReading } from "./domain/forecast";

/**
 * A forecast in words, in one language (§402) — the page's row and the reminder's row say the
 * same pieces in the same order, from the `Weather` catalogue in both languages.
 *
 * `createTranslator`, not a request's `getTranslations`, because the reminder is rendered by the
 * outbox drain long after any request (the same reason as `calendar-labels.ts`); the page reads it
 * the same way so the two cannot word a forecast differently. The catalogues are imported
 * statically, as the calendar labels already import them: nothing new reaches the server bundle
 * and nothing reaches a browser — both callers are Server Components or server code.
 *
 * The numbers are whole: "14 °C", "20%", "11 km/h" — a decimal of a forecast is noise. The
 * locale's own digits and minus sign (`Intl.NumberFormat`), and never "-0 °C".
 */
export type WeatherWords = {
  /** The row's label, «Vremea» / «Weather». */
  label: string;
  /** The kind in words: «Parțial noros». */
  summary: string;
  /** The pieces after it: the temperature, the chance of rain, the wind — each only when the hour has it. */
  details: string[];
  /** The credit the data's licence asks for, «Prognoză: Open-Meteo». */
  credit: string;
};

export function weatherWords(reading: WeatherReading, locale: "ro" | "en"): WeatherWords {
  const t = createTranslator({ locale, messages: locale === "ro" ? ro : en, namespace: "Weather" });
  const number = new Intl.NumberFormat(locale === "ro" ? "ro-RO" : "en-GB", { maximumFractionDigits: 0 });
  const whole = (value: number) => {
    const rounded = Math.round(value);
    return number.format(rounded === 0 ? 0 : rounded);
  };
  const summary = t(`codes.${reading.kind}`);
  const details = [
    ...(reading.temperatureC !== null ? [t("temperature", { degrees: whole(reading.temperatureC) })] : []),
    ...(reading.precipitationProbability !== null ? [t("rain", { percent: whole(reading.precipitationProbability) })] : []),
    ...(reading.windKmh !== null ? [t("wind", { speed: whole(reading.windKmh) })] : []),
  ];
  return {
    label: t("label"),
    summary,
    details,
    credit: t("credit", { source: t("source") }),
  };
}
