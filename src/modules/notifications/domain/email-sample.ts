import type { EmailMessageType } from "@/db/schema/email-outbox";
import { CLUB_TIME_ZONE, formatDay } from "@/i18n/dates";
import type { EmailLocale } from "@/infrastructure/email/adapter";
import { DomainError } from "@/shared/errors/domain-error";
import type { EmailCopyPlaceholder } from "./email-copy";

/**
 * The made-up runner at the made-up event every preview on `/admin/emails` is rendered with
 * (`DECISIONS.md` §91) — and, since §359, the words the club's own text may never contain.
 *
 * ## Why the sample and the guard read one constant
 *
 * The editor under each preview used to start from the preview itself: the platform's words
 * rendered **with this sample**, so the text a Redactor was handed read "Ai început înscrierea la
 * Crosul de toamnă" rather than "…la {eventTitle}". Saving it unchanged stored the sample's title as
 * literal words, and every participant would then have read "Crosul de toamnă" whatever their event
 * (the owner, 2026-09-24, with a screenshot of exactly that). The editor now starts from the
 * platform's words with the fields in them, and the save refuses a text that still carries a value
 * from here. The page renders its preview from this object and the guard looks for these values,
 * so the two cannot drift: a value added to the sample is a value the guard refuses.
 */

/** The sample event's start — Sunday 4 October 2026, 09:00 in Brașov. */
export const EMAIL_SAMPLE_STARTS_AT = new Date("2026-10-04T06:00:00Z");

/** The sample start as a message writes it inside a sentence (§349): "duminică, 4 oct. 2026, 09:00". */
export function emailSampleWhen(locale: EmailLocale): string {
  return formatDay(EMAIL_SAMPLE_STARTS_AT, { locale, timeZone: CLUB_TIME_ZONE, style: "long", withTime: true, position: "inline" });
}

export type EmailSampleValues = {
  participantName: string;
  eventTitle: string;
  eventLocationName: string;
  eventStartsAtFormatted: string;
  currentStatus: string;
  checkinCode: string;
  bibNumber: number;
  eventChecklist: string;
  /**
   * The staff invitation (§141): a made-up colleague, added by a made-up administrator — a name
   * nobody at the club has, so it is refused in every message, as the runner's is (§359).
   */
  staffRole: string;
  inviterName: string;
  staffEmail: string;
  /** "Detalii actualizate" and "Eveniment anulat" (§331) — the organizer's words, never the club's copy. */
  organizerNote: string;
  cancellationReason: string;
};

export const EMAIL_SAMPLE: Readonly<Record<EmailLocale, EmailSampleValues>> = {
  ro: {
    participantName: "Ana Popescu",
    eventTitle: "Crosul de toamnă",
    eventLocationName: "Stația de telecabină Tâmpa",
    eventStartsAtFormatted: emailSampleWhen("ro"),
    currentStatus: "confirmată",
    checkinCode: "EXAMPL",
    bibNumber: 42,
    eventChecklist: "Apă, o haină de ploaie, bună dispoziție",
    staffRole: "Organizator",
    inviterName: "Ion Exemplu",
    staffEmail: "ana.popescu@example.org",
    organizerNote: "Ne vedem la intrarea dinspre Livada Poștei, lângă panoul cu harta.",
    cancellationReason: "Avertizare meteo de cod portocaliu pentru Tâmpa: traseul nu este sigur.",
  },
  en: {
    participantName: "Ana Popescu",
    eventTitle: "The autumn cross",
    eventLocationName: "Tâmpa cable-car station",
    eventStartsAtFormatted: emailSampleWhen("en"),
    currentStatus: "confirmed",
    checkinCode: "EXAMPL",
    bibNumber: 42,
    eventChecklist: "Water, a rain jacket, good spirits",
    staffRole: "Organizator",
    inviterName: "Ion Exemplu",
    staffEmail: "ana.popescu@example.org",
    organizerNote: "We meet at the Livada Poștei entrance, by the map board.",
    cancellationReason: "An orange weather warning for Tâmpa: the route is not safe.",
  },
};

