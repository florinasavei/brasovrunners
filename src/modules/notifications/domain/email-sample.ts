import type { EmailMessageType } from "@/db/schema/email-outbox";
import { CLUB_TIME_ZONE, formatDay } from "@/i18n/dates";
import type { EmailLocale } from "@/infrastructure/email/adapter";
import { DEFAULT_DEADLINES, type Deadlines } from "@/modules/deadlines/domain/deadlines";
import { deadlineWords } from "@/modules/deadlines/domain/duration-words";
import { DomainError } from "@/shared/errors/domain-error";
import type { EmailCopyPlaceholder } from "./email-copy";
import { registrationStatusWords } from "./registration-status-words";

/**
 * The made-up runner at the made-up event every preview on `/admin/emails` is rendered with
 * (`DECISIONS.md` §91) — and, since §359, the words the club's own text may never contain. The
 * participant-message composer's preview is addressed to the same runner, and its help line names
 * her from here (§364): one sample, never a second copy of it beside this one.
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

/**
 * Until when the sample runner's place is held — Friday 2 October 2026, 18:30 in Brașov (§104).
 * Before §373 (email follow-up) the sample had none, so the declaration's preview left out the
 * sentence that names it and a `{holdExpiresAtFormatted}` the club wrote previewed as nothing.
 */
export const EMAIL_SAMPLE_HOLD_EXPIRES_AT = new Date("2026-10-02T15:30:00Z");

/** When the sample runner signed the declaration — Monday 28 September 2026, 19:42 in Brașov (§95). */
export const EMAIL_SAMPLE_SIGNED_AT = new Date("2026-09-28T16:42:00Z");

/**
 * The sample event's facts, for the facts block every affected preview draws (§NNN) — the same made-up
 * race as the title and the place above, never a value typed into the page. None of these is a field
 * of the closed set (§247): the block is the platform's, the club's words never carry it and the
 * starting text never names it, so the save has nothing of it to refuse. The place's name is the
 * sample's own (`EMAIL_SAMPLE[locale].eventLocationName`); the addresses are the page's (`/#map`,
 * `/EXAMPLE-event`), built where `APP_BASE_URL` is read (`email-copy-fields.ts`).
 */
export const EMAIL_SAMPLE_EVENT = {
  startsAt: EMAIL_SAMPLE_STARTS_AT,
  /** A race's gun time half an hour after the gathering (§71): "întâlnire la 09:00 · start la 09:30". */
  raceStartsAt: new Date("2026-10-04T06:30:00Z"),
  timezone: CLUB_TIME_ZONE,
  locationAddress: "Aleea Tiberiu Brediceanu",
  /** The programme's rows (§117), each label in both languages, as the event row stores them. */
  scheduleItems: [
    { startsAt: "2026-10-04T05:00:00.000Z", endsAt: "2026-10-04T05:50:00.000Z", label: { ro: "Ridicarea numerelor", en: "Number pickup" }, place: null },
    { startsAt: "2026-10-04T06:15:00.000Z", endsAt: null, label: { ro: "Briefing", en: "Briefing" }, place: null },
    { startsAt: "2026-10-04T06:30:00.000Z", endsAt: null, label: { ro: "Startul", en: "The start" }, place: null },
  ],
  surface: "TRAIL",
  difficulty: "MODERATE",
  distanceMeters: 12_000,
  elevationGainMeters: 450,
  headlampRequired: false,
  costType: "PAID",
  costAmount: "30 lei",
} as const;

/**
 * One of the sample's moments as a message writes it inside a sentence (§349), through the same
 * `formatDay` call the send path makes (`render.ts`, `formatInSentence`): "duminică, 4 oct. 2026,
 * 09:00", "Sunday, 4 Oct 2026, 09:00".
 */
function sampleMoment(at: Date, locale: EmailLocale): string {
  return formatDay(at, { locale, timeZone: CLUB_TIME_ZONE, style: "long", withTime: true, position: "inline" });
}

/** The sample start as a message writes it inside a sentence (§349): "duminică, 4 oct. 2026, 09:00". */
export function emailSampleWhen(locale: EmailLocale): string {
  return sampleMoment(EMAIL_SAMPLE_STARTS_AT, locale);
}

/** The four deadline fields of the closed set (§377). */
export type EmailSampleDeadlines = Pick<EmailSampleValues, "confirmationHours" | "holdMinutes" | "offerHours" | "reminderHours">;

/**
 * The club's deadlines as the four fields' values, in one language (§377) — through the branch's one
 * words helper (`deadlineWords`), which says each duration exactly as `templates.ts` fills the field
 * at send time: "48 de ore", "30 de minute", "24 de ore", "2 zile". Empty for a reminder the club
 * does not send, as the message leaves it (a paragraph with only it is then not sent).
 *
 * The sample reads the defaults, the numbers an unset "Termene" has; the page's legend reads the
 * setting in force, so its example is the one the preview above it prints (`emailFieldLegend`).
 */
