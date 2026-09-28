/**
 * A group run's series in a declaration (§523, the series of §113): the series sentence's values and
 * what a signature keeps of the blanks. Pure. The rhythm words are inline, not in the message
 * catalogue, because they fill a legal text (as `duration-words.ts`).
 */
import { recurrenceOf } from "@/modules/events/domain/series";
import { wallClockWeekday } from "@/modules/events/domain/zoned-time";
import { isLegalDocumentBody } from "@/modules/legal-documents/domain/content-hash";
import {
  isPlacelessSeriesSentence,
  MERGE_FIELDS,
  mergeFieldsIn,
  type MergeField,
  type MergeValues,
  SERIES_MERGE_FIELDS,
} from "@/modules/legal-documents/domain/merge-fields";

/** «în fiecare marți, la 18:30» / «every Tuesday at 18:30»; never a list of dates, which would go stale. */
export function seriesRhythmPhrase(dates: readonly { startsAt: Date }[], timeZone: string, locale: string): string {
  const en = locale === "en";
  const recurrence = recurrenceOf(dates, timeZone);
  if (recurrence.kind === "dates") return en ? "on the dates announced on the club's website" : "la datele anunțate pe site-ul clubului";
  const weekdayName = new Intl.DateTimeFormat(en ? "en" : "ro", { weekday: "long", timeZone });
  const names = recurrence.weekdays.map((weekday) => {
    const sample = dates.find((date) => wallClockWeekday(date.startsAt, timeZone) === weekday) ?? dates[0];
    return weekdayName.format(sample.startsAt);
  });
  const days = new Intl.ListFormat(en ? "en" : "ro", { type: "conjunction" }).format(names);
  if (en) {
    const head = recurrence.kind === "weekly" ? `every ${days}` : `every other ${days}`;
    return recurrence.time ? `${head} at ${recurrence.time}` : head;
  }
  const head = recurrence.kind === "weekly" ? `în fiecare ${days}` : `o dată la două săptămâni, ${days}`;
  return recurrence.time ? `${head}, la ${recurrence.time}` : head;
}

/** The series as a signature is bound to it: null for a one-off run. */
export type RunSeries = { key: string; title: string; rhythm: string; place: string } | null;

/**
 * A signature covers the series only when the signed text names `{{series}}` (§523, gated like §330);
 * an older text covers its one date.
 */
export function signatureCoversSeries(body: unknown): boolean {
  return mergeFieldsIn(body).has("series");
}

/**
 * The series sentence's values (§523): {} for a text with no series field; "" for each on a one-off
 * run, which drops the series sentence (`dropsParagraph`).
 *
 * Without a place, `seriesPlace: ""` is given only when the text has a placeless variant
 * (`isPlacelessSeriesSentence`), so exactly one of the two sentences survives; otherwise the place
 * stays a dotted blank.
 */
export function seriesMergeValues(body: unknown, series: RunSeries): MergeValues {
  const fields = mergeFieldsIn(body);
  if (!SERIES_MERGE_FIELDS.some((field) => fields.has(field))) return {};
  if (!series) return { series: "", seriesRhythm: "", seriesPlace: "" };
  const values: MergeValues = { series: series.title, seriesRhythm: series.rhythm };
  if (!fields.has("seriesPlace")) return values;
  const place = series.place.trim();
  if (place !== "") return { ...values, seriesPlace: place };
  const paragraphs = isLegalDocumentBody(body) ? body.sections.flatMap((section) => section.paragraphs) : [];
  return paragraphs.some(isPlacelessSeriesSentence) ? { ...values, seriesPlace: "" } : values;
}

/** Fields kept as signed (§523); nothing personal. */
const KEPT: ReadonlySet<MergeField> = new Set<MergeField>(["event", "eventDate", "eventLocation", "minimumAge", ...SERIES_MERGE_FIELDS]);

export function factsToKeep(values: MergeValues): Record<string, string> {
  return Object.fromEntries(Object.entries(values).filter((entry): entry is [MergeField, string] => KEPT.has(entry[0] as MergeField) && typeof entry[1] === "string"));
}

/** `signed_facts` read back (§523): null when nothing usable is kept (a row from before §523). */
export function readSignedFacts(value: unknown): MergeValues | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const known = new Set<string>(MERGE_FIELDS);
  const facts = Object.fromEntries(
    Object.entries(value as Record<string, unknown>).filter(([name, text]) => known.has(name) && KEPT.has(name as MergeField) && typeof text === "string"),
  ) as MergeValues;
  return Object.keys(facts).length > 0 ? facts : null;
}
