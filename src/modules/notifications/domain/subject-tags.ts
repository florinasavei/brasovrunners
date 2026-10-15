import type { EmailMessageType } from "@/db/schema/email-outbox";
import type { EMAIL_AUDIENCE } from "./email-audience";

/**
 * The tags at the start of every email the CLUB or its STAFF receive (§NNN; amending §307, §676 and §778): fixed ASCII,
 * lowercase, never translated, so one Gmail filter on `subject:"[feedback]"` or `subject:"[girl-zone]"` files a message
 * whichever language the sender wrote in or the platform answered in. The owner, 2026-10-15: «I need better email
 * names so I can filter in Gmail.»
 *
 * **One place.** This file is the only one that knows a tag: the contact form's subject, the four forms' subjects, the
 * relay's notice and every staff-bound template build theirs from `SUBJECT_TAGS` and `tagSubject`, and the test that walks
 * the audience map fails when a type that reaches the club or a colleague has none.
 *
 * **What is never tagged.** An email to a participant, a volunteer, a subscriber or an invitee of the public keeps its
 * subject, word for word: those are the people's own messages, and a club's filter is not their business. The club's
 * copy of a participant's message keeps its own «[Copie club]» mark (§320).
 *
 * The shape, whichever environment: `[tag][tag] human words` — and on QA the environment's mark comes first and is
 * joined to the tags: `[QA][feedback][cum-a-fost] human words` (`markSubjectForEnvironment`, §307).
 *
 * The tags are not words a person reads, so they are in no `messages/*.json`, and they are stable: changing one is
 * changing every club mailbox's filter (`SETUP.md` § Filtre în Gmail).
 */
export const SUBJECT_TAGS = [
  "contact",
  "feedback",
  "cum-a-fost",
  "sugestie",
  "reclamatie",
  "girl-zone",
  "inscrieri",
  "declaratii",
  "voluntari",
  "legal",
  "livrare",
  "sistem",
  "magazin",
  "echipa",
] as const;
export type SubjectTag = (typeof SUBJECT_TAGS)[number];

/** The message types that reach the club's mailboxes or a colleague: the audiences «club» and «staff» (§670). */
type StaffBound = {
  [K in EmailMessageType]: (typeof EMAIL_AUDIENCE)[K] extends "club" | "staff" ? K : never;
}[EmailMessageType];

/**
 * The tags of each message type that reaches the club or a colleague — a `Record` over the types the audience map says
 * are the club's or the staff's, so a type added there does not compile until somebody chooses its family:
 *
 * | Tag | Family |
 * | --- | --- |
 * | `[contact]` | «Scrie-ne»: a visitor's message through the contact form (§149) |
 * | `[feedback]` + the form | «Spune-ne ceva»: `[cum-a-fost]`, `[sugestie]`, `[reclamatie]`, `[girl-zone]` (`FEEDBACK_FORM_TAGS`) |
 * | `[inscrieri]` | the registrations notice: «somebody has confirmed» (§245) |
 * | `[declaratii]` | the archive copy of a signed declaration (§99, §393) |
 * | `[voluntari]` | the organizers' notice of a volunteer's sign-up (§754) |
 * | `[legal]` | the Administrators' digest of moved legal templates (§639, §775) |
 * | `[livrare]` | the platform's notice about the email roads: a road is down, a message could not be delivered (§778) |
 * | `[sistem]` | the platform's alerts: the database unreachable and back (§657) |
 * | `[magazin]` | the members' shop: an order placed, paid, the club's notice (§683) |
 * | `[echipa]` | a colleague's or a member's invitation to the backoffice or the members' zone (§141, §524) |
 *
 * `FEEDBACK_MESSAGE`'s entry is the family alone; the form's own tag follows it (`feedbackTags`).
 */
