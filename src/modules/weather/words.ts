import { createTranslator } from "next-intl";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { CLUB_LOCALITY } from "@/modules/events/domain/place";
import type { WeatherReading } from "./domain/forecast";
import type { ForecastPlaceSource } from "./domain/place";

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
  /**
   * The event page's details for the start hour (§416): how warm it feels, how much falls (only
   * when anything does), the gusts, the humidity, the UV index (only when the sun is up to it) —
   * each only when the hour has it. Never on the reminder or the cards.
   */
  extras: string[];
  /** The degrees alone, «14 °C» — a card's pill and an hour of the block; null when the hour has none. */
  temperature: string | null;
  /** The chance of rain alone, «20%» — an hour of the block; null when the hour has none. */
  rainShort: string | null;
  /** The chance of rain as a phrase, «60% șanse de ploaie» — a card pill's spoken words when rain is likely (§NNN); null when the hour has none. */
  rain: string | null;
};

export function weatherWords(reading: WeatherReading, locale: "ro" | "en"): WeatherWords {
  const t = weatherCatalogue(locale);
  const number = new Intl.NumberFormat(locale === "ro" ? "ro-RO" : "en-GB", { maximumFractionDigits: 0 });
  const tenth = new Intl.NumberFormat(locale === "ro" ? "ro-RO" : "en-GB", { maximumFractionDigits: 1 });
  const whole = (value: number) => {
    const rounded = Math.round(value);
    return number.format(rounded === 0 ? 0 : rounded);
  };
  const summary = t(`codes.${reading.kind}`);
  const temperature = reading.temperatureC !== null ? t("temperature", { degrees: whole(reading.temperatureC) }) : null;
  const rain = reading.precipitationProbability !== null ? t("rain", { percent: whole(reading.precipitationProbability) }) : null;
  const details = [
    ...(temperature !== null ? [temperature] : []),
    ...(rain !== null ? [rain] : []),
    ...(reading.windKmh !== null ? [t("wind", { speed: whole(reading.windKmh) })] : []),
  ];
  // Rain under a tenth of a millimetre and a UV index that rounds to 0 are nothing to read.
  const falls = reading.precipitationMm !== null && Math.round(reading.precipitationMm * 10) > 0;
  const sunny = reading.uvIndex !== null && Math.round(reading.uvIndex) > 0;
  const extras = [
    ...(reading.feelsLikeC !== null ? [t("feelsLike", { degrees: whole(reading.feelsLikeC) })] : []),
    ...(falls ? [t("precipitation", { amount: tenth.format(Math.round((reading.precipitationMm ?? 0) * 10) / 10) })] : []),
    ...(reading.gustKmh !== null ? [t("gusts", { speed: whole(reading.gustKmh) })] : []),
    ...(reading.humidity !== null ? [t("humidity", { percent: whole(reading.humidity) })] : []),
    ...(sunny ? [t("uv", { index: whole(reading.uvIndex ?? 0) })] : []),
  ];
  return {
    label: t("label"),
    summary,
    details,
    credit: t("credit", { source: t("source") }),
    extras,
    temperature,
    rainShort: reading.precipitationProbability !== null ? t("rainShort", { percent: whole(reading.precipitationProbability) }) : null,
    rain,
  };
}

function weatherCatalogue(locale: "ro" | "en") {
  return createTranslator({ locale, messages: locale === "ro" ? ro : en, namespace: "Weather" });
}

/**
 * Which place the forecast is for, in words (§416): «Pentru locul evenimentului» when it was read
 * at the event's own pin or typed pair, «Pentru Brașov» when it fell back to the club's place — so
 * a runner never reads the city's forecast as the trailhead's.
 */
export function forecastPlaceWords(source: ForecastPlaceSource, locale: "ro" | "en"): string {
  const t = weatherCatalogue(locale);
  return source === "club" ? t("place.club", { place: CLUB_LOCALITY }) : t("place.event");
}

/**
 * The words that belong to no one hour: the block's list name, «Pe ore, de la start»; a card pill's
 * spoken prefix, «Vremea la start»; and the credit, «Prognoză: Open-Meteo», for the listing's one
 * line under its cards.
 */
export function weatherListWords(locale: "ro" | "en"): { hours: string; atStart: string; credit: string } {
  const t = weatherCatalogue(locale);
  return { hours: t("hours"), atStart: t("atStart"), credit: t("credit", { source: t("source") }) };
}
