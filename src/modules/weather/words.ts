import { createTranslator } from "next-intl";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { formatDay, formatTime } from "@/i18n/dates";
import { rainLikely as isRainLikely, summarizeSpan, type WeatherReading } from "./domain/forecast";

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
  /** The «?» tooltip after the event page's line (§473): the forecast may vary, and whose data it is. */
  help: string;
  /** The chance of rain alone, «20%» — an hour of the block; null when the hour has none. */
  rainShort: string | null;
  /** «ploaie probabilă» / "rain likely" — the words a card, the hero and the event page add to the spoken text when `rainLikely` holds (§429). */
  rainLikely: string;
  /** «ploaie probabilă 60 %» when `rainLikely` holds (the chance only when the hour has one), else null (§469). */
  rainLikelyChance: string | null;
  /** The reminder's one line (§469): the sky's word, the degrees, and the rain phrase only when rain is likely — no wind, no humidity. */
  line: string;
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
  const rainLikelyChance = !isRainLikely(reading)
    ? null
    : reading.precipitationProbability !== null
      ? t("rainLikelyChance", { percent: whole(reading.precipitationProbability) })
      : t("rainLikely");
  return {
    label: t("label"),
    summary,
    details,
    credit: t("credit", { source: t("source") }),
    help: t("help", { source: t("source") }),
    extras,
    temperature,
    rainShort: reading.precipitationProbability !== null ? t("rainShort", { percent: whole(reading.precipitationProbability) }) : null,
    rainLikely: t("rainLikely"),
    rainLikelyChance,
    line: [summary, ...(temperature !== null ? [temperature] : []), ...(rainLikelyChance !== null ? [rainLikelyChance] : [])].join(", "),
  };
}

/**
 * The event page's «Vremea» line and the reminder's, for the hours the event is out (§484; the
 * owner, 2026-09-27: «La vreme vreau să zic și locația și intervalul»). One sentence, where and when
 * first, then what: «Vremea la Parcul Tractorul, sâmbătă, 26 sept. 18:00–20:00: Ploaie, 12–15 °C,
 * ploaie probabilă 70 %» / «Weather at Tractorul Park, Saturday, 26 Sept 18:00–20:00: Rain, 12–15 °C,
 * rain likely 70%». One hour alone — an event with no end — is «sâmbătă, 26 sept. 18:00», no dash.
 *
 * The sky is the span's (`summarizeSpan`'s `sky`: the wettest hour when rain is likely in any, else
 * the kind most hours share), the degrees its coldest and warmest — one figure when they round
 * alike — and «ploaie probabilă N %» only when rain is likely in any hour (§469's rule), N the
 * highest chance among those hours.
 *
 * `place` is `forecastPlaceName`'s answer — the club's locality when the forecast is the club's,
 * else the meeting point in this language (§362) — and null reads «locul evenimentului». The day
 * and the hours are on the event's own clock (`timeZone`), through the one date helper (§349, §439).
 */
export type WeatherSpanWords = {
  /** «Vremea» — the event page's row label, which the scope follows. */
  label: string;
  /** «Vremea la Brașov, sâmbătă, 26 sept. 18:00–20:00» — the reminder's row label, the values after it. */
  heading: string;
  /** Where and when, as it follows the label: «la Brașov, sâmbătă, 26 sept. 18:00–20:00». */
  scope: string;
  /** The span's sky in words: «Ploaie». */
  summary: string;
  /** The span's sky as a glyph name — the event page's row icon. */
  glyph: WeatherReading["glyph"];
  /** «14 °C» or «12–15 °C»; null when no hour of the span has a temperature. */
  temperature: string | null;
  /** «ploaie probabilă 60 %» when rain is likely in the span (the chance only when one is named), else null. */
  rainLikelyChance: string | null;
  /** What, without where and when: «Ploaie, 12–15 °C, ploaie probabilă 70 %» — the reminder row's line. */
  line: string;
  /** The whole sentence: `heading`, a colon, `line`. */
  sentence: string;
  credit: string;
  help: string;
};

export function weatherSpanWords(
  forecast: { start: WeatherReading; span: readonly WeatherReading[] },
  locale: "ro" | "en",
  where: { place: string | null; timeZone: string },
): WeatherSpanWords {
  const t = weatherCatalogue(locale);
  const number = new Intl.NumberFormat(locale === "ro" ? "ro-RO" : "en-GB", { maximumFractionDigits: 0 });
  const whole = (value: number) => {
    const rounded = Math.round(value);
    return number.format(rounded === 0 ? 0 : rounded);
  };
  const span = forecast.span.length > 0 ? forecast.span : [forecast.start];
  const summed = summarizeSpan(span);
  const sky = summed.sky ?? forecast.start;
  const summary = t(`codes.${sky.kind}`);
  const temperature =
    summed.minC === null || summed.maxC === null
      ? null
      : whole(summed.minC) === whole(summed.maxC)
        ? t("temperature", { degrees: whole(summed.maxC) })
        : t("temperatureRange", { from: whole(summed.minC), to: whole(summed.maxC) });
  const rainLikelyChance = !summed.rainLikely
    ? null
    : summed.rainChance !== null
      ? t("rainLikelyChance", { percent: whole(summed.rainChance) })
      : t("rainLikely");
  const time = (at: number) => formatTime(new Date(at), { locale, timeZone: where.timeZone });
  const hours = summed.toHour > summed.fromHour ? t("hourRange", { from: time(summed.fromHour), to: time(summed.toHour) }) : time(summed.fromHour);
  // The day the first hour falls on — an interval past midnight keeps the start's day, «22:00–01:00».
  const day = formatDay(new Date(summed.fromHour), { locale, timeZone: where.timeZone, style: "long", year: false, position: "inline" });
  const scope = t("scope", { place: where.place ?? t("eventPlace"), day, hours });
  const heading = t("heading", { scope });
  const line = [summary, ...(temperature !== null ? [temperature] : []), ...(rainLikelyChance !== null ? [rainLikelyChance] : [])].join(", ");
  return {
    label: t("label"),
    heading,
    scope,
    summary,
    glyph: sky.glyph,
    temperature,
    rainLikelyChance,
    line,
    sentence: `${heading}: ${line}`,
    credit: t("credit", { source: t("source") }),
    help: t("help", { source: t("source") }),
  };
}

function weatherCatalogue(locale: "ro" | "en") {
  return createTranslator({ locale, messages: locale === "ro" ? ro : en, namespace: "Weather" });
}

/**
 * The words that belong to no one hour: a card pill's
 * spoken prefix, «Vremea la start»; and the credit, «Prognoză: Open-Meteo», for the site footer's
 * «Despre club» fold (`SiteFooter`, §429) — the event page and the featured hero say theirs beside
 * the forecast, through `weatherWords`.
 */
export function weatherListWords(locale: "ro" | "en"): { atStart: string; credit: string } {
  const t = weatherCatalogue(locale);
  return { atStart: t("atStart"), credit: t("credit", { source: t("source") }) };
}

/**
 * The row's label alone, «Vremea» / «Weather», for the club's own text (§666): the page's row and the
 * reminder's line say the label, then the club's words as written — no place, no hours, no credit and
 * no «?», since nothing in them is the forecast's.
 */
export function weatherLabel(locale: "ro" | "en"): string {
  return weatherCatalogue(locale)("label");
}
