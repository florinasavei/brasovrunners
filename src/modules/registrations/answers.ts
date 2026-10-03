import type { Registration } from "@/db/schema/registrations";
import { DomainError } from "@/shared/errors/domain-error";
import { CLUB_NAME } from "@/theme/brand";
import { effectiveMinimumAge, isMinorOn, isUnderMinimumAge } from "./domain/age";
import { shirtSizeKept } from "./domain/kit";
import { registrationNameKey } from "./domain/name-key";
import { answerRules, UNDER_MINIMUM_AGE } from "./fields";
import { composeLegalName, resolveDisplayName } from "./names";
import { composePhone, splitPhone } from "./phone";

/**
 * «Modifică datele» (§645; the owner, 2026-10-02: «Nu vreau să se numească „curăță”, dar practic vreau
 * să pot modifica sau suprascrie orice dată introdusă de utilizator»): what an Administrator may
 * correct on a registration, and what stays the person's.
 *
 * **The allowlist is every answer the person typed on the form** (`fields.ts`), each met by the
 * form's own rule (`answerRules`): the two names (the name of record follows them, with §389's rule
 * and §67's audit), the start-list name, the birth date, the sex, the citizenship, the country and the
 * city, the telephone, the emergency contact, the guardian, the club and the member tick, the socials
 * and the T-shirt. A key outside it is refused by name — never ignored, so a caller learns it asked
 * for something this verb does not do.
 *
 * **Three kinds stay the person's, and the screen says why** (`LOCKED_ANSWER_KINDS`):
 * - the **address** is the registration's identity (§67, `AGENTS.md` §10.4): a wrong one is a
 *   cancellation and a new registration, never an edit;
 * - the **consents** — the health note and its consent, the public list, the socials beside the
 *   name, the offers and benefits, the results — are the person's to give; staff may only withdraw
 *   them (§322, §558), with their own button;
 * - the **declaration** and its statements — fitness, the race's conditions, the terms, the
 *   signature — are signed by the person and nobody else (`AGENTS.md` §15.11); once one is signed,
 *   the guardian it names is the declaration's too (`GUARDIAN_SIGNED`), since the signed text reads
 *   its declarant from that answer.
 * Nor is anything that is not an answer: the state, the place, the number, `kind`, the language.
 */
export const EDITABLE_ANSWERS = [
  "firstName",
  "lastName",
  "displayName",
  "birthDate",
  "sex",
  "nationality",
  "country",
  "city",
  "phone",
  "emergencyContactName",
  "emergencyContactPhone",
  "guardianName",
  "clubMemberDeclared",
  "clubName",
  "stravaUrl",
  "instagramHandle",
  "tshirtSize",
] as const satisfies readonly (keyof typeof answerRules)[];

export type EditableAnswer = (typeof EDITABLE_ANSWERS)[number];

/** What a caller may post: a string as typed (empty clears an optional answer), the tick as a boolean. */
export type AnswerChanges = Partial<Record<EditableAnswer, string | boolean | null>>;

export function isEditableAnswer(key: string): key is EditableAnswer {
  return (EDITABLE_ANSWERS as readonly string[]).includes(key);
}

/** The three things the form collected that this verb never touches, and why (the page's three lines). */
export type LockedKind = "address" | "consents" | "declaration";

/**
 * The keys a caller might plausibly post that belong to a locked kind — named in the refusal, so the
 * message says which of the three it is. Every other key outside the allowlist is refused all the same.
 */
export const LOCKED_ANSWER_KINDS: Readonly<Record<string, LockedKind>> = {
  email: "address",
  emailConfirm: "address",
  healthNotes: "consents",
  healthConsent: "consents",
  privacyAcknowledged: "consents",
  resultsNameConsent: "consents",
  listOptOut: "consents",
  listSocials: "consents",
  promoConsent: "consents",
  fitnessDeclared: "declaration",
  fitnessAcknowledged: "declaration",
  rulesAcknowledged: "declaration",
  termsAccepted: "declaration",
};

/**
 * The marker a refusal carries when nothing would change — an empty `changes`, or every value equal
 * to what the row already holds (a stale page, a colleague's save first, the sweep meeting a row
 * unticked meanwhile). Not a field: `parseInvalidFields` and the summary drop it; the action turns it
 * into its own sentence.
 */
export const ANSWERS_UNCHANGED = "answersUnchanged";

