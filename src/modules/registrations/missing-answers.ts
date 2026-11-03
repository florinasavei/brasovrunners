import type { RegistrationSource } from "@/db/schema/registrations";
import { isMinorOn } from "./domain/age";
import { EDITABLE_ANSWERS, type EditableAnswer } from "./answers";
import { anotherPersonSubmissionSchema, registrationSubmissionSchema } from "./fields";
import { REGISTRATION_FORM_FIELDS } from "./form-errors";
import { asksShirt } from "./form-view";

/**
 * «Completează-ți datele» (§905; the owner, 2026-11-03: «am avut un bug când am trimis oferta că oamenii
 * nu aveau unde să își completeze datele lor, nume, data nașterii, etc.»): the answers the public
 * registration form requires that a registration does not hold — a staff entry's (`staffRegistrationSubmissionSchema`
 * relaxes the birth date, the sex, the citizenship, the city, the telephone and the emergency contact), a line of
 * the internal list moved onto the official one (a name and an address, §888), or an older row written before an
 * answer became required (§432, §467).
 *
 * **One list, and it is the form's.** Which answers are required is read off the public form's own schema
 * (`registrationSubmissionSchema`): an answer whose rule refuses absence. Never a second list typed here, so an
 * answer made required or optional on the form is asked, or no longer asked, here the same day. Two readings
 * of that one schema, and nothing invented:
 * - **the door the row came in by.** A row of the public form (`source = PUBLIC`) met its door's schema: an
 *   answer only another public door may leave blank — another person on a family's address, whose own telephone
 *   and sex `anotherPersonSubmissionSchema` relaxes (§389, §554) — is not owed again. A staff row owes everything
 *   the person's own form would have asked of them;
 * - **an answer the form always gives when it draws the box** — a select with a default: the T-shirt's size,
 *   «Fără tricou» included — is owed only on an event that asks it (`asksShirt`, the form's own test) and only
 *   when the row holds none at all. «Fără tricou» is an answer.
 *
 * The guardian is the form's cross-field rule (§108, `answers.ts`): owed when the birth date makes the person a
 * minor on the day the row was written, and only then.
 *
 * What is never here: the address (the registration's identity), the consents and the declaration's statements —
 * the person's to give, at the moments they are asked (`answers.ts#LOCKED_ANSWER_KINDS`); the optional answers
 * (a club, the socials, the list's name), which the form lets anybody leave empty.
 */
export type MissingAnswer = EditableAnswer;

/** The form's own order (`REGISTRATION_FORM_FIELDS`), so a page asks them in the order the form does. */
const FORM_ORDER: readonly EditableAnswer[] = REGISTRATION_FORM_FIELDS.filter((field): field is (typeof REGISTRATION_FORM_FIELDS)[number] & EditableAnswer =>
  (EDITABLE_ANSWERS as readonly string[]).includes(field),
);

type Rule = { safeParse(value: unknown): { success: boolean; data?: unknown } };

/** The answers a schema refuses to go without — read off its rules, never listed by hand. */
function requiredOn(shape: Readonly<Record<string, Rule>>): ReadonlySet<EditableAnswer> {
  return new Set(EDITABLE_ANSWERS.filter((field) => field in shape && !shape[field].safeParse(undefined).success));
}

/** What the public form asks of the person filling it in for themselves. */
const REQUIRED_ON_THE_FORM = requiredOn(registrationSubmissionSchema.shape as unknown as Record<string, Rule>);
/** …and of everybody the public form takes, another person on a family's address included (§389). */
const REQUIRED_ON_EVERY_PUBLIC_DOOR: ReadonlySet<EditableAnswer> = (() => {
  const family = requiredOn(anotherPersonSubmissionSchema.shape as unknown as Record<string, Rule>);
  return new Set([...REQUIRED_ON_THE_FORM].filter((field) => family.has(field)));
})();

/**
 * The answers the form always gives when it draws them: a rule that turns absence into a value (the T-shirt's
 * «Fără tricou», the member tick's no). Absent on a row, such an answer was never asked.
 */
const ALWAYS_ANSWERED: ReadonlySet<EditableAnswer> = new Set(
  EDITABLE_ANSWERS.filter((field) => {
    const parsed = (registrationSubmissionSchema.shape as unknown as Record<string, Rule>)[field]?.safeParse(undefined);
    return parsed?.success === true && parsed.data !== undefined;
  }),
);

/** The event's settings the form draws its boxes from — only what decides whether an answer is asked. */
export type FormAsks = { kitShirt?: boolean | null };

/**
 * A registration's answers as a reader holds them: the value, or — where the reader may not hold the value
 * (the backoffice's lists never read the telephone or the emergency contact, §322) — `HELD` for "there is one".
 */
