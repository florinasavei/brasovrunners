import type { EmailMessageType } from "@/db/schema/email-outbox";
import type { EmailLocale } from "@/infrastructure/email/adapter";
import type { RichTextDoc } from "@/modules/content/rich-text/domain/schema";
import { env } from "@/shared/config/env";
import {
  copyFor,
  EMAIL_COPY_CONDITIONAL_FACTS,
  EMAIL_COPY_PLACEHOLDERS,
  type EmailCopy,
  type EmailCopyEntry,
  type EmailCopyPlaceholder,
  placeholdersIn,
} from "./domain/email-copy";
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
  EMAIL_SAMPLE_FORMER_INVITER,
  EMAIL_SAMPLE_FORMER_WHEN,
  type EmailSampleHit,
  emailSampleLiteralsIn,
  emailSampleReplacementOf,
  emailSampleValueOf,
  replaceEmailSampleLiterals,
} from "./domain/email-sample";
import { buildTemplateContent, platformWords, type TemplateData } from "./templates";

/**
 * The club's words and the page's sample kept apart (`DECISIONS.md` §359; the owner, 2026-09-24:
 * "all emails text must include these placeholders!").
 *
 * Three things live here, all about the editor under each preview on `/admin/emails`:
 *
 * 1. **The sample the previews are rendered with** — `emailSampleData`, built from the one constant
 *    in `domain/email-sample.ts`, so the preview and the guard cannot disagree on what "a sample
 *    value" is. The previews render exactly as they did.
 * 2. **The editor's starting text** — `emailCopyPrefill`: the platform's words with every field of
 *    the closed set (§247) written as its placeholder, `{eventTitle}` where the preview says
 *    "Crosul de toamnă". A message the club never rewrote is built by `buildTemplateContent`
 *    exactly as before. A saved text is filled as before, with one rule added for what the
 *    platform says only when a fact exists: a paragraph whose only fields are facts the message
 *    lacks is not sent (`onlyMissingFacts`), and the starting text gives each such sentence its
 *    own paragraph (`ownParagraphsOf`).
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
    // organizer's note, and a reason — read only by those two messages' templates. Each in both
    // languages, as the organizer now writes them (§354, bilingual everywhere): the previewed
    // language's half first, the other half's own words after the rule, never the same text twice.
    updateChanges: ["place", "time"],
    organizerNote: sample.organizerNote,
    organizerNoteOther: EMAIL_SAMPLE[OTHER[locale]].organizerNote,
    cancellationReason: sample.cancellationReason,
    cancellationReasonOther: EMAIL_SAMPLE[OTHER[locale]].cancellationReason,
    // "Trimite un mesaj participanților" (§364): a sample message, both languages, read only by its
    // template — with the title and what to bring in the second half's language, as its send has them.
    eventTitleOther: EMAIL_SAMPLE[OTHER[locale]].eventTitle,
    eventChecklistOther: EMAIL_SAMPLE[OTHER[locale]].eventChecklist,
    organizerSubject: sample.organizerSubject,
    organizerSubjectOther: EMAIL_SAMPLE[OTHER[locale]].organizerSubject,
    organizerBody: sample.organizerBody,
    organizerBodyOther: EMAIL_SAMPLE[OTHER[locale]].organizerBody,
  };
}

/** Where a sample message's button points: the site, with `EXAMPLE` where a token would be. */
export function emailSampleActionUrl(locale: EmailLocale): string {
  return `${env.APP_BASE_URL}/${locale}/EXAMPLE`;
}

