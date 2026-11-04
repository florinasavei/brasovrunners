import { eq } from "drizzle-orm";
import { declarationAcceptances } from "@/db/schema/declaration-acceptances";
import type { events } from "@/db/schema/events";
import { type Registration, registrations } from "@/db/schema/registrations";
import type { Database } from "@/db/types";
import { CLUB_TIME_ZONE } from "@/i18n/dates";
import type { Locale } from "@/i18n/routing";
import { recordAuditEvent } from "@/modules/audit/repository";
import { DomainError, isDomainError } from "@/shared/errors/domain-error";
import { isUuid } from "@/shared/ids";
import { type AnswerPlan, EDITABLE_ANSWERS, type EditableAnswer, EMERGENCY_SAME, GUARDIAN_SIGNED, planAnswerEdit } from "./answers";
import { UNDER_MINIMUM_AGE } from "./fields";
import { readBibDesign } from "./bib-design";
import { dayIn, isMinorOn } from "./domain/age";
import { registrationNameKey } from "./domain/name-key";
import { isActiveStatus } from "./domain/state-machine";
import { readRegistrationForm } from "./form-mapping";
import { ANSWERS_MISSING, answersToAsk, asksNameCheck, missingAnswers, NAME_ANSWERS } from "./missing-answers";
import * as repo from "./repository";

/**
 * «Completează-ți datele» (§905): the person completes, from their own link, the answers the public form
 * requires and their registration does not hold (`missing-answers.ts`) — on the declaration's page before the
 * signature, in the signature's own transaction, and on the manage page after it.
 *
 * **The person's own act, never staff's.** Reached only through the person's own link (a declaration or offer
 * token, the family's pass, the manage token), written with no staff actor and audited as the participant's:
 * `registration.answers_completed` `{ fields, via }` — the fields' names and the door, never a value (the values
 * are the row's own, and nothing stood before them). Staff complete nothing for anybody: an Administrator
 * corrects answers through «Modifică datele» (§645), audited as staff's, and the declaration stays the person's.
 *
 * **Only what is missing, by the form's own rules.** The boxes are the missing answers and, beside a missing birth
 * date, the guardian a minor's date makes owed (`answersToAsk`); anything else posted is not read. Each answer meets
 * the form's rule and the form's cross-field rules through the one planner «Modifică datele» uses
 * (`answers.ts#planAnswerEdit`): a telephone in international form, an emergency contact who is somebody else, the
 * event's minimum age, a guardian for whoever was a minor when the row was written. A required answer left empty
 * is refused by name — never filled with a default. A declaration already signed names its declarant: under one, no
 * guardian is added and the name of record does not move (`NAME_SIGNED`).
 *
 * **The name the club typed, checked before the signature (§907).** On the declaration's page only (`DECLARATION`),
 * a staff row whose declaration is not signed (`missing-answers.ts#asksNameCheck`) is drawn its two name boxes too,
 * prefilled, and the press reads them beside the missing answers: a name typed differently goes through the same
 * planner — the form's rule, the name of record composed from the two with its key (§389), the list's name following
 * when it was the derived one, as the form derives it — and the signature, in the same transaction, is checked against
 * the name it leaves. A name left as the club typed it writes nothing; a box left blank (its `required` stops that
 * first) corrects nothing either: the row always holds a name, never owed. Never from the manage link.
 */

/**
 * The marker a refusal carries when the two names typed would change the name of record under a signed declaration:
 * the signed text names its declarant, so the name of record is the declaration's (an older row that kept only that).
 */
export const NAME_SIGNED = "nameSigned";

/** The markers a refusal may carry beside the boxes, each with its own sentence on the page. */
const REFUSAL_MARKERS: readonly string[] = [ANSWERS_MISSING, UNDER_MINIMUM_AGE, EMERGENCY_SAME, GUARDIAN_SIGNED, NAME_SIGNED];

/**
 * What a refusal of the answers carries into the URL: the boxes' names and the known markers, nothing typed
 * (§14.5) — or null when the refusal is about none of the answers (the signature's own boxes, the tick).
 */