/**
 * How the sample's start read before §349 gave every date its weekday's comma and a short month.
 * A text saved from the editor between §247 and §349 carries this form, not today's.
 */
export const EMAIL_SAMPLE_FORMER_WHEN: Readonly<Record<EmailLocale, readonly string[]>> = {
  ro: ["duminică, 4 octombrie 2026, 09:00"],
  en: ["Sunday, 4 October 2026, 09:00"],
};

/**
 * The sample inviter before §359: "Florin", which is also a real first name at the club — a text
 * the club signs "Florin" is its own. So it is not refused as a word: it is looked for only inside
 * the platform's own invitation sentence, where a text saved from the old editor still carries it
 * (`email-copy-fields.ts`), exactly as the bib and the status are.
 */
export const EMAIL_SAMPLE_FORMER_INVITER: readonly string[] = ["Florin"];

/** The sample's value for a field of the closed set, in one language, or `undefined` for the two the sample has none of. */
export function emailSampleValueOf(name: EmailCopyPlaceholder, locale: EmailLocale): string | undefined {
  const sample = EMAIL_SAMPLE[locale];
  switch (name) {
    case "bibNumber":
      return String(sample.bibNumber);
    case "holdExpiresAtFormatted":
    case "signedAtFormatted":
      return undefined;
    default:
      return sample[name];
  }
}

/**
 * One sample value the club's words may not carry, and what goes in its place.
 *
 * `placeholder` for every value that is a field of the closed set (§247). The sample colleague's
 * address is the one value with no field — `{staffEmail}` is not in the set — so its place is taken
 * by the words the platform's own sentence falls back to ("Intri cu adresa aceasta"), which are
 * true: the invitation is sent to that very address.
 */
export type EmailSampleLiteral = {
  value: string;
  placeholder?: EmailCopyPlaceholder;
  words?: Readonly<Record<EmailLocale, string>>;
  /**
   * Only in these messages. The sample colleague's role is an ordinary word — it is the platform's
   * own label for the role, and a club may well write "Organizator" in a sentence of its own — so it
   * is a sample value only in the one message whose platform text names it.
   */
  only?: readonly EmailMessageType[];
};

const EVERY_LOCALE: readonly EmailLocale[] = ["ro", "en"];

/**
 * Every value the guard looks for, in both languages — a Romanian text holding the English
 * sample's title is as wrong as one holding the Romanian.
 *
 * Not here, on purpose: the bib (42) and the status ("confirmată", "confirmed"), which are too
 * ordinary to refuse on their own — "42 de kilometri" is a sentence a running club writes. They
 * are found where the platform's own sentence carried them (`email-copy-fields.ts`), and so is the
 * inviter's former name (`EMAIL_SAMPLE_FORMER_INVITER`). Nor the organizer's note and the
 * cancellation reason: they are the platform's lines around the words, never part of the editor's
 * text.
 */
export const EMAIL_SAMPLE_LITERALS: readonly EmailSampleLiteral[] = dedupe([
  // The address first: its local part is the sample name, and it must be replaced whole.
  { value: EMAIL_SAMPLE.ro.staffEmail, words: { ro: "aceasta", en: "this address" } },
  ...EVERY_LOCALE.flatMap((locale): EmailSampleLiteral[] => [
    { value: EMAIL_SAMPLE[locale].participantName, placeholder: "participantName" },
    { value: EMAIL_SAMPLE[locale].eventTitle, placeholder: "eventTitle" },
    { value: EMAIL_SAMPLE[locale].eventLocationName, placeholder: "eventLocationName" },
    { value: EMAIL_SAMPLE[locale].eventStartsAtFormatted, placeholder: "eventStartsAtFormatted" },
    ...EMAIL_SAMPLE_FORMER_WHEN[locale].map((value): EmailSampleLiteral => ({ value, placeholder: "eventStartsAtFormatted" })),
    { value: EMAIL_SAMPLE[locale].checkinCode, placeholder: "checkinCode" },
    { value: EMAIL_SAMPLE[locale].eventChecklist, placeholder: "eventChecklist" },
    { value: EMAIL_SAMPLE[locale].staffRole, placeholder: "staffRole", only: ["STAFF_INVITATION"] },
    { value: EMAIL_SAMPLE[locale].inviterName, placeholder: "inviterName" },
  ]),
]);

