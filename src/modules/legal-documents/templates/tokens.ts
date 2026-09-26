import { CLUB_TIME_ZONE, formatDay } from "@/i18n/dates";
import { DEFAULT_DEADLINES } from "@/modules/deadlines/domain/deadlines";
import { listStatesClause } from "@/modules/registrations/list-state-words";
import { yearsPhrase } from "@/modules/registrations/domain/age";
import {
  DEADLINE_MERGE_FIELDS,
  deadlineMergeValues,
  LIST_STATES_MERGE_FIELD,
  MINIMUM_AGE_MERGE_FIELD,
  NEWSLETTER_MERGE_FIELD,
} from "../domain/merge-fields";
import { newsletterMergeValues } from "@/modules/newsletter/topic-words";

/**
 * The declaration's merge fields, in one list (`DECISIONS.md` §190).
 *
 * They are **not** blanks somebody fills in while writing: each is replaced at the moment a
 * participant signs, with that person's own answer and that event's own facts, which is the
 * whole reason the declaration is one text and not one text per race. The club facts —
 * `<DENUMIREA JURIDICĂ…>` and the rest — are the opposite kind of gap and are written in from
 * the environment before the club ever reads the draft (`club-facts.ts`, §132).
 *
 * The owner asked to "select all those {{}} bindings and have them already filled in", which is
 * two wishes with one answer each: the ones that *can* be filled already are, and the ones that
 * cannot are listed on the page that writes them, with what each becomes — so a token in the
 * text reads as deliberate rather than as something the editor forgot.
 *
 * The list is here rather than in the message catalogue because it is a fact about the
 * substitution in `signed-declaration.ts`, not a translation: a token added there and not here
 * would be a token nobody is told about. `example` is what one signature actually produced, in
 * each language the declaration is written in (§97): the form writes both texts on one screen,
 * and "sâmbătă, 21 nov. 2026" is not what the English text will read.
 *
 * The example event is a made-up one, never the club's name (§357, §369): the legend sits
 * beside a text that serves every event, and an example naming the club reads as a value the
 * text may carry. The two dates are written by the helper that writes the real ones (§349).
 */
export type TokenLocale = "ro" | "en";

export type DeclarationToken = {
  /** The token as it is typed into the text, braces and all. */
  token: string;
  /** The message key under `Admin.legal.tokens` that says what it becomes. */
  messageKey: string;
  /** A real-looking value per language, so a reader sees the shape rather than a description of it. */
  example: Readonly<Record<TokenLocale, string>>;
};

/** The made-up event's start (Saturday 21 November 2026, 10:00 in Brașov) and the signature's instant. */
export const TOKEN_EXAMPLE_EVENT_STARTS_AT = new Date("2026-11-21T08:00:00Z");
export const TOKEN_EXAMPLE_SIGNED_AT = new Date("2026-09-20T16:42:00Z");

const same = (value: string): Record<TokenLocale, string> => ({ ro: value, en: value });
const inBoth = (write: (locale: TokenLocale) => string): Record<TokenLocale, string> => ({ ro: write("ro"), en: write("en") });

export const DECLARATION_TOKENS: readonly DeclarationToken[] = [
  { token: "{{participant}}", messageKey: "participant", example: same("Ana Popescu") },
  {
    token: "{{declarant}}",
    messageKey: "declarant",
    // `declarantValues` for a minor: the parent, with the relationship spelled out.
    example: {
      ro: "Mihai Popescu (părinte/tutore legal al minorului Ana Popescu)",
      en: "Mihai Popescu (parent/legal guardian of the minor Ana Popescu)",
    },
  },
  { token: "{{guardian}}", messageKey: "guardian", example: same("Mihai Popescu") },
  { token: "{{idDocument}}", messageKey: "idDocument", example: same("CI XB 123456") },
  // Each signer's own document (§330): a minor's declaration is signed by the minor and the parent.
  { token: "{{participantIdDocument}}", messageKey: "participantIdDocument", example: same("CI XB 654321") },
  { token: "{{guardianIdDocument}}", messageKey: "guardianIdDocument", example: same("CI XB 123456") },
  { token: "{{event}}", messageKey: "event", example: { ro: "Crosul de toamnă", en: "The autumn cross" } },
  {
    token: "{{eventDate}}",
    messageKey: "eventDate",
    example: inBoth((locale) =>
      formatDay(TOKEN_EXAMPLE_EVENT_STARTS_AT, { locale, timeZone: CLUB_TIME_ZONE, style: "long", position: "inline" }),
    ),
  },
  { token: "{{eventLocation}}", messageKey: "eventLocation", example: same("Parcul Nicolae Titulescu") },
  {
    token: "{{signedAt}}",
    messageKey: "signedAt",
    example: inBoth((locale) =>
      formatDay(TOKEN_EXAMPLE_SIGNED_AT, { locale, timeZone: CLUB_TIME_ZONE, style: "long", withTime: true, position: "inline" }),
    ),
  },
  // The event's own minimum age (§329, §440), with its unit; a run with none leaves its sentence out.
  {
    token: `{{${MINIMUM_AGE_MERGE_FIELD}}}`,
    messageKey: MINIMUM_AGE_MERGE_FIELD,
    example: inBoth((locale) => yearsPhrase(16, locale)),
  },
  // The club's deadlines (§377) and the public list's period after the event (§421), in any of the three texts, filled from "Termene" when the text is
  // shown — the examples are what an unset setting fills in, in the words it is filled with.
  // Each language's example in its own words, as the text in that language is filled (§369).
  ...DEADLINE_MERGE_FIELDS.map((field) => ({
    token: `{{${field}}}`,
    messageKey: field,
    example: inBoth((locale) => deadlineMergeValues(locale, DEFAULT_DEADLINES)[field]),
  })),
  // The privacy notice's marker for the public list's states (§396): filled with the three words
  // the list prints, and the switch that lets the list print them (`describesListStates`).
  {
    token: `{{${LIST_STATES_MERGE_FIELD}}}`,
    messageKey: LIST_STATES_MERGE_FIELD,
    example: inBoth((locale) => listStatesClause(locale)),
  },
  // The privacy notice's marker for the newsletter (§445): filled with the pop-up's topics, and the
  // switch that lets the contact page offer it (`describesNewsletter`).
  {
    token: `{{${NEWSLETTER_MERGE_FIELD}}}`,
    messageKey: NEWSLETTER_MERGE_FIELD,
    example: inBoth((locale) => newsletterMergeValues(locale).newsletterTopics),
  },
];

/** Which tokens a body already uses — what the legend marks as "in this text". */
export function tokensUsedIn(text: string): Set<string> {
  return new Set(DECLARATION_TOKENS.filter((entry) => text.includes(entry.token)).map((entry) => entry.token));
}