/**
 * The marker a refusal carries beside `emergencyContactPhone` when the number is the participant's
 * own — §231's `emergencySame`, the public form's word — so the page says which rule refused it
 * rather than that a real number is invalid.
 */
export const EMERGENCY_SAME = "emergencySame";

/**
 * The marker a refusal carries beside `guardianName` once the registration has a signed declaration
 * (§645): the signed text names its declarant and its second signature from the guardian
 * (`signed-declaration.ts`), so correcting or clearing the guardian would rewrite who signed it — and
 * the typed signature and the stored hash are the old text's. A wrong guardian is a new declaration.
 * Beside `birthDate` it says the other way round: a birth date that would make the signer of an
 * adult's declaration a minor, who would then need a guardian the signed text cannot gain — and, with
 * `GUARDIAN_ADULT` beside it too, a birth date that would make a signed minor's row an adult's, which
 * would then hold a guardian only a minor's row names while the signed text cannot lose them.
 */
export const GUARDIAN_SIGNED = "guardianSigned";

/**
 * The marker a refusal carries beside the socials when the row was a minor's on the day it was
 * written but the person is an adult today (§645): the minors' sweep (`jobs/retention.ts`, step
 * `minor-socials`, §323) clears the socials of every row written before the eighteenth birthday and
 * scrubs them from the trail, so a Strava link or username saved here would be gone at the next
 * maintenance run — the page says so rather than accepting a correction that silently will not last.
 */
export const MINOR_AT_REGISTRATION = "minorAtRegistration";

/**
 * The marker a refusal carries beside `guardianName` when the row would not be a minor's (§645): the
 * form keeps a guardian only for a minor on the day the row was written (`submitRegistration`), and
 * everywhere else a guardian on the row means «a minor» — the declarant the signed text names
 * (`signature-name.ts`), its second signature (§330). A guardian typed on an adult's row would change
 * who has to sign, so it is refused with its own sentence rather than kept.
 */
export const GUARDIAN_ADULT = "guardianAdult";

/** The markers a refusal carries beside its fields — never fields themselves, so the page drops them from the summary. */
export const ANSWER_MARKERS: readonly string[] = [ANSWERS_UNCHANGED, EMERGENCY_SAME, GUARDIAN_SIGNED, MINOR_AT_REGISTRATION, GUARDIAN_ADULT];

/**
 * The page's sentence for a refusal that carries a marker (`Admin.errors.*`), or null for the plain
 * «not valid» summary: which rule refused, and — where the refused box is the birth date rather than
 * the one the rule is about — a sentence naming the birth date, so the page never blames a box
 * nobody typed in (§645).
 */
export function answersRefusalCode(fields: readonly string[]): string | null {
  if (fields.includes(ANSWERS_UNCHANGED)) return "ANSWERS_UNCHANGED";
  if (fields.includes(EMERGENCY_SAME)) return "ANSWER_EMERGENCY_SAME";
  if (fields.includes(GUARDIAN_SIGNED)) {
    if (!fields.includes("birthDate")) return "ANSWER_GUARDIAN_SIGNED";
    return fields.includes(GUARDIAN_ADULT) ? "ANSWER_BIRTH_DATE_GUARDIAN_SIGNED_ADULT" : "ANSWER_BIRTH_DATE_GUARDIAN_SIGNED";
  }
  if (fields.includes(GUARDIAN_ADULT)) return "ANSWER_GUARDIAN_ADULT";
  if (fields.includes(MINOR_AT_REGISTRATION)) return fields.includes("birthDate") ? "ANSWER_BIRTH_DATE_MINOR_AT_REGISTRATION" : "ANSWER_SOCIALS_MINOR_AT_REGISTRATION";
  return null;
}

/** The answers whose old and new values the trail shows only beside the emergency details (§322). */
export const EMERGENCY_ANSWERS: ReadonlySet<string> = new Set(["phone", "emergencyContactName", "emergencyContactPhone"]);

/**
 * The answers that are the socials, and the tick that printed them (§500): when the person withdraws
 * them (`consent-withdrawal.ts`) or the minors' sweep clears them (§323), their corrected values
 * leave the trail too (`scrubCorrectedAnswerValues`) — a withdrawal the trail outlived would not be one.
 */
export const SOCIAL_ANSWERS: readonly string[] = ["stravaUrl", "instagramHandle", "listSocials"];

