import type { EmailMessageType } from "@/db/schema/email-outbox";
import type { EmailLocale } from "@/infrastructure/email/adapter";
import type { RichTextDoc } from "@/modules/content/rich-text/domain/schema";
import { env } from "@/shared/config/env";
import { EMAIL_COPY_PLACEHOLDERS, type EmailCopyEntry, type EmailCopyPlaceholder, placeholdersIn } from "./domain/email-copy";
import {
  emailBodyToParagraphs,
  emailDocFromParagraphs,
  emphasisMarkersToBold,
  mapEmailDocText,
  readEmailBody,
  splitBlankLineParagraphs,
  withoutParagraphs,
} from "./domain/email-rich-text";
import {
  EMAIL_SAMPLE,
  EMAIL_SAMPLE_FORMER_WHEN,
  type EmailSampleHit,
  emailSampleLiteralsIn,
  emailSampleReplacementOf,
  emailSampleValueOf,
  replaceEmailSampleLiterals,
} from "./domain/email-sample";
import { buildTemplateContent, platformWords, type TemplateData } from "./templates";

/**
 * The club's words and the page's sample kept apart (`DECISIONS.md` §NNN; the owner, 2026-09-24:
 * "all emails text must include these placeholders!").
 *
 * Three things live here, all about the editor under each preview on `/admin/emails`:
 *
 * 1. **The sample the previews are rendered with** — `emailSampleData`, built from the one constant
 *    in `domain/email-sample.ts`, so the preview and the guard cannot disagree on what "a sample
 *    value" is. The previews render exactly as they did.
 * 2. **The editor's starting text** — `emailCopyPrefill`: the platform's words with every field of
 *    the closed set (§247) written as its placeholder, `{eventTitle}` where the preview says
 *    "Crosul de toamnă". Only the starting text changed: a message the club never rewrote is built
 *    by `buildTemplateContent` exactly as before, and a saved text is filled exactly as before.
 * 3. **The sample values in a text** — `sampleValuesIn`, what the save refuses and what the amber
 *    warning over an already-saved text names; and `replaceSampleValues`, what "Înlocuiește cu
 *    câmpurile" does to it.
 */

const OTHER: Record<EmailLocale, EmailLocale> = { ro: "en", en: "ro" };

/** The made-up runner at the made-up event (§91), as every preview on the page is rendered with. */
export function emailSampleData(locale: EmailLocale): TemplateData {
  const sample = EMAIL_SAMPLE[locale];
  const base = env.APP_BASE_URL;
  return {
    participantName: sample.participantName,
    eventTitle: sample.eventTitle,
    eventLocationName: sample.eventLocationName,
    // Through the one helper the send path uses (§349), so the preview cannot drift from the mail.
    eventStartsAtFormatted: sample.eventStartsAtFormatted,
    eventStartsAtFormattedOther: EMAIL_SAMPLE[OTHER[locale]].eventStartsAtFormatted,
    currentStatus: sample.currentStatus,
    checkinCode: sample.checkinCode,
    checkinQrUrl: `${base}/api/registrations/qr/${sample.checkinCode}.png`,
    bibNumber: sample.bibNumber,
    eventMapUrl: `${base}/#map`,
    eventChecklist: sample.eventChecklist,
    replyTo: env.EMAIL_REPLY_TO ?? undefined,
    thanksUrl: `${base}/#results`,
    declarationPdfUrl: `${base}/api/registrations/declaration/EXAMPLE`,
    eventUrl: `${base}/${locale}/EXAMPLE-event`,
    eventRulesUrl: `${base}/${locale}/EXAMPLE-event#rules`,
    eventScheduleUrl: `${base}/${locale}/EXAMPLE-event#schedule`,
    // "Linkuri și fișiere" (§332): the sample event has some, so the preview shows the line.
    eventLinksUrl: `${base}/${locale}/EXAMPLE-event#links`,
    manageUrl: `${base}/${locale}/EXAMPLE`,
    // The public list's switch on the confirmation (§143): the sample runner is on the list.
    listConsentUrl: `${base}/${locale}/EXAMPLE-list`,
    listed: true,
    // The staff invitation (§141): a made-up colleague, added by a made-up administrator.
    staffRole: sample.staffRole,
    inviterName: sample.inviterName,
    staffEmail: sample.staffEmail,
    signInUrl: `${base}/${locale}/EXAMPLE`,
    // "Detalii actualizate" and "Eveniment anulat" (§331): a new place and start, the
    // organizer's note, and a reason — read only by those two messages' templates.
    updateChanges: ["place", "time"],
    organizerNote: sample.organizerNote,
    cancellationReason: sample.cancellationReason,
  };
}

/** Where a sample message's button points: the site, with `EXAMPLE` where a token would be. */
export function emailSampleActionUrl(locale: EmailLocale): string {
  return `${env.APP_BASE_URL}/${locale}/EXAMPLE`;
}