/**
 * Every field of the closed set standing for itself — the data the editor's starting text is
 * built from. Decided per field and per sentence (§359):
 *
 * - **every field of the set is present**, so every sentence the platform writes around one is in
 *   the text with its placeholder — the bib, the desk code, the checklist, and the two dates the
 *   page's sample has none of (the hold's deadline, the time of signing). **Not every send carries
 *   all of them** (`render.ts`). Four are in fact sometimes missing where the platform text names
 *   them: the number (none yet, or none at an event without numbers), the desk code (never on the
 *   club's copy, §320), what to bring (only when the event says) and the hold's deadline (only
 *   while it is ahead, §160). The platform leaves its sentence out then; a saved text leaves out a
 *   paragraph whose only fields are facts the message lacks (`onlyMissingFacts`, over
 *   `EMAIL_COPY_CONDITIONAL_FACTS`), so each such sentence starts a paragraph of its own here
 *   (`ownParagraphsOf`) and a text saved unchanged drops it as the platform does. The rest are
 *   there wherever the platform text names them: the time of signing on the two messages about a
 *   signed declaration, which carry it from that declaration; the event's title and start on every
 *   message about an event, since only a published event, both languages written, takes
 *   registrations (§28); the colleague's role and inviter in every invitation's payload;
 * - **the colleague's address is absent**: `{staffEmail}` is not in the set, so the invitation's
 *   sentence reads with the platform's own fallback, "Intri cu adresa aceasta" — true, because the
 *   invitation goes to that address;
 * - **the thank-you's link is absent**: "the results are at the link below" would be kept by a
 *   saved text on a thank-you sent without one; the button, which names itself, is the machinery;
 * - **the programme's lines, the organizer's note and the cancellation's reason are absent**: they
 *   have no field, and the platform adds the note and the reason after the words whoever wrote them;
 * - **the declaration's first wording is the club's hold's (§NNN)**, as the preview shows it; a
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

/**
 * One platform paragraph as the starting text's paragraphs: a new one starts at each later sentence
 * that names a fact the platform writes only when the message has it (`EMAIL_COPY_CONDITIONAL_FACTS`),
 * and what follows that sentence goes with it (§359).
 *
 * So the sentence the platform tacks on only when there is a hold's deadline, a desk code or a
 * number — "Dacă se formează lista de așteptare, locul îți este ținut până la …", "…sau spunând
 * codul …", "Numărul de concurs: …" — is a paragraph that a saved text drops by itself when the
 * fact is missing (`onlyMissingFacts`). A paragraph that already opens with such a sentence stays
 * whole — "Numărul tău de concurs: …. Îl primești la masă…" goes as one, as the platform drops it
 * as one — and a paragraph with none is returned exactly as it was.
 *
 * Two things a text saved unchanged does differently from the platform, both pinned by
 * `tests/unit/notifications/email-copy-prefill.test.ts`: where the platform joined such a sentence
 * to the one before it, the club's text has a paragraph break; and where the platform drops only a
 * clause — "Îl ridici la masă în ziua cursei, cu codul …" loses its code on the club's copy — the
 * club's text drops the sentence the clause is in.
 */
function ownParagraphsOf(paragraph: string): string[] {
  const sentences = paragraph.split(/(?<=[.!?])\s+/);
  const opens = sentences.map((sentence, index) => index > 0 && placeholdersIn(sentence).some((name) => EMAIL_COPY_CONDITIONAL_FACTS.has(name)));
  if (!opens.includes(true)) return [paragraph];
  const paragraphs: string[] = [];
  sentences.forEach((sentence, index) => {
    if (index === 0 || opens[index]) paragraphs.push(sentence);
    else paragraphs[paragraphs.length - 1] = `${paragraphs[paragraphs.length - 1]} ${sentence}`;
  });
  return paragraphs;
}