export function emailSampleDeadlines(locale: EmailLocale, deadlines: Deadlines = DEFAULT_DEADLINES): EmailSampleDeadlines {
  const words = deadlineWords(locale, deadlines);
  return {
    confirmationHours: words.confirmation,
    holdMinutes: words.hold,
    offerHours: words.offer,
    reminderHours: words.reminder ?? "",
  };
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
  /** The hold's deadline and the time of signing (§104, §95), so every field of the set has a sample value (§373). */
  holdExpiresAtFormatted: string;
  signedAtFormatted: string;
  /** The club's deadlines as words (§377), from `DEFAULT_DEADLINES` (`emailSampleDeadlines`). */
  confirmationHours: string;
  holdMinutes: string;
  offerHours: string;
  reminderHours: string;
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
  /**
   * "Trimite un mesaj participanților" (§364): a sample message, written per send, so its card
   * previews one — with a placeholder in each box, as the composer on the event's page would send
   * it. The organizer's words, like the note and the reason: never the club's copy, never refused.
   */
  organizerSubject: string;
  organizerBody: string;
};

export const EMAIL_SAMPLE: Readonly<Record<EmailLocale, EmailSampleValues>> = {
  ro: {
    participantName: "Ana Popescu",
    eventTitle: "Crosul de toamnă",
    eventLocationName: "Stația de telecabină Tâmpa",
    eventStartsAtFormatted: emailSampleWhen("ro"),
    currentStatus: registrationStatusWords("CONFIRMED", "ro"),
    checkinCode: "EXAMPL",
    bibNumber: 42,
    eventChecklist: "Apă, o haină de ploaie, bună dispoziție",
    holdExpiresAtFormatted: sampleMoment(EMAIL_SAMPLE_HOLD_EXPIRES_AT, "ro"),
    signedAtFormatted: sampleMoment(EMAIL_SAMPLE_SIGNED_AT, "ro"),
    ...emailSampleDeadlines("ro"),
    staffRole: "Organizator",
    inviterName: "Ion Exemplu",
    staffEmail: "ana.popescu@example.org",
    organizerNote: "Ne vedem la intrarea dinspre Livada Poștei, lângă panoul cu harta.",
    cancellationReason: "Avertizare meteo de cod portocaliu pentru Tâmpa: traseul nu este sigur.",
    organizerSubject: "Vreme rea la {eventTitle}: startul se mută la 10:00",
    organizerBody: [
      "Salut, {participantName}!",
      "Prognoza anunță furtună până la 9:00, așa că mutăm startul la 10:00. Masa de înscrieri se deschide la 9:15, în același loc.",
      "Aduceți o haină de ploaie.",
    ].join("\n\n"),
  },
  en: {
    participantName: "Ana Popescu",
    eventTitle: "The autumn cross",
    eventLocationName: "Tâmpa cable-car station",
    eventStartsAtFormatted: emailSampleWhen("en"),
    currentStatus: registrationStatusWords("CONFIRMED", "en"),
    checkinCode: "EXAMPL",
    bibNumber: 42,
    eventChecklist: "Water, a rain jacket, good spirits",
    holdExpiresAtFormatted: sampleMoment(EMAIL_SAMPLE_HOLD_EXPIRES_AT, "en"),
    signedAtFormatted: sampleMoment(EMAIL_SAMPLE_SIGNED_AT, "en"),
    ...emailSampleDeadlines("en"),
    staffRole: "Organizator",
    inviterName: "Ion Exemplu",
    staffEmail: "ana.popescu@example.org",
    organizerNote: "We meet at the Livada Poștei entrance, by the map board.",
    cancellationReason: "An orange weather warning for Tâmpa: the route is not safe.",
    organizerSubject: "Bad weather at {eventTitle}: the start moves to 10:00",
    organizerBody: [
      "Hi, {participantName}!",
      "The forecast says storms until 9:00, so we are moving the start to 10:00. The registration desk opens at 9:15, in the same place.",
      "Bring a rain jacket.",
    ].join("\n\n"),
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

/**
 * The sample's value for a field of the closed set, in one language — every field has one since
 * §373 (email follow-up), so the preview and the legend under the editor show each of them.
 */
export function emailSampleValueOf(name: EmailCopyPlaceholder, locale: EmailLocale): string {
  const sample = EMAIL_SAMPLE[locale];
  return name === "bibNumber" ? String(sample.bibNumber) : sample[name];
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
 * text. Nor the organizer's message (§364): it is written per send, has no editor on the page, and
 * its sample holds only placeholders and ordinary words.
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
    // Every value added to the sample is one the guard refuses (the note at the top of this file).
    { value: EMAIL_SAMPLE[locale].holdExpiresAtFormatted, placeholder: "holdExpiresAtFormatted" },
    { value: EMAIL_SAMPLE[locale].signedAtFormatted, placeholder: "signedAtFormatted" },
    { value: EMAIL_SAMPLE[locale].staffRole, placeholder: "staffRole", only: ["STAFF_INVITATION"] },
    { value: EMAIL_SAMPLE[locale].inviterName, placeholder: "inviterName" },
  ]),
]);