/**
 * Every field of the closed set standing for itself — the data the editor's starting text is
 * built from. Decided per field and per sentence (§NNN):
 *
 * - **every field of the set is present**, so every sentence the platform writes around one is in
 *   the text with its placeholder: the bib, the desk code, the checklist, and the two dates the page's
 *   sample has none of (the hold's deadline, the time of signing), because the messages that name
 *   them always carry them when they are sent (`render.ts`);
 * - **the colleague's address is absent**: `{staffEmail}` is not in the set, so the invitation's
 *   sentence reads with the platform's own fallback, "Intri cu adresa aceasta" — true, because the
 *   invitation goes to that address;
 * - **the thank-you's link is absent**: "the results are at the link below" would be kept by a
 *   saved text on a thank-you sent without one; the button, which names itself, is the machinery;
 * - **the programme's lines, the organizer's note and the cancellation's reason are absent**: they
 *   have no field, and the platform adds the note and the reason after the words whoever wrote them;
 * - **the declaration's first wording is the thirty-minute hold's**, as the preview shows it; a
 *   saved text replaces both wordings, as it always has (§247);
 * - **the reply line of the cancellation follows the deployment's reply address**, as the send does.
 */
function fieldsData(): TemplateData {
  const field = (name: EmailCopyPlaceholder) => `{${name}}`;
  return {
    participantName: field("participantName"),
    eventTitle: field("eventTitle"),
    eventLocationName: field("eventLocationName"),
    eventStartsAtFormatted: field("eventStartsAtFormatted"),
    // A template only ever prints the number, so its placeholder stands in for it.
    bibNumber: field("bibNumber") as unknown as number,
    checkinCode: field("checkinCode"),
    currentStatus: field("currentStatus"),
    holdExpiresAtFormatted: field("holdExpiresAtFormatted"),
    signedAtFormatted: field("signedAtFormatted"),
    eventChecklist: field("eventChecklist"),
    staffRole: field("staffRole"),
    inviterName: field("inviterName"),
    replyTo: env.EMAIL_REPLY_TO ?? undefined,
  };
}

export type EmailCopyPrefill = {
  subject: string;
  /** The plain paragraphs, as a save of the text unchanged would store them. */
  paragraphs: string[];
  /** The same words as the document the editor opens with: one block per paragraph, the bold as bold. */
  body: RichTextDoc;
};

/** The editor's starting text for one message and language: the platform's words, with the fields. */
export function emailCopyPrefill(messageType: EmailMessageType, locale: EmailLocale): EmailCopyPrefill {
  const words = platformWords(messageType, locale, fieldsData());
  const body = emailDocFromParagraphs(words.paragraphs);
  return { subject: words.subject, paragraphs: emailBodyToParagraphs(body), body };
}

/** The fields this message's platform text uses, in the closed set's order — said first under the box. */
export function placeholdersUsedBy(messageType: EmailMessageType, locale: EmailLocale): EmailCopyPlaceholder[] {
  const prefill = emailCopyPrefill(messageType, locale);
  const used = new Set(placeholdersIn([prefill.subject, ...prefill.paragraphs].join("\n")));
  return EMAIL_COPY_PLACEHOLDERS.filter((name) => used.has(name));
}

type SampleSentence = {
  /** The platform's sentence as the old starting text had it: with the sample's values. */
  sample: string;
  /** The same sentence with its fields. */
  fields: string;
  /** The values in it, each with its field — how the bib and the status are found (they are not literals). */
  values: { value: string; placeholder: EmailCopyPlaceholder }[];
};

const stripMarkers = (text: string) => text.replace(/\*\*([^*]+)\*\*/g, "$1");

/**
 * The platform's own sentences of one message, as the editor's old starting text wrote them — with
 * the sample's values — beside the same sentences with the fields. A text saved from that starting
 * text holds them verbatim wherever nobody touched them, bib and status included, and those two are
 * too ordinary to look for on their own ("42 de kilometri").
 *
 * Each sentence with and without the `**` markers: the old starting text carried the asterisks into
 * the editor as characters; a sentence typed in the box carries none. And with every former form
 * of the sample's date (§349 changed it on the same day as this).
 */