export type AnswersOnRow = Partial<Record<EditableAnswer, string | boolean | null>> & {
  source: RegistrationSource;
  /** When the answers were written (§654): the day a minor's guardian is owed against, as the form judged it. */
  answersWrittenAt: Date;
};

/**
 * The marker a refusal carries beside the answers still left empty — the signature refused while any is
 * (`service.ts#signDeclaration`), or a completion that left one blank — so the page says «complete these».
 * Not a field: the page's parser drops it from the boxes it marks.
 */
export const ANSWERS_MISSING = "answersMissing";

/** The anchor the boxes are reached by — from the declaration's lead line and from a refusal's redirect. */
export const COMPLETE_ANSWERS_ID = "complete-details";

/**
 * The hidden field that says the page drew the boxes: only then does an action read the answers and hand them
 * to the service, so a complete registration's signature is exactly what it was.
 */
export const ANSWERS_ASKED_FIELD = "answersAsked";

/**
 * The answers a refused press typed, kept for the page it lands on (§142): each box's name, and the country
 * half of the two telephones (`PhoneField`'s `<name>Country`).
 */
export const ANSWER_DRAFT_FIELDS: readonly string[] = [...EDITABLE_ANSWERS, "phoneCountry", "emergencyContactPhoneCountry"];

/** The stand-in for an answer a reader knows is there without reading it (`answerHeldSql`). */
export const HELD = "held";

/** Whether the row holds an answer: a tick is always one; a text is one when it is not blank. */
function holds(value: string | boolean | null | undefined): boolean {
  if (typeof value === "boolean") return true;
  return typeof value === "string" && value.trim() !== "";
}

/** Whether this event's form draws the box at all: the T-shirt only where the event gives one. */
function asked(field: EditableAnswer, event: FormAsks): boolean {
  if (field === "tshirtSize") return asksShirt(event);
  return true;
}

/**
 * The answers the public form requires of this person that the registration does not hold, in the form's
 * order — empty for every registration the public form wrote under the rules in force. Pure: the event's
 * settings and the row, nothing read.
 */
export function missingAnswers(event: FormAsks, registration: AnswersOnRow): MissingAnswer[] {
  const required = registration.source === "PUBLIC" ? REQUIRED_ON_EVERY_PUBLIC_DOOR : REQUIRED_ON_THE_FORM;
  const missing = new Set<MissingAnswer>();
  for (const field of FORM_ORDER) {
    if (!asked(field, event)) continue;
    if (!required.has(field) && !ALWAYS_ANSWERED.has(field)) continue;
    if (!holds(registration[field])) missing.add(field);
  }
  // A minor is registered by a parent or guardian (§108), judged on the day the row was written, as the form did.
  const birthDate = registration.birthDate;
  if (typeof birthDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(birthDate) && isMinorOn(birthDate, registration.answersWrittenAt) && !holds(registration.guardianName)) {
    missing.add("guardianName");
  }
  return FORM_ORDER.filter((field) => missing.has(field));
}

/**
 * The backoffice's reading (§322): the telephone and the emergency contact only as held or not — the lists never
 * read either — and whether the event asks the T-shirt, off the row's own query.
 */
export type HeldReading = Omit<AnswersOnRow, "phone" | "emergencyContactName" | "emergencyContactPhone"> & {
  eventKitShirt: boolean;
  phoneHeld: boolean;
  emergencyContactNameHeld: boolean;
  emergencyContactPhoneHeld: boolean;
};

/** «Date lipsă» on the backoffice's row and page: the same rule, read from what the backoffice holds. */
export function missingAnswersHeld(row: HeldReading): MissingAnswer[] {
  return missingAnswers(
    { kitShirt: row.eventKitShirt },
    {
      ...row,
      phone: row.phoneHeld ? HELD : null,
      emergencyContactName: row.emergencyContactNameHeld ? HELD : null,
      emergencyContactPhone: row.emergencyContactPhoneHeld ? HELD : null,
    },
  );
}

/**
 * The boxes a person's own page draws to complete them: the missing answers, and the guardian beside a missing
 * birth date — shown by the date typed, as on the form (`GuardianForMinor`). Never the guardian under a signed
 * declaration, online or on paper: the signed text names its declarant (`answers.ts#GUARDIAN_SIGNED`), and only a
 * new declaration changes who that is.
 */
export function answersToAsk(missing: readonly MissingAnswer[], declarationSigned: boolean): { fields: MissingAnswer[]; guardianIfMinor: boolean } {
  return {
    fields: declarationSigned ? missing.filter((field) => field !== "guardianName") : [...missing],
    guardianIfMinor: missing.includes("birthDate") && !missing.includes("guardianName") && !declarationSigned,
  };
}
