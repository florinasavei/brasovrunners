/**
 * A group run's series in a declaration (§523): the values of the series sentence, what a signature
 * keeps of the text's blanks, and how a run that is one of a series is told from a one-off. Pure.
 *
 * The series is §113's — the same type and title, as the listing groups it (`seriesKey`) — and a run
 * is one of a series when that grouping gives it another date. Its rhythm is read off the dates as
 * the listing reads it (`recurrenceOf`), in the declaration's own language, with no catalogue behind
 * it: the words are part of a legal text's fill-ins, as the deadlines' are (`duration-words.ts`).
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

/**
 * How a series recurs, as the series sentence says it: «în fiecare marți, la 18:30» / «every Tuesday
 * at 18:30», «o dată la două săptămâni, joi, la 07:00» / «every other Thursday at 07:00», and for dates
 * with no weekly shape «la datele anunțate pe site-ul clubului» / «on the dates announced on the
 * club's website» — never a list of dates that the next week's would outdate.
 */
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
 * Whether a signature of this text covers the run's series (§523): only when the text signed names
 * `{{series}}` — the platform's series sentence, which says so to the signer. Read from the version in
 * force at the signing, in the signer's language, as `{{participantIdDocument}}` gates the minor's
 * own signature (§330). A text approved before §523 names one run and `{{eventDate}}`: a signature of
 * it covers that date alone, one row per date as before, whatever the run's other dates.
 */
export function signatureCoversSeries(body: unknown): boolean {
  return mergeFieldsIn(body).has("series");
}

/**
 * The series sentence's values for a text (§523): none at all for a text that names no series field —
 * every version approved before §523, whose sentences are left exactly as they were — else the
 * series' name, rhythm and usual place, or "" for each on a one-off run, which drops the series
 * sentence and keeps the one-off one (`dropsParagraph`).
 *
 * **The usual place, when the run has none** (a date whose place is not written in that language).
 * The platform's text carries the series sentence in two shapes, with the place clause and without
 * it (`isPlacelessSeriesSentence`): a place fills the first, and the second is dropped; no place
 * gives `{{seriesPlace}}` "", which drops the first and keeps the second — never both, so the text
 * always says what it covers. A text with no placeless shape keeps its one series sentence with the
 * place left as a dotted blank, as `{{eventLocation}}` is on a one-off's; a text that names no
 * `{{seriesPlace}}` is given none.
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

/** The fields a signature keeps as they were filled (§523): the run's facts and the series'. */
const KEPT: ReadonlySet<MergeField> = new Set<MergeField>(["event", "eventDate", "eventLocation", "minimumAge", ...SERIES_MERGE_FIELDS]);

/** What `signed_facts` keeps of the values the signer read: the run's and the series' facts, nothing personal. */
export function factsToKeep(values: MergeValues): Record<string, string> {
  return Object.fromEntries(Object.entries(values).filter((entry): entry is [MergeField, string] => KEPT.has(entry[0] as MergeField) && typeof entry[1] === "string"));
}

/**
 * `signed_facts` read back (§523): the kept fields that are strings, anything else dropped — a row
 * from before §523, or a value nobody wrote this way, is null, and the PDF reads the event as it is.
 */
export function readSignedFacts(value: unknown): MergeValues | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const known = new Set<string>(MERGE_FIELDS);
  const facts = Object.fromEntries(
    Object.entries(value as Record<string, unknown>).filter(([name, text]) => known.has(name) && KEPT.has(name as MergeField) && typeof text === "string"),
  ) as MergeValues;
  return Object.keys(facts).length > 0 ? facts : null;
}