/**
 * «The day the row was written» (§NNN): when the form last wrote the person's answers — the insert, or
 * a restart of a cancelled or expired row, which rewrites every answer at its own instant and keeps
 * `createdAt` (`AGENTS.md` §10.5). The guardian and socials rules of a correction (§645) and the minors' sweep
 * (`jobs/retention.ts`, `minor-socials`, §323, the same fallback in SQL) read it. A row the previous
 * release wrote during the deploy has no value yet and is judged on its creation, as before.
 */
export function answersWrittenAt(row: Pick<Registration, "answersWrittenAt" | "createdAt">): Date {
  return row.answersWrittenAt ?? row.createdAt;
}

/**
 * A telephone as an Administrator types it: the international form (`+40 712 345 678`, `0040…`), or a
 * Romanian national number (`0712 345 678`) — composed into E.164 the way the form composes it
 * (`phone.ts`), or left as typed for the form's rule to refuse.
 */
export function typedPhone(typed: string): string {
  const compact = typed.replace(/[\s().\-]/g, "");
  if (compact.startsWith("+") || compact.startsWith("00")) {
    const international = `+${compact.replace(/^\+|^00/, "")}`;
    return composePhone(splitPhone(international).countryCode, international) ?? typed;
  }
  return composePhone("RO", compact) ?? typed;
}

type Value = string | boolean | null;

/** One corrected answer, as the trail keeps it: the column, before and after. */
export type CorrectedAnswer = { field: string; from: Value; to: Value };

/** The registration's columns this plan reads and may write. */
type Current = Pick<
  Registration,
  EditableAnswer | "registeredName" | "listSocials"
>;

export type AnswerPlan = {
  /** The columns to write, only the changed ones (with `nameKey` when the name of record moved). */
  set: Partial<Registration>;
  /** One entry per changed column but the name of record, in the allowlist's order. */
  corrected: CorrectedAnswer[];
  /** The name of record before and after (§67's audit row), or null when it did not move. */
  nameChange: { from: string; to: string } | null;
};

const REQUIRED: ReadonlySet<EditableAnswer> = new Set(["firstName", "lastName", "country"]);

function refuse(message: string, fields: readonly string[]): never {
  throw new DomainError("VALIDATION_ERROR", message, [...fields]);
}

/** One posted value, through the form's own rule: a string trimmed (empty is "clear it"), the tick a boolean. */
function normalized(field: EditableAnswer, raw: unknown): Value {
  if (field === "clubMemberDeclared") {
    if (typeof raw !== "boolean") refuse("the member tick is true or false", [field]);
    return raw;
  }
  if (raw === null || raw === undefined) return clearable(field);
  if (typeof raw !== "string") refuse(`${field} is typed text`, [field]);
  const trimmed = raw.trim();
  if (trimmed === "") return clearable(field);
  if (field === "tshirtSize" && trimmed === "NONE") return "NONE";
  const value = field === "phone" || field === "emergencyContactPhone" ? typedPhone(trimmed) : trimmed;
  const parsed = answerRules[field].safeParse(value);
  if (!parsed.success) refuse(`${field} is not a valid answer`, [field]);
  const data = parsed.data as unknown;
  return typeof data === "string" && data !== "" ? data : clearable(field);
}

function clearable(field: EditableAnswer): Value {
  if (REQUIRED.has(field)) refuse(`${field} cannot be left empty`, [field]);
  return field === "tshirtSize" ? "NONE" : null;
}

const same = (a: unknown, b: unknown) => (a ?? null) === (b ?? null);

/**
 * What a correction writes, decided from the row as it stands under the event's lock — pure, so every
 * rule is tested without a database. Refuses (VALIDATION_ERROR naming the key): a key outside the
 * allowlist, an invalid value, an empty change, a change that changes nothing (`ANSWERS_UNCHANGED`),
 * and the form's cross-field rules on the row as it would be — the emergency contact is somebody
 * else (§228), a minor has a guardian (§108) and only a minor has one (`GUARDIAN_ADULT`) — both judged
 * against the one day the row was written, as the form does — a minor has no socials (§323) — the
 * socials judged, as the minors' sweep judges them, against the same day (`MINOR_AT_REGISTRATION`) —
 * and the event's minimum age (§321).
 *
 * Carried with the answers, as the form carries them:
 * - the **name of record** is composed from the two names (BR-REQ-031-04 criterion 6), with its key
 *   (§389); the start-list name follows it when it was the derived one, never when the person chose it;
 * - the **member tick** writes the club's own name (§215) and, cleared, blanks the club only when it
 *   still holds that name; a club typed while the tick stays on is refused, since the tick is the club;
 * - the **socials-on-the-list** tick goes when both socials are cleared — a tick about nothing;
 * - the **T-shirt** is kept only where the event gives one (`shirtSizeKept`);
 * - the **guardian** goes when a corrected birth date makes the row an adult's on the day it was
 *   written, as the form never keeps one for an adult (§645) — audited like any other column; under a
 *   signed declaration it is the declaration's (`GUARDIAN_SIGNED`), so such a birth date is refused.
 */
