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
  EMAIL_SAMPLE_EVENT,
  EMAIL_SAMPLE_FORMER_INVITER,
  EMAIL_SAMPLE_FORMER_WHEN,
  type EmailSampleHit,
  emailSampleDeadlines,
  emailSampleLiteralsIn,
  emailSampleReplacementOf,
  emailSampleValueOf,
  replaceEmailSampleLiterals,
} from "./domain/email-sample";
import { ORGANIZER_MESSAGE_PLACEHOLDERS } from "./domain/organizer-message";
import type { EmailEventFacts } from "./domain/event-facts";
import type { Deadlines } from "@/modules/deadlines/domain/deadlines";
import { buildTemplateContent, platformWords, type TemplateData } from "./templates";

/**
 * The club's words and the page's sample kept apart (`DECISIONS.md` §359; the owner, 2026-09-24:
 * "all emails text must include these placeholders!").
 *
 * Four things live here, all about the editor under each preview on `/admin/emails`:
 *
 * 1. **The sample the previews are rendered with** — `emailSampleData`, built from the one constant
 *    in `domain/email-sample.ts`, so the preview and the guard cannot disagree on what "a sample
 *    value" is. Since the email follow-up (§373) it has a value for every field, each half of the
 *    message reads its own language's, and a message's preview leaves out the fields that message
 *    never carries (`emailSampleFor`).
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
 * 4. **The legend under the box** — `emailFieldLegend`: every field, what this message's platform
 *    text uses first, what it never carries last (`placeholdersFilledBy`), each with the sample's
 *    value as its example (§373, email follow-up).
 */

const OTHER: Record<EmailLocale, EmailLocale> = { ro: "en", en: "ro" };

/**
 * The made-up runner at the made-up event (§91), as every preview on the page is rendered with —
 * each half of the bilingual message with its own language's sample (§373, email follow-up): the
 * English half of a Romanian preview reads "The autumn cross", its place and its checklist, as the
 * English half of a Romanian registrant's message now reads the event's English words.
 */
export function emailSampleData(locale: EmailLocale): TemplateData {
  const sample = EMAIL_SAMPLE[locale];
  const other = EMAIL_SAMPLE[OTHER[locale]];
  const base = env.APP_BASE_URL;
  return {
    participantName: sample.participantName,
    eventTitle: sample.eventTitle,
    eventTitleOther: other.eventTitle,
    eventLocationName: sample.eventLocationName,
    eventLocationNameOther: other.eventLocationName,
    // Through the one helper the send path uses (§349), so the preview cannot drift from the mail.
    eventStartsAtFormatted: sample.eventStartsAtFormatted,
    eventStartsAtFormattedOther: other.eventStartsAtFormatted,
    currentStatus: sample.currentStatus,
    currentStatusOther: other.currentStatus,
    checkinCode: sample.checkinCode,
    checkinQrUrl: `${base}/api/registrations/qr/${sample.checkinCode}.png`,
    bibNumber: sample.bibNumber,
    eventMapUrl: `${base}/#map`,
    eventChecklist: sample.eventChecklist,
    eventChecklistOther: other.eventChecklist,
    // Every field of the set has a sample value (§373): the hold's deadline and the time of signing
    // too, each half in its own words, so the declaration's preview shows the sentences that name them.
    holdExpiresAtFormatted: sample.holdExpiresAtFormatted,
    holdExpiresAtFormattedOther: other.holdExpiresAtFormatted,
    signedAtFormatted: sample.signedAtFormatted,
    signedAtFormattedOther: other.signedAtFormatted,
    replyTo: env.EMAIL_REPLY_TO ?? undefined,
    thanksUrl: `${base}/#results`,
    declarationPdfUrl: `${base}/api/registrations/declaration/EXAMPLE`,
    eventUrl: `${base}/${locale}/EXAMPLE-event`,
    eventRulesUrl: `${base}/${locale}/EXAMPLE-event#rules`,
    eventScheduleUrl: `${base}/${locale}/EXAMPLE-event#schedule`,
    // "Linkuri și fișiere" (§332): the sample event has some, so the preview shows the line.
    eventLinksUrl: `${base}/${locale}/EXAMPLE-event#links`,
    // The facts block (§NNN), each half in its own language, from the sample event — never a fact typed here.
    eventFacts: emailSampleEventFacts(locale),
    eventFactsOther: emailSampleEventFacts(OTHER[locale]),
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
    organizerNoteOther: other.organizerNote,
    cancellationReason: sample.cancellationReason,
    cancellationReasonOther: other.cancellationReason,
    // "Trimite un mesaj participanților" (§364): a sample organizer subject and body, both
    // languages, read only by its template.
    organizerSubject: sample.organizerSubject,
    organizerSubjectOther: other.organizerSubject,
    organizerBody: sample.organizerBody,
    organizerBodyOther: other.organizerBody,
  };
}

