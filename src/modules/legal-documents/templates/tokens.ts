import { CLUB_TIME_ZONE, formatDay } from "@/i18n/dates";
import { DEFAULT_DEADLINES } from "@/modules/deadlines/domain/deadlines";
import { ADDRESS_CAP_RULE } from "@/modules/registrations/domain/address-cap";
import { teamPageClause } from "@/modules/content/team/notice-words";
import { listStatesClause } from "@/modules/registrations/list-state-words";
import { listSocialsClause } from "@/modules/registrations/list-socials-words";
import { listNumbersClause } from "@/modules/registrations/list-number-words";
import { promotionalMaterialsClause, promotionalMaterialsSharedClause } from "@/modules/registrations/promo-consent-words";
import { yearsPhrase } from "@/modules/registrations/domain/age";
import {
  ADDRESS_CAP_MERGE_FIELD,
  addressCapMergeValues,
  EVENT_INVITATIONS_MERGE_FIELD,
  FEEDBACK_FORMS_MERGE_FIELD,
  FEEDBACK_FORMS_NAMED_MERGE_FIELD,
  FEEDBACK_SAFETY_GMAIL_MERGE_FIELD,
  RELAY_QUEUE_MERGE_FIELD,
  MEMBERS_SHOP_MERGE_FIELD,
  VOLUNTEERS_MERGE_FIELD,
  VOLUNTEER_AGREEMENT_NOTICE_MERGE_FIELD,
  VOLUNTEER_MINORS_NOTICE_MERGE_FIELD,
  VOLUNTEERS_LIST_NOTICE_MERGE_FIELD,
  VOLUNTEER_PROFILE_NOTICE_MERGE_FIELD,
  DEADLINE_MERGE_FIELDS,
  deadlineMergeValues,
  LIST_NUMBERS_MERGE_FIELD,
  RESULTS_MERGE_FIELD,
  RSVP_ASK_ANSWERERS_MERGE_FIELD,
  RSVP_ASK_MERGE_FIELD,
  RSVP_MERGE_FIELD,
  GMAIL_FALLBACK_MERGE_FIELD,
  GROUP_RUN_ALONE_MERGE_FIELD,
  GROUP_RUN_MINOR_AGE_MERGE_FIELD,
  GROUP_RUN_MINOR_MERGE_FIELD,
  LIST_SOCIALS_MERGE_FIELD,
  LIST_STATES_MERGE_FIELD,
  MINIMUM_AGE_MERGE_FIELD,
  NEWSLETTER_MERGE_FIELD,
  PROMOTIONAL_MATERIALS_MERGE_FIELD,
  PROMOTIONAL_MATERIALS_SHARED_MERGE_FIELD,
  TEAM_PAGE_MERGE_FIELD,
} from "../domain/merge-fields";
import { seriesRhythmPhrase } from "@/modules/group-run-declarations/series";
import { newsletterMergeValues } from "@/modules/newsletter/topic-words";
import { gmailFallbackClause } from "@/modules/notifications/fallback-notice-words";
import { eventInvitationsClause } from "@/modules/registrations/invitation-words";
import { feedbackFormsClause, feedbackFormsNamedClause, feedbackSafetyGmailClause, relayQueueClause } from "@/modules/feedback/notice-words";
import { membersShopClause } from "@/modules/content/shop/notice-words";
import { volunteerAgreementClause, volunteerMinorsClause, volunteerProfileClause, volunteersClause, volunteersListClause } from "@/modules/volunteers/notice-words";
import { resultsClause } from "@/modules/results/notice-words";
import { rsvpAskAnswerersClause, rsvpAskClause, rsvpClause } from "@/modules/rsvp/notice-words";

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
  // The event's own minimum age (§329, §440), with its unit; a run with none leaves its sentence out.
  {
    token: `{{${MINIMUM_AGE_MERGE_FIELD}}}`,
    messageKey: MINIMUM_AGE_MERGE_FIELD,
    example: inBoth((locale) => yearsPhrase(16, locale)),
  },
  // A group run's series (§523): the series sentence's name, rhythm and usual place, filled at
  // signing from the dates §113 groups; "" on a one-off run, which keeps the one-off sentence.
  { token: "{{series}}", messageKey: "series", example: { ro: "Tura de marți", en: "The Tuesday loop" } },
  {
    token: "{{seriesRhythm}}",
    messageKey: "seriesRhythm",
    // Three Tuesdays at 18:30 in Brașov, through the words a signature is filled with.
    example: inBoth((locale) => seriesRhythmPhrase(TOKEN_EXAMPLE_SERIES_DATES, CLUB_TIME_ZONE, locale)),
  },
  { token: "{{seriesPlace}}", messageKey: "seriesPlace", example: same("Parcul Nicolae Titulescu") },
  // A group run's declaration for a minor (§769): the minor's own name in the paragraph only a minor's
  // declaration keeps, and the adult's own name in the sentence only an adult's keeps.
  { token: `{{${GROUP_RUN_MINOR_MERGE_FIELD}}}`, messageKey: GROUP_RUN_MINOR_MERGE_FIELD, example: same("Ion Popescu") },
  { token: `{{${GROUP_RUN_ALONE_MERGE_FIELD}}}`, messageKey: GROUP_RUN_ALONE_MERGE_FIELD, example: same("Ana Popescu") },
  { token: `{{${GROUP_RUN_MINOR_AGE_MERGE_FIELD}}}`, messageKey: GROUP_RUN_MINOR_AGE_MERGE_FIELD, example: inBoth((locale) => yearsPhrase(14, locale)) },
  // The volunteer agreement's blanks (§758): the person, the role and what it asks, filled when the person
  // accepts; a role with no description leaves its sentence out.
  { token: "{{volunteer}}", messageKey: "volunteer", example: same("Ana Popescu") },
  { token: "{{volunteerRole}}", messageKey: "volunteerRole", example: { ro: "Punct de hidratare", en: "Water station" } },
  {
    token: "{{volunteerTasks}}",
    messageKey: "volunteerTasks",
    example: { ro: "Împarte apă la kilometrul 5 și strânge paharele", en: "Hands out water at kilometre 5 and picks up the cups" },
  },
  // The roles a person ticked while no role is given (§761), and what each asks: each sentence is left out once a
  // role is given — or, for the tasks, when no ticked role has a description.
  { token: "{{volunteerRoleChoices}}", messageKey: "volunteerRoleChoices", example: { ro: "Punct de hidratare, Sosire", en: "Water station, Finish" } },
  {
    token: "{{volunteerChoiceTasks}}",
    messageKey: "volunteerChoiceTasks",
    example: { ro: "Punct de hidratare — împarte apă la kilometrul 5; Sosire — dă medaliile", en: "Water station — hands out water at kilometre 5; Finish — hands out the medals" },
  },
  // The parent or guardian of a volunteer under eighteen (§768): their name, in the minors' clause — the clause is left out for an adult.
  { token: "{{volunteerGuardian}}", messageKey: "volunteerGuardian", example: same("Maria Popescu") },
  // The club's deadlines (§377) and the public list's period after the event (§421), in any of the three texts, filled from "Termene" when the text is
  // shown — the examples are what an unset setting fills in, in the words it is filled with.
  // Each language's example in its own words, as the text in that language is filled (§369).
  ...DEADLINE_MERGE_FIELDS.map((field) => ({
    token: `{{${field}}}`,
    messageKey: field,
    example: inBoth((locale) => deadlineMergeValues(locale, DEFAULT_DEADLINES)[field]),
  })),
  // The club's limit per address (§389, §576), in the terms' sentence about registering somebody else:
  // filled from the setting when the text is shown; the example is what an unset setting fills in.
  {
    token: `{{${ADDRESS_CAP_MERGE_FIELD}}}`,
    messageKey: ADDRESS_CAP_MERGE_FIELD,
    example: inBoth((locale) => addressCapMergeValues(locale, ADDRESS_CAP_RULE.default).registrationsPerAddress),
  },
  // The privacy notice's marker for the public list's states (§396): filled with the three words
  // the list prints, and the switch that lets the list print them (`describesListStates`).
  {
    token: `{{${LIST_STATES_MERGE_FIELD}}}`,
    messageKey: LIST_STATES_MERGE_FIELD,
    example: inBoth((locale) => listStatesClause(locale)),
  },
  // The privacy notice's marker for the socials beside a name (§500): filled with the form's own
  // tick, and the switch that lets the form offer it and the list print them (`describesListSocials`).
  {
    token: `{{${LIST_SOCIALS_MERGE_FIELD}}}`,
    messageKey: LIST_SOCIALS_MERGE_FIELD,
    example: inBoth((locale) => listSocialsClause(locale)),
  },
  // The privacy notice's marker for the race number beside a confirmed name (§613): filled with the
  // column's own words, and the switch that lets the list show its «BIB» column (`describesListNumbers`).
  {
    token: `{{${LIST_NUMBERS_MERGE_FIELD}}}`,
    messageKey: LIST_NUMBERS_MERGE_FIELD,
    example: inBoth((locale) => listNumbersClause(locale)),
  },
  // The privacy notice's marker for a race's published results (§808): filled with the public section's own name,
  // and the switch that lets an Administrator publish them and the page show them (`describesResults`).
  {
    token: `{{${RESULTS_MERGE_FIELD}}}`,
    messageKey: RESULTS_MERGE_FIELD,
    example: inBoth((locale) => resultsClause(locale)),
  },
  // The privacy notice's marker for the answer «Vin!» (§811): filled with the button's own name, and the switch that
  // lets the event page offer it and the service take it (`describesRsvp`).
  {
    token: `{{${RSVP_MERGE_FIELD}}}`,
    messageKey: RSVP_MERGE_FIELD,
    example: inBoth((locale) => rsvpClause(locale)),
  },
  // The privacy notice's marker for the day-before question (§818): filled with the newsletter topic's own name, and the switch
  // that lets the question be queued, sent and offered as a topic (`describesRsvpAsk`).
  {
    token: `{{${RSVP_ASK_MERGE_FIELD}}}`,
    messageKey: RSVP_ASK_MERGE_FIELD,
    example: inBoth((locale) => rsvpAskClause(locale)),
  },
  // The privacy notice's marker for the question's second audience (§NNN): filled with the refusal button's own name, and the switch
  // that lets the club ask the people who answered «Vin!» at an earlier date of the series (`describesRsvpAskAnswerers`).
  {
    token: `{{${RSVP_ASK_ANSWERERS_MERGE_FIELD}}}`,
    messageKey: RSVP_ASK_ANSWERERS_MERGE_FIELD,
    example: inBoth((locale) => rsvpAskAnswerersClause(locale)),
  },
  // The privacy notice's marker for the newsletter (§445): filled with the pop-up's topics, and the
  // switch that lets the contact page offer it (`describesNewsletter`).
  {
    token: `{{${NEWSLETTER_MERGE_FIELD}}}`,
    messageKey: NEWSLETTER_MERGE_FIELD,
    example: inBoth((locale) => newsletterMergeValues(locale).newsletterTopics),
  },
  // The privacy notice's marker for «Echipa» (§459): the page's name, and what `/admin/tasks` reads.
  {
    token: `{{${TEAM_PAGE_MERGE_FIELD}}}`,
    messageKey: TEAM_PAGE_MERGE_FIELD,
    example: inBoth((locale) => teamPageClause(locale)),
  },
  // The privacy notice's marker for the offers and benefits (§562): the form's own box, and the
  // switch that lets the form offer it and a person's page switch it on (`describesPromotionalMaterials`).
  {
    token: `{{${PROMOTIONAL_MATERIALS_MERGE_FIELD}}}`,
    messageKey: PROMOTIONAL_MATERIALS_MERGE_FIELD,
    // Never the club's name in the legend (§369): the sentence as the box reads, with a plain «club».
    example: inBoth((locale) => promotionalMaterialsClause(locale, locale === "en" ? "the club" : "club")),
  },
  // The privacy notice's marker for the sponsor list (§570): the three data a partner may receive,
  // and the switch for «Descarcă lista pentru sponsori» (`describesPromotionalMaterialsShared`).
  {
    token: `{{${PROMOTIONAL_MATERIALS_SHARED_MERGE_FIELD}}}`,
    messageKey: PROMOTIONAL_MATERIALS_SHARED_MERGE_FIELD,
    example: inBoth((locale) => promotionalMaterialsSharedClause(locale)),
  },
  // The privacy notice's marker for Gmail carrying while Mailgun is stopped (§622): the switch's own
  // words, and its precondition — «Gmail preia când Mailgun se oprește» acts only while it is named.
  {
    token: `{{${GMAIL_FALLBACK_MERGE_FIELD}}}`,
    messageKey: GMAIL_FALLBACK_MERGE_FIELD,
    example: inBoth((locale) => gmailFallbackClause(locale)),
  },
  // The privacy notice's marker for the invitations by email (§647): the backoffice section's name,
  // and what `/admin/tasks`' row `invitationsNotice` reads (`describesEventInvitations`).
  {
    token: `{{${EVENT_INVITATIONS_MERGE_FIELD}}}`,
    messageKey: EVENT_INVITATIONS_MERGE_FIELD,
    example: inBoth((locale) => eventInvitationsClause(locale)),
  },
  // The privacy notice's marker for «Spune-ne ceva» (§676): the forms' name, and the switch — the
  // contact page's door and the feedback page exist only while it is named (`describesFeedbackForms`).
  {
    token: `{{${FEEDBACK_FORMS_MERGE_FIELD}}}`,
    messageKey: FEEDBACK_FORMS_MERGE_FIELD,
    example: inBoth((locale) => feedbackFormsClause(locale)),
  },
  // The privacy notice's marker for «Spune-ne ceva»'s named mode (§678): the radio's words, and the
  // switch — the forms offer «Cu nume și prenume» only while it is named (`describesFeedbackFormsNamed`).
  {
    token: `{{${FEEDBACK_FORMS_NAMED_MERGE_FIELD}}}`,
    messageKey: FEEDBACK_FORMS_NAMED_MERGE_FIELD,
    example: inBoth((locale) => feedbackFormsNamedClause(locale)),
  },
  // The privacy notice's marker for Girl Zone by the club's Gmail (§772): the road's words, and the switch —
  // the road may be chosen, and a message leaves by it, only while it is named (`describesFeedbackSafetyGmail`).
  {
    token: `{{${FEEDBACK_SAFETY_GMAIL_MERGE_FIELD}}}`,
    messageKey: FEEDBACK_SAFETY_GMAIL_MERGE_FIELD,
    example: inBoth((locale) => feedbackSafetyGmailClause(locale)),
  },
  // The privacy notice's marker for the queue a visitor's message waits in (§778): how long the platform keeps it before it leaves.
  // Nothing is gated on it; `/admin/tasks` tells the club while the notice in force does not name it (`describesRelayQueue`).
  {
    token: `{{${RELAY_QUEUE_MERGE_FIELD}}}`,
    messageKey: RELAY_QUEUE_MERGE_FIELD,
    example: inBoth((locale) => relayQueueClause(locale)),
  },
  // The privacy notice's marker for the members' shop (§683): the zone section's name, and the switch —
  // the zone draws the shop, and an order is taken, only while it is named (`describesMembersShop`).
  {
    token: `{{${MEMBERS_SHOP_MERGE_FIELD}}}`,
    messageKey: MEMBERS_SHOP_MERGE_FIELD,
    example: inBoth((locale) => membersShopClause(locale)),
  },
  // The privacy notice's marker for the event volunteers (§754): the public form's name, and the switch —
  // an event page offers «Vreau să fiu voluntar», and a sign-up is kept, only while it is named (`describesVolunteers`).
  {
    token: `{{${VOLUNTEERS_MERGE_FIELD}}}`,
    messageKey: VOLUNTEERS_MERGE_FIELD,
    example: inBoth((locale) => volunteersClause(locale)),
  },
  // The privacy notice's marker for the volunteer agreement (§758): its title, and the switch — the form, the link
  // and the paper record wait, with `{{volunteers}}`, for a notice naming it (`describesVolunteerAgreement`).
  {
    token: `{{${VOLUNTEER_AGREEMENT_NOTICE_MERGE_FIELD}}}`,
    messageKey: VOLUNTEER_AGREEMENT_NOTICE_MERGE_FIELD,
    example: inBoth((locale) => volunteerAgreementClause(locale)),
  },
  // The privacy notice's marker for what a volunteer says about themselves (§765): the form's boxes, and the switch — the
  // form asks them, and keeps the answers, only while it is named (`describesVolunteerProfile`).
  {
    token: `{{${VOLUNTEER_PROFILE_NOTICE_MERGE_FIELD}}}`,
    messageKey: VOLUNTEER_PROFILE_NOTICE_MERGE_FIELD,
    example: inBoth((locale) => volunteerProfileClause(locale)),
  },
  // The privacy notice's marker for volunteers under eighteen and their guardian (§768): the guardian's boxes, and the switch —
  // a person under eighteen is taken only while it is named, with the agreement's `{{volunteerGuardian}}` (`describesVolunteerMinors`).
  {
    token: `{{${VOLUNTEER_MINORS_NOTICE_MERGE_FIELD}}}`,
    messageKey: VOLUNTEER_MINORS_NOTICE_MERGE_FIELD,
    example: inBoth((locale) => volunteerMinorsClause(locale)),
  },
  // The privacy notice's marker for the volunteers' public list (§821): the tick's own words, and the switch — the event page's card
  // «Voluntarii», the form's tick and the organizers' record of it wait for a notice naming it (`describesVolunteersList`).
  {
    token: `{{${VOLUNTEERS_LIST_NOTICE_MERGE_FIELD}}}`,
    messageKey: VOLUNTEERS_LIST_NOTICE_MERGE_FIELD,
    example: inBoth((locale) => volunteersListClause(locale)),
  },
];

/** Which tokens a body already uses — what the legend marks as "in this text". */
export function tokensUsedIn(text: string): Set<string> {
  return new Set(DECLARATION_TOKENS.filter((entry) => text.includes(entry.token)).map((entry) => entry.token));
}
