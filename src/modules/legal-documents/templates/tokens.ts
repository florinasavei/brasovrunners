import { CLUB_TIME_ZONE, formatDay } from "@/i18n/dates";
import { DEFAULT_DEADLINES } from "@/modules/deadlines/domain/deadlines";
import { teamPageClause } from "@/modules/content/team/notice-words";
import { listStatesClause } from "@/modules/registrations/list-state-words";
import { listSocialsClause } from "@/modules/registrations/list-socials-words";
import { yearsPhrase } from "@/modules/registrations/domain/age";
import {
  DEADLINE_MERGE_FIELDS,
  deadlineMergeValues,
  LIST_SOCIALS_MERGE_FIELD,
  LIST_STATES_MERGE_FIELD,
  MINIMUM_AGE_MERGE_FIELD,
  NEWSLETTER_MERGE_FIELD,
  TEAM_PAGE_MERGE_FIELD,
} from "../domain/merge-fields";
import { seriesRhythmPhrase } from "@/modules/group-run-declarations/series";
import { newsletterMergeValues } from "@/modules/newsletter/topic-words";

/**
 * The legal texts' merge fields, one list for the legend (§190). Each is filled when shown or
 * signed, unlike the club facts written in beforehand (`club-facts.ts`, §132). Keep it in step
 * with the substitution in `signed-declaration.ts`. Examples are per language (§97), for a made-up
 * event, never the club (§357, §369), with dates from the real helper (§349).
 */
export type TokenLocale = "ro" | "en";

export type DeclarationToken = {
  /** Braces included. */
  token: string;
  /** Under `Admin.legal.tokens`. */
  messageKey: string;
  example: Readonly<Record<TokenLocale, string>>;
};

/** Saturday 21 November 2026, 10:00 in Brașov. */
export const TOKEN_EXAMPLE_EVENT_STARTS_AT = new Date("2026-11-21T08:00:00Z");
export const TOKEN_EXAMPLE_SIGNED_AT = new Date("2026-09-20T16:42:00Z");
/** The made-up weekly run's dates (§523): three Tuesdays at 18:30 in Brașov. */
const TOKEN_EXAMPLE_SERIES_DATES = ["2026-10-06", "2026-10-13", "2026-10-20"].map((day) => ({ startsAt: new Date(`${day}T15:30:00Z`) }));

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
  // §329, §440: an event with none leaves its sentence out.
  {
    token: `{{${MINIMUM_AGE_MERGE_FIELD}}}`,
    messageKey: MINIMUM_AGE_MERGE_FIELD,
    example: inBoth((locale) => yearsPhrase(16, locale)),
  },
  // §523, from the dates §113 groups; "" on a one-off run, which keeps the one-off sentence.
  { token: "{{series}}", messageKey: "series", example: { ro: "Tura de marți", en: "The Tuesday loop" } },
  {
    token: "{{seriesRhythm}}",
    messageKey: "seriesRhythm",
    example: inBoth((locale) => seriesRhythmPhrase(TOKEN_EXAMPLE_SERIES_DATES, CLUB_TIME_ZONE, locale)),
  },
  { token: "{{seriesPlace}}", messageKey: "seriesPlace", example: same("Parcul Nicolae Titulescu") },
  // The deadlines (§377, §421), filled from "Termene"; the examples are the defaults (§369).
  ...DEADLINE_MERGE_FIELDS.map((field) => ({
    token: `{{${field}}}`,
    messageKey: field,
    example: inBoth((locale) => deadlineMergeValues(locale, DEFAULT_DEADLINES)[field]),
  })),
  // The notice's marker for the list's states (§396); also the switch (`describesListStates`).
  {
    token: `{{${LIST_STATES_MERGE_FIELD}}}`,
    messageKey: LIST_STATES_MERGE_FIELD,
    example: inBoth((locale) => listStatesClause(locale)),
  },
  // The notice's marker for the list's socials (§500); also the switch (`describesListSocials`).
  {
    token: `{{${LIST_SOCIALS_MERGE_FIELD}}}`,
    messageKey: LIST_SOCIALS_MERGE_FIELD,
    example: inBoth((locale) => listSocialsClause(locale)),
  },
  // The notice's marker for the newsletter (§445); also the switch (`describesNewsletter`).
  {
    token: `{{${NEWSLETTER_MERGE_FIELD}}}`,
    messageKey: NEWSLETTER_MERGE_FIELD,
    example: inBoth((locale) => newsletterMergeValues(locale).newsletterTopics),
  },
  // The notice's marker for «Echipa» (§459), read by `/admin/tasks`.
  {
    token: `{{${TEAM_PAGE_MERGE_FIELD}}}`,
    messageKey: TEAM_PAGE_MERGE_FIELD,
    example: inBoth((locale) => teamPageClause(locale)),
  },
];

/** The tokens a body already uses. */
export function tokensUsedIn(text: string): Set<string> {
  return new Set(DECLARATION_TOKENS.filter((entry) => text.includes(entry.token)).map((entry) => entry.token));
}