/**
 * The sample event's facts block data in one language (§NNN): `EMAIL_SAMPLE_EVENT` with the sample's
 * place in that language, and the page's sections the sample event has — a programme, rules, a route
 * description and a document under "Linkuri și fișiere" — so every row of the block shows.
 */
export function emailSampleEventFacts(locale: EmailLocale): EmailEventFacts {
  const base = env.APP_BASE_URL;
  return {
    ...EMAIL_SAMPLE_EVENT,
    scheduleItems: EMAIL_SAMPLE_EVENT.scheduleItems,
    locationToBeAnnounced: false,
    locationName: EMAIL_SAMPLE[locale].eventLocationName,
    mapUrl: `${base}/#map`,
    routeUrl: null,
    stravaEventUrl: null,
    facebookEventUrl: null,
    costUrl: null,
    pageUrl: `${base}/${locale}/EXAMPLE-event`,
    hasRules: true,
    hasSchedule: true,
    hasRouteDescription: true,
    hasOtherLinks: true,
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
 *   the text with its placeholder — the bib, the desk code, the checklist, the hold's deadline and
 *   the time of signing. **Not every send carries
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
 * - **the declaration's first wording is the club's hold's (§377)**, as the preview shows it; a
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
    // The email link's window as the club set it (§377): the link for another person on one
    // address lives exactly that long (§389), and its sentence says so through the field.
    confirmationHours: field("confirmationHours"),
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

/**
 * Messages about an address rather than a person: "registration is open" (§146), and the link for
 * another person on a registered address (§389) — it answers whoever filled the form, often a parent,
 * so it greets nobody and names no runner.
 */
const NO_PERSON: ReadonlySet<EmailMessageType> = new Set(["REGISTRATION_OPENED", "REGISTER_ANOTHER_PERSON"]);
/** Messages about no event: "my registrations" is about a person (§77), the invitation about the team (§141). */
const NO_EVENT: ReadonlySet<EmailMessageType> = new Set(["PROFILE_MANAGE_LINK", "STAFF_INVITATION"]);
/** Messages about no one registration: the two above, and "registration is open". */
const NO_REGISTRATION: ReadonlySet<EmailMessageType> = new Set(["PROFILE_MANAGE_LINK", "STAFF_INVITATION", "REGISTRATION_OPENED"]);
/** The fields only a few messages carry, and which. */
const ONLY_IN: Partial<Record<EmailCopyPlaceholder, readonly EmailMessageType[]>> = {
  bibNumber: ["REGISTRATION_CONFIRMED", "EVENT_REMINDER", "BIB_ASSIGNED", "CLUB_CONFIRMATION_NOTICE"],
  checkinCode: ["REGISTRATION_CONFIRMED", "EVENT_REMINDER", "BIB_ASSIGNED"],
  holdExpiresAtFormatted: ["COMPLETE_DECLARATION"],
  signedAtFormatted: ["REGISTRATION_CONFIRMED", "DECLARATION_SIGNED", "DECLARATION_ARCHIVE"],
  staffRole: ["STAFF_INVITATION"],
  inviterName: ["STAFF_INVITATION"],
};

/**
 * The fields a message of this type can carry when it is sent (§373, email follow-up), read off
 * `render.ts`, which is what fills them. A field outside this list is empty in every message of the
 * type, whatever the club writes: the legend under the editor dims it ("nu se completează în acest
 * mesaj") and the preview leaves it empty too (`emailSampleFor`), so neither promises what the
 * message cannot say.
 *
 * - the runner's name: every message about a person — in the invitation, the colleague's name — but
 *   not "registration is open", which goes to an address;
 * - the event's title, place, start and checklist: every message about an event;
 * - the status: every message about one registration;
 * - the number: the confirmation, the reminder, the number given by hand, the club's notice (§245);
 * - the desk code: the confirmation, the reminder and the number given by hand — never on a club
 *   copy (§320);
 * - the hold's deadline: the declaration request (§104);
 * - the time of signing: the confirmation, the signed declaration and its archive copy (§95);
 * - the role and the inviter: the staff invitation (§141).
 *
 * "Can": a number or a checklist is still missing from some sends (`EMAIL_COPY_CONDITIONAL_FACTS`).
 */
export function placeholdersFilledBy(messageType: EmailMessageType): EmailCopyPlaceholder[] {
  // The organizer's message fills its own closed set (`ORGANIZER_MESSAGE_PLACEHOLDERS`) — its
  // `{bibNumber}` is the settled number only, and it carries no `{currentStatus}` at all, which
  // the rules below would otherwise get wrong for it (§373, email follow-up).
  if (messageType === "ORGANIZER_MESSAGE") {
    const organizerSet = new Set<EmailCopyPlaceholder>(ORGANIZER_MESSAGE_PLACEHOLDERS);
    return EMAIL_COPY_PLACEHOLDERS.filter((name) => organizerSet.has(name));
  }
  return EMAIL_COPY_PLACEHOLDERS.filter((name) => {
    const only = ONLY_IN[name];
    if (only) return only.includes(messageType);
    if (name === "participantName") return !NO_PERSON.has(messageType);
    if (name === "currentStatus") return !NO_REGISTRATION.has(messageType);
    return !NO_EVENT.has(messageType);
  });
}

/** Each field's value for the bilingual message's second half, where the sample has one of its own. */
const OTHER_HALF: Partial<Record<EmailCopyPlaceholder, keyof TemplateData>> = {
  eventTitle: "eventTitleOther",
  eventLocationName: "eventLocationNameOther",
  eventStartsAtFormatted: "eventStartsAtFormattedOther",
  eventChecklist: "eventChecklistOther",
  currentStatus: "currentStatusOther",
  holdExpiresAtFormatted: "holdExpiresAtFormattedOther",
  signedAtFormatted: "signedAtFormattedOther",
};

/**
 * The sample one message's preview is rendered with (§373, email follow-up): `emailSampleData`,
 * minus every field this message never carries (`placeholdersFilledBy`) — so a `{staffRole}` the
 * club writes into a reminder previews as nothing, which is what the reminder sends. The platform's
 * own text never names such a field (a unit test holds that), so a message the club never rewrote
 * previews exactly as it did.
 */
export function emailSampleFor(messageType: EmailMessageType, locale: EmailLocale): TemplateData {
  const data: TemplateData = { ...emailSampleData(locale) };
  const filled = new Set(placeholdersFilledBy(messageType));
  for (const name of EMAIL_COPY_PLACEHOLDERS) {
    if (filled.has(name)) continue;
    if (name === "participantName") {
      // Required on the data; the send path's own empty value for "nobody" (`render.ts`).
      data.participantName = "";
      continue;
    }
    delete data[name];
    const other = OTHER_HALF[name];
    if (other) delete data[other];
  }
  return data;
}

/** One row of the legend under a message's editor (`ui/EmailFieldLegend.tsx`). */
export type EmailFieldLegendEntry = {
  name: EmailCopyPlaceholder;
  /** The platform's own text for this message names it: listed first, and marked. */
  used: boolean;
  /** This message can carry it at all (`placeholdersFilledBy`); dimmed when it cannot. */
  filled: boolean;
  /** One of the facts a send may lack (`EMAIL_COPY_CONDITIONAL_FACTS`), for a message that carries it. */
  mayBeMissing: boolean;
  /**
   * One of those facts, in a message that never carries it: not left empty like `{staffRole}` in a
   * reminder, because a paragraph naming only such facts is not sent at all (`onlyMissingFacts`).
   * The dimmed row says so, since it has no "may be missing" mark to point at the rule.
   */
  dropsParagraph: boolean;
  /** The sample's value in the language being edited — exactly what the preview above shows. */
  example: string;
};

/**
 * Every field of the closed set for one message and language, in the order the legend lists them
 * (§373, email follow-up): the ones the platform's text for this message uses first, then the rest
 * this message can carry, then the ones it never carries — each group in the closed set's order.
 */
export function emailFieldLegend(
  messageType: EmailMessageType,
  locale: EmailLocale,
  /**
   * The club's deadlines in force, which the page's preview prints (§377): the four deadline fields'
   * examples are then these, not the sample's defaults, so a row never shows "48 de ore" beside a
   * preview that says "36 de ore". Left out, the sample's (`EMAIL_SAMPLE`).
   */
  deadlines?: Deadlines,
): EmailFieldLegendEntry[] {
  const used = new Set(placeholdersUsedBy(messageType, locale));
  const filled = new Set(placeholdersFilledBy(messageType));
  const inForce: Partial<Record<EmailCopyPlaceholder, string>> = deadlines ? emailSampleDeadlines(locale, deadlines) : {};
  const rank = (entry: EmailFieldLegendEntry) => (entry.used ? 0 : entry.filled ? 1 : 2);
  return EMAIL_COPY_PLACEHOLDERS.map(
    (name): EmailFieldLegendEntry => ({
      name,
      used: used.has(name),
      filled: filled.has(name),
      mayBeMissing: filled.has(name) && EMAIL_COPY_CONDITIONAL_FACTS.has(name),
      dropsParagraph: !filled.has(name) && EMAIL_COPY_CONDITIONAL_FACTS.has(name),
      example: inForce[name] ?? emailSampleValueOf(name, locale),
    }),
  ).sort((a, b) => rank(a) - rank(b));
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
    // Every combination of the values the sample has given this sentence's fields — every field has
    // one since the email follow-up (§373), the hold's deadline and the time of signing included.
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
 * §349 changed its form on the same day as this, and the inviter's former name (§359). The hold's
 * deadline and the time of signing have one since the email follow-up (§373) — no old starting
 * text carried them, and a text written since that holds the sample's is found all the same.
 */
function sampleValuesEver(name: EmailCopyPlaceholder, locale: EmailLocale): string[] {
  const today = emailSampleValueOf(name, locale);
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
