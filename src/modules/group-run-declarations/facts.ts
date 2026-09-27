import type { Database } from "@/db/types";
import type { Locale } from "@/i18n/routing";
import type { MergeValues } from "@/modules/legal-documents/domain/merge-fields";
import { eventMergeValues } from "@/modules/registrations/signed-declaration";
import { findRunSeries } from "./repository";
import { type RunSeries, seriesMergeValues, seriesRhythmPhrase, signatureCoversSeries } from "./series";

/**
 * A group-run declaration's blanks for one date, in one language (§393, §NNN): the run's facts as the
 * race's declaration fills them (`eventMergeValues`) and the series sentence's — the series' name,
 * rhythm and usual place, or "" on a one-off run — for a text that names them (`seriesMergeValues`).
 * The one function for everything that fills a group-run text — the signing page, the signing press
 * (which keeps them on the row, `signed_facts`) and the PDF of a row from before §NNN — so they cannot
 * fill the text differently: the page shows the series sentence exactly when the press records a
 * series signature and the PDF prints one. (A group run has no paper form: the desk's printable form
 * is the race's, §95; the emails name the series from the row's `series_key`, which this decides.)
 *
 * The series' name is the date's title in that language (§113 groups by the title); its usual place
 * is the date's own place — the text says «de obicei» / «usually» and sends a differing date to its
 * page — and its rhythm is read off every date the grouping gives it (`seriesRhythmPhrase`).
 *
 * `seriesKey` is the series a signature of `body` covers: the run's, only while the run has other
 * dates AND the text names `{{series}}` (`signatureCoversSeries`). Under a text that does not — the
 * version approved before §NNN, which names one run and `{{eventDate}}` — it is null, and the
 * signature covers the date it was signed on, as the signer read.
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
