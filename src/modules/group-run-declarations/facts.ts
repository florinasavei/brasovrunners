import type { Database } from "@/db/types";
import type { Locale } from "@/i18n/routing";
import type { MergeValues } from "@/modules/legal-documents/domain/merge-fields";
import { eventMergeValues } from "@/modules/registrations/signed-declaration";
import { findRunSeries } from "./repository";
import { type RunSeries, seriesMergeValues, seriesRhythmPhrase, signatureCoversSeries } from "./series";

/**
 * A group-run declaration's merge values for one date and language (§393, §523): the event's facts
 * plus the series' name, rhythm and usual place. The single source for the signing page, the press
 * (`signed_facts`) and the PDF, so they cannot fill the text differently.
 *
 * `seriesKey` is set only when the run has other dates AND the text names `{{series}}`; under an
 * older per-date text it is null and the signature covers that date alone.
 */
export async function groupRunMergeValues<T extends Record<string, unknown>>(
  db: Database<T>,
  eventId: string,
  locale: Locale,
  body: unknown,
): Promise<{ values: MergeValues; title: string; timezone: string; seriesKey: string | null } | undefined> {
  const event = await eventMergeValues(db, eventId, locale);
  if (!event) return undefined;
  const run = await findRunSeries(db, eventId);
  const series: RunSeries = run.key
    ? { key: run.key, title: event.title, rhythm: seriesRhythmPhrase(run.dates, event.timezone, locale), place: event.values.eventLocation ?? "" }
    : null;
  const seriesKey = run.key !== null && signatureCoversSeries(body) ? run.key : null;
  return { values: { ...event.values, ...seriesMergeValues(body, series) }, title: event.title, timezone: event.timezone, seriesKey };
}