export const SUBJECT_TAGS_OF: Readonly<Record<StaffBound, readonly SubjectTag[]>> = {
  CONTACT_MESSAGE: ["contact"],
  FEEDBACK_MESSAGE: ["feedback"],
  RELAY_NOTICE: ["livrare"],
  CLUB_CONFIRMATION_NOTICE: ["inscrieri"],
  DECLARATION_ARCHIVE: ["declaratii"],
  GROUP_RUN_DECLARATION_ARCHIVE: ["declaratii"],
  VOLUNTEER_CLUB_NOTICE: ["voluntari"],
  LEGAL_TEMPLATES_CHANGED: ["legal"],
  UNREACHABLE_WINDOW_OPENED: ["sistem"],
  UNREACHABLE_WINDOW_CLOSED: ["sistem"],
  SHOP_ORDER_PLACED: ["magazin"],
  SHOP_ORDER_PAID: ["magazin"],
  SHOP_ORDER_CLUB_NOTICE: ["magazin"],
  STAFF_INVITATION: ["echipa"],
  MEMBER_INVITATION: ["echipa"],
};

/**
 * The four «Spune-ne ceva» forms' own tag, keyed by the branch (`FeedbackBranch`, §676). Stable on its own: the address
 * bar's slug (`BRANCH_SLUG`) moved once already (`siguranta` → `girl-zone`, §772), a filter must not.
 */
export const FEEDBACK_FORM_TAGS = {
  howItWent: "cum-a-fost",
  suggestion: "sugestie",
  complaint: "reclamatie",
  safety: "girl-zone",
} as const satisfies Record<string, SubjectTag>;
export type FeedbackFormKey = keyof typeof FEEDBACK_FORM_TAGS;

/**
 * The tags of one «Spune-ne ceva» message: `[feedback]` and its form's. A message that goes to Girl Zone's person
 * instead of the club — whichever form wrote it (§678) — carries `[girl-zone]`, the confidential route's tag, and not
 * its form's: the subject there is neutral on purpose, and the form is named in the body only. So the one filter that
 * must never forward (`SETUP.md` § Filtre în Gmail) holds every message that reached her.
 */
export function feedbackTags(form: FeedbackFormKey, toPerson = false): readonly SubjectTag[] {
  return [...SUBJECT_TAGS_OF.FEEDBACK_MESSAGE, FEEDBACK_FORM_TAGS[toPerson ? "safety" : form]];
}

/** The tags of a staff-bound message type, or none for any other: a participant's mail keeps its subject. */
export function tagsOfMessageType(messageType: EmailMessageType): readonly SubjectTag[] {
  return Object.prototype.hasOwnProperty.call(SUBJECT_TAGS_OF, messageType) ? SUBJECT_TAGS_OF[messageType as StaffBound] : [];
}

/** `[a][b]`, no spaces; empty for no tags. */
export function tagPrefix(tags: readonly SubjectTag[]): string {
  return tags.map((tag) => `[${tag}]`).join("");
}

/** The subject of a message for the club: the tags, one space, the human words. */
export function tagSubject(tags: readonly SubjectTag[], humanSubject: string): string {
  return tags.length === 0 ? humanSubject : `${tagPrefix(tags)} ${humanSubject}`;
}

/** A subject that starts with a tag (`[feedback]…`): lowercase ASCII in brackets — never «[QA]» or «[Copie club]». */
const STARTS_WITH_TAG = /^\[[a-z0-9-]+\]/;
const LEAD = /^(?:\[QA\])?(?:\[[a-z0-9-]+\])*/;

export function startsWithTag(subject: string): boolean {
  return STARTS_WITH_TAG.test(subject);
}

/**
 * A mark in the subject's lead: after the environment's mark and the tags, before the human words — the tags stay the
 * line a filter reads first. «[contact] Mesaj…» + «[posibil spam]» → «[contact][posibil spam] Mesaj…».
 */
export function markAfterTags(subject: string, mark: string): string {
  const lead = LEAD.exec(subject)?.[0] ?? "";
  return `${lead}${mark}${subject.slice(lead.length)}`;
}