export function planAnswerEdit(
  current: Current,
  changes: Readonly<Record<string, unknown>>,
  context: {
    eventDay: string;
    minAge: number | null;
    kitShirt: boolean;
    now: Date;
    /**
     * When the row's answers were written (`answersWrittenAt`, §NNN — a restart's instant, not the creation's):
     * the minors' sweep keeps no socials on a row written before the eighteenth birthday (§323).
     */
    answersWrittenAt: Date;
    /** The row has a declaration acceptance (online or paper): the guardian is the signed text's, not an answer any more. */
    declarationSigned: boolean;
  },
): AnswerPlan {
  const keys = Object.keys(changes);
  if (keys.length === 0) refuse("nothing to correct", [ANSWERS_UNCHANGED]);
  for (const key of keys) {
    if (!isEditableAnswer(key)) {
      const kind = LOCKED_ANSWER_KINDS[key];
      refuse(kind ? `${key} is the person's (${kind}) and staff never change it` : `${key} is not an answer staff may correct`, [key]);
    }
  }

  // The guardian named on a signed declaration is the declaration's (§108, §330): never corrected under it.
  if (context.declarationSigned && keys.includes("guardianName")) {
    refuse("the guardian signed the declaration and is the declaration's now", ["guardianName", GUARDIAN_SIGNED]);
  }

  const posted = new Map<EditableAnswer, Value>();
  const invalid: string[] = [];
  for (const key of keys as EditableAnswer[]) {
    try {
      posted.set(key, normalized(key, changes[key]));
    } catch (error) {
      invalid.push(key);
      if (!(error instanceof DomainError)) throw error;
    }
  }
  if (invalid.length > 0) refuse("some answers are not valid", invalid);

  const next: Record<string, Value> = {};
  for (const field of EDITABLE_ANSWERS) next[field] = (current[field] as Value) ?? null;
  for (const [field, value] of posted) next[field] = value;

  // The member tick and the club (§215).
  if (posted.has("clubMemberDeclared") || posted.has("clubName")) {
    if (next.clubMemberDeclared === true) {
      if (posted.has("clubName") && !same(posted.get("clubName"), CLUB_NAME) && !same(posted.get("clubName"), current.clubName)) {
        refuse("while the member tick is on the club is the club's own name", ["clubName"]);
      }
      next.clubName = CLUB_NAME;
    } else if (!posted.has("clubName") || same(posted.get("clubName"), current.clubName)) {
      if (current.clubName === CLUB_NAME) next.clubName = null;
    }
  }

  // The T-shirt, only where the event gives one.
  if (posted.has("tshirtSize")) next.tshirtSize = shirtSizeKept(context.kitShirt, next.tshirtSize as Registration["tshirtSize"]);

  // The two names and the name of record (§67, §389).
  const partsMoved = posted.has("firstName") || posted.has("lastName");
  if (partsMoved) {
    const missing = (["firstName", "lastName"] as const).filter((part) => !next[part]);
    if (missing.length > 0) refuse("a name is a first name and a last name", missing);
  }
  const registeredName = partsMoved
    ? composeLegalName(next.firstName as string, next.lastName as string, current.registeredName)
    : current.registeredName;
  if (registeredName.length > 200) refuse("a name is at most 200 characters", ["lastName"]);
  if (posted.has("displayName")) {
    next.displayName ??= resolveDisplayName({ firstName: next.firstName as string | null, lastName: next.lastName as string | null, legalName: registeredName });
  } else if (partsMoved) {
    const derived = resolveDisplayName({ firstName: current.firstName, lastName: current.lastName, legalName: current.registeredName });
    if (current.displayName === derived) {
      next.displayName = resolveDisplayName({ firstName: next.firstName as string, lastName: next.lastName as string, legalName: registeredName });
    }
  }

  // The form's cross-field rules, on the row as it would be.
  const minor = typeof next.birthDate === "string" && isMinorOn(next.birthDate, context.now);
  // The minors' sweep's own test (`jobs/retention.ts`, `minor-socials`): a minor on the day the row was written.
  const minorAtRegistration = typeof next.birthDate === "string" && isMinorOn(next.birthDate, context.answersWrittenAt);
  if ((posted.has("phone") || posted.has("emergencyContactPhone")) && next.phone && next.phone === next.emergencyContactPhone) {
    refuse("the emergency contact must be somebody other than the participant", ["emergencyContactPhone", EMERGENCY_SAME]);
  }
  // Only a minor has a guardian (§108): the form's own test, a minor on the day the row was written
  // (`submitRegistration`). A guardian typed on an adult's row is refused; a birth date corrected to an
  // adult's takes the guardian with it — unless a declaration names them (`GUARDIAN_SIGNED`): then the
  // guardian cannot go and cannot stay on an adult's row, so the birth date is refused, the box that moved.
  if (context.declarationSigned && posted.has("birthDate") && !minorAtRegistration && current.guardianName) {
    refuse("an adult's birth date on a declaration a guardian signed", ["birthDate", GUARDIAN_SIGNED, GUARDIAN_ADULT]);
  }
  if (!context.declarationSigned && !minorAtRegistration) {
    if (posted.has("guardianName") && posted.get("guardianName") !== null) {
      refuse("only a minor's registration names a parent or guardian", ["guardianName", GUARDIAN_ADULT]);
    }
    if (posted.has("birthDate")) next.guardianName = null;
  }
  // Owed on the same day it is allowed: the form asks a guardian of whoever was a minor when the row was
  // written, so a row written while the person was a minor keeps one though they are an adult today.
  if ((posted.has("birthDate") || posted.has("guardianName")) && minorAtRegistration && !next.guardianName) {
    // Under a signed declaration no guardian can be added (the box is the declaration's): say so on the
    // birth date, the box that moved, rather than point at the greyed guardian.
    if (context.declarationSigned) refuse("a minor's birth date on a declaration signed with no guardian", ["birthDate", GUARDIAN_SIGNED]);
    refuse("a participant under eighteen is registered by a parent or legal guardian", ["guardianName"]);
  }
  if (posted.has("birthDate") && typeof next.birthDate === "string" && isUnderMinimumAge(next.birthDate, context.eventDay, effectiveMinimumAge(context.minAge))) {
    refuse("under the event's minimum age", ["birthDate", UNDER_MINIMUM_AGE]);
  }
  if ((posted.has("birthDate") || posted.has("stravaUrl") || posted.has("instagramHandle")) && (minor || minorAtRegistration)) {
    const socials = (["stravaUrl", "instagramHandle"] as const).filter((field) => next[field]);
    // Only the birth date moved: the refusal names it, not the socials nobody typed in (§645).
    if (socials.length > 0 && !posted.has("stravaUrl") && !posted.has("instagramHandle")) {
      refuse("the corrected birth date makes the row a minor's when written, and it still holds socials", ["birthDate", MINOR_AT_REGISTRATION]);
    }
    if (socials.length > 0 && minor) refuse("the club keeps no socials of a minor", socials);
    // An adult today on a row a minor's when written: the sweep would clear them at its next run (§323).
    if (socials.length > 0) refuse("the row was a minor's when written and keeps no socials", [...socials, MINOR_AT_REGISTRATION]);
  }

  const listSocials = current.listSocials && (next.stravaUrl !== null || next.instagramHandle !== null);

  const set: Partial<Registration> = {};
  const corrected: CorrectedAnswer[] = [];
  for (const field of EDITABLE_ANSWERS) {
    if (same(next[field], current[field])) continue;
    (set as Record<string, unknown>)[field] = next[field];
    corrected.push({ field, from: (current[field] as Value) ?? null, to: next[field] });
  }
  if (listSocials !== current.listSocials) {
    set.listSocials = listSocials;
    corrected.push({ field: "listSocials", from: current.listSocials, to: listSocials });
  }
  const nameChange = registeredName !== current.registeredName ? { from: current.registeredName, to: registeredName } : null;
  if (nameChange) {
    set.registeredName = registeredName;
    set.nameKey = registrationNameKey(registeredName);
  }
  if (corrected.length === 0 && !nameChange) refuse("nothing would change", [ANSWERS_UNCHANGED]);
  return { set, corrected, nameChange };
}
