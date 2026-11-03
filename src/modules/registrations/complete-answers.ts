import { eq } from "drizzle-orm";
import { declarationAcceptances } from "@/db/schema/declaration-acceptances";
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
import { ANSWERS_MISSING, answersToAsk, missingAnswers } from "./missing-answers";
import * as repo from "./repository";

/**
 * «Completează-ți datele» (§NNN): the person completes, from their own link, the answers the public form
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

function typed(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

/**
 * What a completion writes, decided from the row as it stands — pure, every rule tested without a database. Null
 * when nothing is missing (a complete registration: nothing to do, nothing written). Refuses (VALIDATION_ERROR
 * naming the boxes) a required answer left empty (`ANSWERS_MISSING`), an answer the form's rule refuses, the form's
 * cross-field rules (`answers.ts` markers), and a new name of record under a signed declaration (`NAME_SIGNED`).
 */
export function planAnswerCompletion(
  current: Registration,
  posted: PostedAnswers,
  context: { kitShirt: boolean; eventDay: string; minAge: number | null; now: Date; declarationSigned: boolean; memberBibOffered?: boolean },
): AnswerPlan | null {
  const missing = missingAnswers({ kitShirt: context.kitShirt }, current);
  if (missing.length === 0) return null;
  const { fields, guardianIfMinor } = answersToAsk(missing, context.declarationSigned);

  const changes: Record<string, string> = {};
  for (const field of fields) {
    const value = typed(posted[field]);
    if (value !== undefined) changes[field] = value;
  }
  // The guardian beside a missing birth date (§108): kept only when the date typed makes a minor on the day the
  // row was written, as the form keeps one — an adult's typed guardian is ignored, never refused.
  if (guardianIfMinor) {
    const guardian = typed(posted.guardianName);
    const birthDate = changes.birthDate;
    if (guardian !== undefined && typeof birthDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(birthDate) && isMinorOn(birthDate, current.answersWrittenAt)) {
      changes.guardianName = guardian;
    }
  }
  if (fields.length === 0) return null;

  const absent = fields.filter((field) => !(field in changes));
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
 * The completion, written: under the event's lock (the lock `submitRegistration` and «Modifică datele» take, so a
 * completed name and a new runner on the same address cannot both find the name free, §389), the row read again
 * under it, only a registration that still stands, only the changed columns, and one audit row with no staff
 * actor. `db` may be the caller's transaction — the signature's, so the answers and the signature commit together
 * or not at all. Returns the columns written; none when nothing was missing.
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

    const [signed] = await tx
      .select({ id: declarationAcceptances.id })
      .from(declarationAcceptances)
      .where(eq(declarationAcceptances.registrationId, current.id))
      .limit(1);
    const plan = planAnswerCompletion(current, posted, {
      kitShirt: event.kitShirt,
      eventDay: dayIn(event.startsAt, event.timezone ?? CLUB_TIME_ZONE),
      minAge: event.minAge,
      now,
      declarationSigned: signed !== undefined,
      memberBibOffered: readBibDesign(event.bibDesign).member.enabled,
    });
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