/** The same value twice — "Ana Popescu" in both languages — is looked for once. Exact, as the match is. */
function dedupe(literals: EmailSampleLiteral[]): EmailSampleLiteral[] {
  const seen = new Set<string>();
  return literals.filter((literal) => {
    const key = literal.value.normalize("NFC");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * What a word is made of, in any script: a letter — "ă", "â", "î", "ș" and "ț" are letters (`\p{L}`)
 * — a combining mark, which is how a letter typed as a base letter plus an accent carries it
 * (`\p{M}`), a digit, or an underscore.
 */
const WORD_CHARACTER = String.raw`[\p{L}\p{M}\p{N}_]`;

/**
 * A hyphen between two word characters makes them one word: "cross-country", "Popescu-Ionescu",
 * "dându-i". An apostrophe does not — "The autumn cross's route" still names the sample's title.
 */
const HYPHEN = String.raw`[\-‐‑]`;

/**
 * The value as a whole word or phrase, on both sides, and exactly as the sample writes it (§373,
 * email follow-up; the re-review's nit: a value of several words matched whatever its case, and a
 * hyphen ended a word, so "the autumn cross-country season" was refused as the sample's title).
 *
 * - **Both sides**: not after a word character or a word character and a hyphen, not before a word
 *   character or a hyphen and a word character. "Organizatorii" is not the role, "EXAMPLE" is not
 *   the check-in code, "Ana Popescu-Ionescu" is not the sample runner, "The autumn cross-country"
 *   is not the sample's title.
 * - **Case-sensitive, every value**: what the old starting text carried is the sample's value
 *   verbatim — the templates set it in as it is, capital and all — so a case-blind match only adds
 *   ordinary prose: "ne vedem la crosul de toamnă", "the autumn cross". Decided per value in
 *   `tests/unit/notifications/email-sample-guard.test.ts`: the runner, the title, the place, the
 *   checklist, the dates, the code, the inviter and the address are refused as the sample writes
 *   them, anywhere; the role only inside the invitation (`only`); a real place written as the
 *   sample writes it ("Stația de telecabină Tâmpa") is refused too and named with its field, which
 *   is what an event held there puts in its place anyway.
 * - **Canonical Unicode**: the text and the value are compared composed (NFC), so an "ă" typed as
 *   "a" and a breve is the same letter.
 */
function patternOf(value: string): RegExp {
  const before = `(?<!${WORD_CHARACTER})(?<!${WORD_CHARACTER}${HYPHEN})`;
  const after = `(?!${WORD_CHARACTER})(?!${HYPHEN}${WORD_CHARACTER})`;
  return new RegExp(`${before}${escapeRegExp(value.normalize("NFC"))}${after}`, "gu");
}

const PATTERNS = new Map(EMAIL_SAMPLE_LITERALS.map((literal) => [literal, patternOf(literal.value)]));

function appliesTo(literal: EmailSampleLiteral, messageType: EmailMessageType): boolean {
  return !literal.only || literal.only.includes(messageType);
}

/** The sample values in one piece of text, in the order of the list above. */
export function emailSampleLiteralsIn(text: string, messageType: EmailMessageType): EmailSampleLiteral[] {
  const composed = text.normalize("NFC");
  return EMAIL_SAMPLE_LITERALS.filter((literal) => {
    if (!appliesTo(literal, messageType)) return false;
    const pattern = PATTERNS.get(literal) as RegExp;
    pattern.lastIndex = 0;
    return pattern.test(composed);
  });
}

/** What replaces a literal in a text of this language: its field, or the platform's fallback words. */
export function emailSampleReplacementOf(literal: EmailSampleLiteral, locale: EmailLocale): string {
  return literal.placeholder ? `{${literal.placeholder}}` : (literal.words?.[locale] ?? "");
}

/** Every sample value in a piece of text, rewritten to its field (§359 "Înlocuiește cu câmpurile"). */
export function replaceEmailSampleLiterals(text: string, messageType: EmailMessageType, locale: EmailLocale): string {
  // Composed, as the search is: a value found is a value replaced (`patternOf`).
  let out = text.normalize("NFC");
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