export function answersRefusalParam(fields: readonly string[]): string | null {
  const answers = fields.filter((field) => (EDITABLE_ANSWERS as readonly string[]).includes(field));
  if (answers.length === 0 && !fields.includes(ANSWERS_MISSING)) return null;
  return [...new Set([...answers, ...fields.filter((field) => REFUSAL_MARKERS.includes(field))])].join(",");
}

/** The refusal read back off the URL: matched against the answers and the markers, never trusted as typed. */
export type AnswersRefusal = {
  invalid: ReadonlySet<string>;
  tooYoung: boolean;
  emergencySame: boolean;
  /** A minor's birth date under a declaration signed with no guardian (§645's `GUARDIAN_SIGNED`). */
  minorSigned: boolean;
  nameSigned: boolean;
};

export function readAnswersRefusal(param: string | undefined): AnswersRefusal | null {
  if (!param) return null;
  const named = new Set(param.split(","));
  return {
    invalid: new Set(EDITABLE_ANSWERS.filter((field) => named.has(field))),
    tooYoung: named.has(UNDER_MINIMUM_AGE),
    emergencySame: named.has(EMERGENCY_SAME),
    minorSigned: named.has(GUARDIAN_SIGNED),
    nameSigned: named.has(NAME_SIGNED),
  };
}

/** The door the answers came through, for the trail. */
export type CompletionDoor = "DECLARATION" | "MANAGE_LINK";

/** The answers the person's boxes post, read off the form as the public form's are (`form-mapping.ts`). */
export type PostedAnswers = Partial<Record<EditableAnswer, unknown>>;

/**
 * The boxes' values, read by the public form's own mapping — a telephone composed from its country and digits, a
 * birth date typed day first — so a box completed here means what it meant on the form. Only the answers;
 * every other value the mapping reads is left behind.
 */
export function readPostedAnswers(form: FormData, locale: Locale): PostedAnswers {
  const values = readRegistrationForm(form, locale) as Record<string, unknown>;
  return Object.fromEntries(EDITABLE_ANSWERS.filter((field) => field in values).map((field) => [field, values[field]]));
}