function sampleSentencesOf(messageType: EmailMessageType, locale: EmailLocale): SampleSentence[] {
  const words = platformWords(messageType, locale, fieldsData());
  const texts = [...new Set([words.subject, ...words.paragraphs, ...words.paragraphs.map(stripMarkers)])];
  const whens = [EMAIL_SAMPLE[locale].eventStartsAtFormatted, ...EMAIL_SAMPLE_FORMER_WHEN[locale]];
  const sentences = new Map<string, SampleSentence>();
  for (const text of texts) {
    const names = placeholdersIn(text) as EmailCopyPlaceholder[];
    if (names.length === 0) continue;
    for (const when of names.includes("eventStartsAtFormatted") ? whens : whens.slice(0, 1)) {
      const valueOf = (name: EmailCopyPlaceholder) => (name === "eventStartsAtFormatted" ? when : emailSampleValueOf(name, locale));
      // A sentence with a field the sample never had (the hold's deadline, the time of signing) was
      // never in the old starting text with a value; there is nothing to find.
      if (names.some((name) => valueOf(name) === undefined)) continue;
      const sample = text.replace(/\{([A-Za-z0-9_]+)\}/g, (_whole, name: string) => valueOf(name as EmailCopyPlaceholder) as string);
      if (sample === text || sentences.has(sample)) continue;
      sentences.set(sample, { sample, fields: text, values: names.map((name) => ({ value: valueOf(name) as string, placeholder: name })) });
    }
  }
  // The longest first, so a sentence is replaced whole before a shorter one inside it is.
  return [...sentences.values()].sort((a, b) => b.sample.length - a.sample.length);
}

/**
 * The platform's lines the old starting text wrongly carried into the editor: the update notice's
 * "the meeting point is now …" and "the date and time are now …" (§331), which the platform adds
 * after the words whoever wrote them. A saved text holding them said them twice.
 */
function framingSentencesOf(messageType: EmailMessageType, locale: EmailLocale): Set<string> {
  const sample = emailSampleData(locale);
  const body = new Set(platformWords(messageType, locale, sample).paragraphs);
  return new Set(
    buildTemplateContent(messageType, locale, sample, emailSampleActionUrl(locale))
      .paragraphs.filter((part): part is string => typeof part === "string" && !body.has(part))
      .map(stripMarkers),
  );
}

/**
 * The sample values in a text — the one the save is handed (the guard) or the one already saved
 * (the warning). One hit per value and box, in the order found: the subject, then the words.
 */
export function sampleValuesIn(
  entry: { subject: string; paragraphs: readonly string[] },
  messageType: EmailMessageType,
  locale: EmailLocale,
): EmailSampleHit[] {
  const hits: EmailSampleHit[] = [];
  const add = (hit: EmailSampleHit) => {
    if (!hits.some((known) => known.field === hit.field && known.value === hit.value)) hits.push(hit);
  };
  const sentences = sampleSentencesOf(messageType, locale);
  const scan = (text: string, field: EmailSampleHit["field"]) => {
    for (const literal of emailSampleLiteralsIn(text, messageType)) {
      add(
        literal.placeholder
          ? { field, value: literal.value, placeholder: literal.placeholder }
          : { field, value: literal.value, words: emailSampleReplacementOf(literal, locale) },
      );
    }
    for (const sentence of sentences) {
      if (!text.includes(sentence.sample)) continue;
      for (const { value, placeholder } of sentence.values) add({ field, value, placeholder });
    }
  };
  scan(entry.subject, "subject");
  for (const paragraph of entry.paragraphs) scan(paragraph, "body");
  return hits;
}

/**
 * "Înlocuiește cu câmpurile" (§NNN): every sample value of a text rewritten to its field — the
 * platform's own sentences whole first (which is how the bib and the status are caught), then each
 * sample value wherever else it stands.
 *
 * It also undoes the other two things the old starting text did to a document saved from it: one
 * paragraph holding every paragraph is split at its blank lines, and the `**` the platform marks
 * bold with becomes bold rather than two asterisks printed in the message. And the update notice's
 * two lines the platform adds anyway are dropped. A formatted text keeps its formatting: the
 * rewrite happens inside each run, so a value somebody made bold stays bold as its field.
 */
export function replaceSampleValues(entry: EmailCopyEntry, messageType: EmailMessageType, locale: EmailLocale): EmailCopyEntry {
  const sentences = sampleSentencesOf(messageType, locale);
  const framing = framingSentencesOf(messageType, locale);
  const rewrite = (text: string) => {
    let out = text;
    for (const sentence of sentences) out = out.split(sentence.sample).join(sentence.fields);
    return replaceEmailSampleLiterals(out, messageType, locale);
  };
  const subject = rewrite(entry.subject);

  const doc = entry.body ? readEmailBody(entry.body) : null;
  if (doc) {
    const body = emphasisMarkersToBold(mapEmailDocText(withoutParagraphs(splitBlankLineParagraphs(doc), framing), rewrite));
    return { subject, paragraphs: emailBodyToParagraphs(body), body };
  }
  const paragraphs = entry.paragraphs
    .flatMap((paragraph) => paragraph.split(/\s*\n\s*\n\s*/))
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph !== "" && !framing.has(stripMarkers(paragraph)))
    .map(rewrite);
  return { ...entry, subject, paragraphs };
}
