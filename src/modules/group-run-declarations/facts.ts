import type { Database } from "@/db/types";
import { formatDay } from "@/i18n/dates";
import type { Locale } from "@/i18n/routing";
import { isLegalDocumentBody, type LegalDocumentBody } from "@/modules/legal-documents/domain/content-hash";
import type { MergeValues } from "@/modules/legal-documents/domain/merge-fields";
import { signedTextHash } from "@/modules/legal-documents/domain/signed-text";
import { eventMergeValues } from "@/modules/registrations/signed-declaration";
import { findRunSeries } from "./repository";
import { readSignedFacts, type RunSeries, seriesMergeValues, seriesRhythmPhrase, signatureCoversSeries } from "./series";

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

/**
 * The run's blanks for one signature (§523): what the blanks said at the signing (`signed_facts`)
 * over the event as it is — a date moved or renamed since never changes what a signed declaration
 * says (§57). A row from before §523 kept none, and reads the event as it is. The PDF's and the
 * signing's one reading of them (§556), so the fingerprint taken at the press is over the text the
 * PDF prints.
 */
export async function groupRunSignedFacts<T extends Record<string, unknown>>(
  db: Database<T>,
  signed: { eventId: string; locale: Locale; body: unknown; signedFacts: unknown },
): Promise<{ values: MergeValues; title: string; timezone: string } | undefined> {
  const current = await eventMergeValues(db, signed.eventId, signed.locale);
  if (!current) return undefined;
  const kept = readSignedFacts(signed.signedFacts);
  return {
    ...current,
    title: kept?.event ?? current.title,
    values: kept ? { ...current.values, ...kept } : ((await groupRunMergeValues(db, signed.eventId, signed.locale, signed.body))?.values ?? current.values),
  };
}

/**
 * The blanks a signed group-run declaration fills beside the run's (§393): the signer declares for
 * themselves (adults only), so `{{participant}}` and `{{declarant}}` are the signer and `{{guardian}}`
 * an em dash; the identity document as the caller passes it (masked for the club's copy, §320); the
 * moment of signing inside its sentence, in the run's zone.
 */
export function groupRunSignedValues(
  event: { values: MergeValues; timezone: string },
  signer: { typedName: string; idDocument: string | null; locale: Locale; acceptedAt: Date },
): MergeValues {
  return {
    ...event.values,
    participant: signer.typedName,
    declarant: signer.typedName,
    guardian: "—",
    idDocument: signer.idDocument ?? undefined,
    participantIdDocument: signer.idDocument ?? undefined,
    guardianIdDocument: "—",
    signedAt: formatDay(signer.acceptedAt, { locale: signer.locale, timeZone: event.timezone, style: "long", withTime: true, position: "inline" }),
  };
}

/**
 * The fingerprint of a group-run declaration as it is signed (§556): the version's text in the
 * signer's language, filled as their own PDF fills it — the facts the row will keep, the document as
 * typed, the moment of signing — hashed before the row is written, in the same transaction.
 */
export async function groupRunTextHash<T extends Record<string, unknown>>(
  db: Database<T>,
  input: {
    eventId: string;
    document: { title: string; body: unknown };
    signedFacts: unknown;
    signer: { typedName: string; idDocument: string | null; locale: Locale; acceptedAt: Date };
  },
): Promise<string | null> {
  const event = await groupRunSignedFacts(db, { eventId: input.eventId, locale: input.signer.locale, body: input.document.body, signedFacts: input.signedFacts });
  if (!event) return null;
  const body: LegalDocumentBody = isLegalDocumentBody(input.document.body) ? input.document.body : { sections: [] };
  return signedTextHash({ title: input.document.title, body, values: groupRunSignedValues(event, input.signer) });
}