/** A box that holds something: named `filled`, never `t…`, which the catalogue checker reads as a lookup. */
function filled(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

/** The event's facts a completion is judged by: the day and minimum age, the T-shirt, the members' bib (§664). */
export type CompletionEvent = Pick<typeof events.$inferSelect, "kitShirt" | "startsAt" | "timezone" | "minAge" | "bibDesign">;

/**
 * `planAnswerCompletion`'s context from the event's row — one reading for the page that previews and the write. The
 * door decides whether the name the club typed is read (§907): the declaration's page draws it, the manage page never.
 */
export function completionContext(event: CompletionEvent, now: Date, declarationSigned: boolean, door: CompletionDoor): Parameters<typeof planAnswerCompletion>[2] {
  return {
    kitShirt: event.kitShirt,
    eventDay: dayIn(event.startsAt, event.timezone ?? CLUB_TIME_ZONE),
    minAge: event.minAge,
    now,
    declarationSigned,
    memberBibOffered: readBibDesign(event.bibDesign).member.enabled,
    checksName: door === "DECLARATION",
  };
}

/** A name box's value on the row: the club's typed name, which a checked box is compared with (§907). */
function heldName(current: Registration, field: string): string {
  return field === "firstName" ? (current.firstName ?? "") : field === "lastName" ? (current.lastName ?? "") : "";
}

/**
 * What a completion writes, decided from the row as it stands — pure, every rule tested without a database. Null
 * when nothing is missing and no name is checked, or when nothing would change (a complete registration, a name left
 * as the club typed it: nothing to do, nothing written). Refuses (VALIDATION_ERROR naming the boxes) a required answer
 * left empty (`ANSWERS_MISSING`), an answer the form's rule refuses — a corrected name included — the form's
 * cross-field rules (`answers.ts` markers), and a new name of record under a signed declaration (`NAME_SIGNED`).
 *
 * `checksName` (the declaration's door, `completionContext`): the two name boxes of a staff row not yet signed are
 * read as well (§907) — a correction of the name the club typed, never an owed answer.
 */
export function planAnswerCompletion(
  current: Registration,
  posted: PostedAnswers,
  context: { kitShirt: boolean; eventDay: string; minAge: number | null; now: Date; declarationSigned: boolean; memberBibOffered?: boolean; checksName?: boolean },
): AnswerPlan | null {
  const missing = missingAnswers({ kitShirt: context.kitShirt }, current);
  const nameCheck = context.checksName === true && asksNameCheck(current, context.declarationSigned);
  if (missing.length === 0 && !nameCheck) return null;
  const { fields, guardianIfMinor } = answersToAsk(missing, context.declarationSigned, nameCheck);
  // The name's boxes that hold the club's name rather than ask a missing one: what they carry is a correction.
  const checked: ReadonlySet<string> = new Set(nameCheck ? NAME_ANSWERS.filter((field) => !missing.includes(field)) : []);

  const changes: Record<string, string> = {};
  for (const field of fields) {
    const value = filled(posted[field]);
    if (value === undefined) continue;
    // A checked name left as the club typed it — the form's own trim aside — writes nothing (§907).
    if (checked.has(field) && value.trim() === heldName(current, field)) continue;
    changes[field] = value;
  }
  // The guardian beside a missing birth date (§108): kept only when the date typed makes a minor on the day the
  // row was written, as the form keeps one — an adult's typed guardian is ignored, never refused.
  if (guardianIfMinor) {
    const guardian = filled(posted.guardianName);
    const birthDate = changes.birthDate;
    if (guardian !== undefined && typeof birthDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(birthDate) && isMinorOn(birthDate, current.answersWrittenAt)) {
      changes.guardianName = guardian;
    }
  }
  if (fields.length === 0) return null;

  // A checked name is never owed (§907): a box left blank keeps the name the row holds. Every other box left empty is.
  const absent = fields.filter((field) => !(field in changes) && !checked.has(field));
  let plan: AnswerPlan | null = null;
  if (Object.keys(changes).length > 0) {
    try {
      plan = planAnswerEdit(current, changes, {
        eventDay: context.eventDay,
        minAge: context.minAge,
        kitShirt: context.kitShirt,
        now: context.now,
        answersWrittenAt: current.answersWrittenAt,
        declarationSigned: context.declarationSigned,
        memberBibOffered: context.memberBibOffered,
      });
    } catch (error) {
      // Every box at once: the invalid ones and the ones left empty, so one refusal names them all.
      if (isDomainError(error) && error.code === "VALIDATION_ERROR" && absent.length > 0) {
        throw new DomainError("VALIDATION_ERROR", `${error.message}; still empty: ${absent.join(", ")}`, [...new Set([...error.fields, ...absent, ANSWERS_MISSING])]);
      }
      throw error;
    }
  }
  if (absent.length > 0) throw new DomainError("VALIDATION_ERROR", `the form requires: ${absent.join(", ")}`, [...absent, ANSWERS_MISSING]);
  if (plan?.nameChange && context.declarationSigned) {
    throw new DomainError("VALIDATION_ERROR", "the two names would change the name a signed declaration names", ["firstName", "lastName", NAME_SIGNED]);
  }
  return plan;
}

/**
 * The registration as a press of the declaration's page would sign it (§905): the answers a refused press typed,
 * through the one planner the press runs (`planAnswerCompletion`) — a guardian a minor's birth date brought, the
 * name of record two names composed — so the page asks for the signature the server will check (§108, §314), and
 * the text above it names the same declarant. Null when nothing was typed, or when what was typed would be refused
 * anyway: the page then has only the row to go by.
 */
export function registrationAfterCompletion(
  current: Registration,
  kept: PostedAnswers | null,
  context: Parameters<typeof planAnswerCompletion>[2],
): Registration | null {
  if (kept === null) return null;
  try {
    const plan = planAnswerCompletion(current, kept, context);
    return plan ? { ...current, ...plan.set } : null;
  } catch (error) {
    if (isDomainError(error)) return null;
    throw error;
  }
}

/** A kept draft (`form-draft.ts`) read as the boxes posted it, by the public form's own mapping (`readPostedAnswers`). */
export function draftAnswers(draft: Readonly<Record<string, string>> | null, locale: Locale): PostedAnswers | null {
  if (draft === null) return null;
  const form = new FormData();
  for (const [name, value] of Object.entries(draft)) form.set(name, value);
  return readPostedAnswers(form, locale);
}

/**
 * Whether the registration has a declaration acceptance, online or on paper (§67): its guardian and its name of
 * record are then the signed text's (`answers.ts#GUARDIAN_SIGNED`). One read for the page that draws the boxes and
 * the write that judges them, so the two never disagree about which boxes a minor's birth date brings.
 */
export async function declarationSignedFor<T extends Record<string, unknown>>(db: Database<T>, registrationId: string): Promise<boolean> {
  const [signed] = await db
    .select({ id: declarationAcceptances.id })
    .from(declarationAcceptances)
    .where(eq(declarationAcceptances.registrationId, registrationId))
    .limit(1);
  return signed !== undefined;
}

/**
 * The completion, written: under the event's lock (the lock `submitRegistration` and «Modifică datele» take, so a
 * completed name and a new runner on the same address cannot both find the name free, §389), the row read again
 * under it, only a registration that still stands, only the changed columns, and one audit row with no staff
 * actor. `db` may be the caller's transaction — the signature's, so the answers and the signature commit together
 * or not at all — and then the signature is checked against the name this leaves (§907). Returns the columns written —
 * a corrected name's among them, by name — none when nothing was missing or changed.
 */
export async function completeMissingAnswers<T extends Record<string, unknown>>(
  db: Database<T>,
  registrationId: string,
  posted: PostedAnswers,
  now: Date,
  via: CompletionDoor,
): Promise<{ completed: string[] }> {
  if (!isUuid(registrationId)) throw new DomainError("NOT_FOUND", "no such registration");
  return db.transaction(async (tx) => {
    const before = await repo.findRegistrationById(tx, registrationId);
    if (!before) throw new DomainError("NOT_FOUND", "no such registration");
    const event = await repo.lockEventForCapacity(tx, before.eventId);
    if (!event) throw new DomainError("NOT_FOUND", "no such event");
    const current = await repo.findRegistrationById(tx, registrationId);
    if (!current) throw new DomainError("NOT_FOUND", "no such registration");
    // A cancelled or lapsed registration owes nothing: its answers are kept as they were.
    if (!isActiveStatus(current.status)) throw new DomainError("CONFLICT", `a ${current.status} registration is not completed`);

    const plan = planAnswerCompletion(current, posted, completionContext(event, now, await declarationSignedFor(tx, current.id), via));
    if (!plan) return { completed: [] };
    if (plan.nameChange) {
      // Two people on one address are told apart by their names (§389), as «Modifică datele» asks.
      const siblings = await repo.findRegistrationsByEventAndParticipant(tx, current.eventId, current.participantId);
      if (siblings.some((row) => row.id !== current.id && registrationNameKey(row.registeredName) === plan.set.nameKey)) {
        throw new DomainError("VALIDATION_ERROR", "another registration on this address at this event already carries that name", ["firstName", "lastName"]);
      }
    }

    await tx
      .update(registrations)
      .set({ ...plan.set, updatedAt: now })
      .where(eq(registrations.id, current.id));
    const completed = [...plan.corrected.map((answer) => answer.field), ...(plan.nameChange ? ["registeredName"] : [])];
    await recordAuditEvent(tx, {
      actorStaffUserId: null,
      participantId: current.participantId,
      action: "registration.answers_completed",
      entityType: "registration",
      entityId: current.id,
      // The names of the fields and the door — never a value (§14.5): the values are the row's.
      metadata: { fields: completed, via },
      now,
    });
    return { completed };
  });
}