function dedupe(literals: EmailSampleLiteral[]): EmailSampleLiteral[] {
  const seen = new Set<string>();
  return literals.filter((literal) => {
    const key = literal.value.toLocaleLowerCase("ro-RO");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * The value as a whole word: not inside a longer one ("Organizatorii" is not the role, "EXAMPLE" is
 * not the check-in code). A value of several words is matched whatever its case, since a sentence
 * may start with it; a single word keeps its case, so "exemplu" and "example" are never the code.
 */
function patternOf(value: string): RegExp {
  const flags = /\s/.test(value) ? "giu" : "gu";
  return new RegExp(`(?<![\\p{L}\\p{N}_])${escapeRegExp(value)}(?![\\p{L}\\p{N}_])`, flags);
}

const PATTERNS = new Map(EMAIL_SAMPLE_LITERALS.map((literal) => [literal, patternOf(literal.value)]));

function appliesTo(literal: EmailSampleLiteral, messageType: EmailMessageType): boolean {
  return !literal.only || literal.only.includes(messageType);
}

/** The sample values in one piece of text, in the order of the list above. */
export function emailSampleLiteralsIn(text: string, messageType: EmailMessageType): EmailSampleLiteral[] {
  return EMAIL_SAMPLE_LITERALS.filter((literal) => {
    if (!appliesTo(literal, messageType)) return false;
    const pattern = PATTERNS.get(literal) as RegExp;
    pattern.lastIndex = 0;
    return pattern.test(text);
  });
}

/** What replaces a literal in a text of this language: its field, or the platform's fallback words. */
export function emailSampleReplacementOf(literal: EmailSampleLiteral, locale: EmailLocale): string {
  return literal.placeholder ? `{${literal.placeholder}}` : (literal.words?.[locale] ?? "");
}

/** Every sample value in a piece of text, rewritten to its field (§359 "Înlocuiește cu câmpurile"). */
export function replaceEmailSampleLiterals(text: string, messageType: EmailMessageType, locale: EmailLocale): string {
  let out = text;
  for (const literal of EMAIL_SAMPLE_LITERALS) {
    if (!appliesTo(literal, messageType)) continue;
    const pattern = PATTERNS.get(literal) as RegExp;
    pattern.lastIndex = 0;
    out = out.replace(pattern, emailSampleReplacementOf(literal, locale));
  }
  return out;
}

/**
 * One sample value found in a text the club wrote or is about to save: where, which, and what goes
 * in its place. `placeholder` is set when a field replaces it; otherwise `words` do.
 */
export type EmailSampleHit = {
  field: "subject" | "body";
  value: string;
  placeholder?: EmailCopyPlaceholder;
  words?: string;
};

/**
 * The save's refusal when the words still carry a sample value (§359). A `VALIDATION_ERROR` like
 * any other, naming the boxes (`subject`, `body`) as `fields`; the values found travel with it so
 * the action can say which, and with what to replace them — words the sample holds, never anything
 * a person typed about somebody.
 */
export class EmailCopySampleValueError extends DomainError {
  readonly hits: readonly EmailSampleHit[];

  constructor(hits: readonly EmailSampleHit[]) {
    super(
      "VALIDATION_ERROR",
      `the words hold sample values: ${hits.map((hit) => hit.value).join(", ")}`,
      [...new Set(hits.map((hit) => hit.field))],
    );
    this.name = "EmailCopySampleValueError";
    this.hits = hits;
  }
}