/** The editor's starting text for one message and language: the platform's words, with the fields. */
export function emailCopyPrefill(messageType: EmailMessageType, locale: EmailLocale): EmailCopyPrefill {
  const words = platformWords(messageType, locale, fieldsData());
  const body = emailDocFromParagraphs(words.paragraphs.flatMap(ownParagraphsOf));
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
  /**
   * The same sentence with its fields, as today's starting text has it: a blank line wherever the
   * starting text starts a paragraph (`ownParagraphsOf`), which the rewrite then splits at.
   */
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
 * the editor as characters; a sentence typed in the box carries none. And with every value the
 * sample has ever given a field (`sampleValuesEver`).
 */
function sampleSentencesOf(messageType: EmailMessageType, locale: EmailLocale): SampleSentence[] {
  const words = platformWords(messageType, locale, fieldsData());
  // Each platform text beside the same words as the starting text has them.
  const texts = new Map<string, string>([[words.subject, words.subject]]);
  for (const paragraph of words.paragraphs) {
    const own = ownParagraphsOf(paragraph);
    texts.set(paragraph, own.join("\n\n"));
    texts.set(stripMarkers(paragraph), own.map(stripMarkers).join("\n\n"));
  }
  const sentences = new Map<string, SampleSentence>();
  for (const [text, fields] of texts) {
    const names = [...new Set(placeholdersIn(text))] as EmailCopyPlaceholder[];
    if (names.length === 0) continue;
    // Every combination of the values the sample has given this sentence's fields. None for a
    // sentence with a field the sample never had (the hold's deadline, the time of signing): it was
    // never in the old starting text with a value, so there is nothing to find.
    const combinations = names.reduce<Partial<Record<EmailCopyPlaceholder, string>>[]>(
      (partial, name) => partial.flatMap((values) => sampleValuesEver(name, locale).map((value) => ({ ...values, [name]: value }))),
      [{}],
    );
    for (const values of combinations) {
      const sample = text.replace(/\{([A-Za-z0-9_]+)\}/g, (_whole, name: string) => values[name as EmailCopyPlaceholder] as string);
      if (sample === text || sentences.has(sample)) continue;
      sentences.set(sample, { sample, fields, values: names.map((name) => ({ value: values[name] as string, placeholder: name })) });
    }
  }
  // The longest first, so a sentence is replaced whole before a shorter one inside it is.
  return [...sentences.values()].sort((a, b) => b.sample.length - a.sample.length);
}

/**
 * Every value the page's sample has given a field, today's first: the start as it read before
 * §349 changed its form on the same day as this, and the inviter's former name (§359). None for
 * the two fields the sample never had.
 */
function sampleValuesEver(name: EmailCopyPlaceholder, locale: EmailLocale): string[] {
  const today = emailSampleValueOf(name, locale);
  if (today === undefined) return [];
  if (name === "eventStartsAtFormatted") return [today, ...EMAIL_SAMPLE_FORMER_WHEN[locale]];
  if (name === "inviterName") return [today, ...EMAIL_SAMPLE_FORMER_INVITER];
  return [today];
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
 * "Înlocuiește cu câmpurile" (§359): every sample value of a text rewritten to its field — the
 * platform's own sentences whole first (which is how the bib and the status are caught), then each
 * sample value wherever else it stands.
 *
 * It also undoes the other two things the old starting text did to a document saved from it: one
 * paragraph holding every paragraph is split at its blank lines, and the `**` the platform marks
 * bold with becomes bold rather than two asterisks printed in the message. And the update notice's
 * two lines the platform adds anyway are dropped. A formatted text keeps its formatting: the
 * rewrite happens inside each run, so a value somebody made bold stays bold as its field. A
 * platform sentence replaced whole comes back laid out as today's starting text lays it out, each
 * sentence a fact may be missing from in a paragraph of its own (`ownParagraphsOf`).
 */
export function replaceSampleValues(entry: EmailCopyEntry, messageType: EmailMessageType, locale: EmailLocale): EmailCopyEntry {
  const sentences = sampleSentencesOf(messageType, locale);
  const framing = framingSentencesOf(messageType, locale);
  const rewrite = (text: string) => {
    let out = text;
    for (const sentence of sentences) out = out.split(sentence.sample).join(sentence.fields);
    return replaceEmailSampleLiterals(out, messageType, locale);
  };
  // A subject is one line, whatever a sentence replaced inside it brought.
  const subject = rewrite(entry.subject).replace(/\s*\n\s*/g, " ");

  const doc = entry.body ? readEmailBody(entry.body) : null;
  if (doc) {
    const rewritten = mapEmailDocText(withoutParagraphs(splitBlankLineParagraphs(doc), framing), rewrite);
    // Split again: a sentence replaced whole may have brought its paragraph break with it.
    const body = emphasisMarkersToBold(splitBlankLineParagraphs(rewritten));
    return { subject, paragraphs: emailBodyToParagraphs(body), body };
  }
  const blankLine = /\s*\n\s*\n\s*/;
  const paragraphs = entry.paragraphs
    .flatMap((paragraph) => paragraph.split(blankLine))
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph !== "" && !framing.has(stripMarkers(paragraph)))
    .flatMap((paragraph) => rewrite(paragraph).split(blankLine));
  return { ...entry, subject, paragraphs };
}

const EMAIL_LOCALES: readonly EmailLocale[] = ["ro", "en"];

/**
 * The languages whose saved words for this message still hold a sample value — both, whichever one
 * the page is showing (§359). Every message goes out in both languages (§96), so an English text
 * holding the sample's title is read under every Romanian message too: the closed card says so on
 * either tab, naming the language, while the warning and "Înlocuiește cu câmpurile" stay with the
 * language being edited.
 */
export function sampleLanguagesOf(copy: EmailCopy, messageType: EmailMessageType): EmailLocale[] {
  return EMAIL_LOCALES.filter((locale) => {
    const entry = copyFor(copy, messageType, locale);
    return entry !== null && sampleValuesIn(entry, messageType, locale).length > 0;
  });
}
