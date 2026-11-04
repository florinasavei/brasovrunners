import { describe, expect, it } from "vitest";
import type { Registration } from "@/db/schema/registrations";
import { EDITABLE_ANSWERS, EMERGENCY_SAME, GUARDIAN_SIGNED } from "@/modules/registrations/answers";
import {
  answersRefusalParam,
  completionContext,
  draftAnswers,
  NAME_SIGNED,
  planAnswerCompletion,
  readAnswersRefusal,
  registrationAfterCompletion,
} from "@/modules/registrations/complete-answers";
import { registrationNameKey } from "@/modules/registrations/domain/name-key";
import { expectedSignatures } from "@/modules/registrations/domain/signature-name";
import { anotherPersonSubmissionSchema, registrationSubmissionSchema, staffRegistrationSubmissionSchema, UNDER_MINIMUM_AGE } from "@/modules/registrations/fields";
import { ANSWERS_MISSING, answersToAsk, type AnswersOnRow, asksNameCheck, missingAnswers, missingAnswersHeld } from "@/modules/registrations/missing-answers";
import { resolveDisplayName } from "@/modules/registrations/names";
import { TYPED_ANSWERS } from "../../helpers/missing-answers";

/**
 * BR-REQ-037-05 criterion 23 (§905) — «Completează-ți datele», the rules that need no database: which answers a
 * registration still owes is read off the public form's own schema (never a second list), each answer judged on
 * its own, what the event asks (the T-shirt) and the door the row came in by; and what the person's completion
 * writes or refuses.
 */
const WRITTEN = new Date("2026-09-01T10:00:00.000Z");

/** A registration the public form wrote: every answer it requires. */
const complete: AnswersOnRow = {
  source: "PUBLIC",
  answersWrittenAt: WRITTEN,
  firstName: "Ana",
  lastName: "Pop",
  birthDate: "1990-05-01",
  sex: "FEMALE",
  nationality: "RO",
  country: "RO",
  city: "Sibiu",
  phone: "+40711111111",
  emergencyContactName: "Ion Pop",
  emergencyContactPhone: "+40722222222",
  guardianName: null,
  tshirtSize: "NONE",
  clubName: null,
  stravaUrl: null,
  instagramHandle: null,
  clubMemberDeclared: false,
  memberBibWanted: false,
};

/** A staff entry, or a line of the internal list moved onto the official one (§888): a name and the column defaults. */
const nameOnly: AnswersOnRow = {
  source: "STAFF",
  answersWrittenAt: WRITTEN,
  firstName: "Mara",
  lastName: "Munteanu",
  birthDate: null,
  sex: null,
  nationality: null,
  country: "RO",
  city: null,
  phone: null,
  emergencyContactName: null,
  emergencyContactPhone: null,
  guardianName: null,
  tshirtSize: "NONE",
  clubMemberDeclared: false,
  memberBibWanted: false,
};

/** A copy of `value` without `keys`. */
function without<T extends object, K extends keyof T>(value: T, ...keys: K[]): Omit<T, K> {
  return Object.fromEntries(Object.entries(value).filter(([key]) => !keys.includes(key as K))) as Omit<T, K>;
}

const SHIRT = { kitShirt: true };
const NO_SHIRT = { kitShirt: false };

describe("BR-REQ-037-05 criterion 23: the answers a registration owes", () => {
  it("are none for a registration the public form wrote, with or without a T-shirt", () => {
    expect(missingAnswers(SHIRT, complete)).toEqual([]);
    expect(missingAnswers(NO_SHIRT, complete)).toEqual([]);
    expect(missingAnswers(SHIRT, { ...complete, source: "STAFF" })).toEqual([]);
  });

  it("are every answer the staff entry relaxes, in the form's order, for a name and an address", () => {
    expect(missingAnswers(SHIRT, nameOnly)).toEqual(["birthDate", "city", "sex", "nationality", "phone", "emergencyContactName", "emergencyContactPhone"]);
  });

  it("are read off the public form's schema, never a second list: exactly the answers its rules refuse to go without", () => {
    const shape = registrationSubmissionSchema.shape as unknown as Record<string, { safeParse(value: unknown): { success: boolean } }>;
    const required = EDITABLE_ANSWERS.filter((field) => !shape[field].safeParse(undefined).success);
    const empty: AnswersOnRow = { source: "STAFF", answersWrittenAt: WRITTEN, ...Object.fromEntries(EDITABLE_ANSWERS.map((field) => [field, null])) };
    expect(new Set(missingAnswers(NO_SHIRT, empty))).toEqual(new Set(required));
    // …and what a staff entry may leave out is a subset of them: the form, not the entry, decides what is owed.
    const staffShape = staffRegistrationSubmissionSchema.shape as unknown as Record<string, { safeParse(value: unknown): { success: boolean } }>;
    for (const field of EDITABLE_ANSWERS.filter((answer) => staffShape[answer].safeParse(undefined).success && !shape[answer].safeParse(undefined).success)) {
      expect(required, field).toContain(field);
    }
  });

  for (const field of ["firstName", "lastName", "birthDate", "sex", "nationality", "country", "city", "phone", "emergencyContactName", "emergencyContactPhone"] as const) {
    it(`asks ${field} alone when it alone is missing — absent or blank`, () => {
      expect(missingAnswers(NO_SHIRT, { ...complete, source: "STAFF", [field]: null })).toEqual([field]);
      expect(missingAnswers(NO_SHIRT, { ...complete, source: "STAFF", [field]: "  " })).toEqual([field]);
    });
  }

  it("never asks an optional answer: the club, the socials, the list's name", () => {
    expect(missingAnswers(NO_SHIRT, { ...complete, source: "STAFF", clubName: null, stravaUrl: null, instagramHandle: null, displayName: null })).toEqual([]);
  });

  it("does not ask a public row what another public door leaves blank: another person's telephone and sex on a family's address (§389)", () => {
    const relaxed = anotherPersonSubmissionSchema.shape as unknown as Record<string, { safeParse(value: unknown): { success: boolean } }>;
    expect(relaxed.phone.safeParse(undefined).success).toBe(true);
    expect(missingAnswers(NO_SHIRT, { ...complete, phone: null, sex: null })).toEqual([]);
    // …while a public row written before the city was required (§467) owes it.
    expect(missingAnswers(NO_SHIRT, { ...complete, city: null })).toEqual(["city"]);
    // A staff row owes the telephone: the person's own form would have asked it.
    expect(missingAnswers(NO_SHIRT, { ...complete, source: "STAFF", phone: null })).toEqual(["phone"]);
  });

  it("asks the T-shirt only on an event that gives one, and only of a row that never answered it — «Fără tricou» is an answer", () => {
    expect(missingAnswers(SHIRT, { ...complete, tshirtSize: null })).toEqual(["tshirtSize"]);
    expect(missingAnswers(NO_SHIRT, { ...complete, tshirtSize: null })).toEqual([]);
    expect(missingAnswers(SHIRT, { ...complete, tshirtSize: "NONE" })).toEqual([]);
    expect(missingAnswers({}, { ...complete, tshirtSize: null })).toEqual([]);
  });

  it("asks a guardian when the birth date was a minor's on the day the row was written, and only then (§108)", () => {
    const minor = { ...complete, source: "STAFF" as const, birthDate: "2010-03-01" };
    expect(missingAnswers(NO_SHIRT, minor)).toEqual(["guardianName"]);
    expect(missingAnswers(NO_SHIRT, { ...minor, guardianName: "Ion Pop" })).toEqual([]);
    expect(missingAnswers(NO_SHIRT, { ...minor, birthDate: "2008-08-31" })).toEqual([]);
  });

  it("reads the backoffice's «held» for the telephone and the emergency contact, never their values (§322)", () => {
    const held = { ...without(complete, "phone", "emergencyContactName", "emergencyContactPhone"), eventKitShirt: false, phoneHeld: true, emergencyContactNameHeld: true, emergencyContactPhoneHeld: true };
    expect(missingAnswersHeld(held)).toEqual([]);
    expect(missingAnswersHeld({ ...held, source: "STAFF", phoneHeld: false, emergencyContactPhoneHeld: false })).toEqual(["phone", "emergencyContactPhone"]);
    expect(missingAnswersHeld({ ...held, eventKitShirt: true, tshirtSize: null })).toEqual(["tshirtSize"]);
  });

  it("draws the guardian beside a missing birth date, never under a signed declaration", () => {
    expect(answersToAsk(["birthDate", "city"], false)).toEqual({ fields: ["birthDate", "city"], guardianIfMinor: true });
    expect(answersToAsk(["birthDate", "city"], true)).toEqual({ fields: ["birthDate", "city"], guardianIfMinor: false });
    expect(answersToAsk(["guardianName"], true)).toEqual({ fields: [], guardianIfMinor: false });
    expect(answersToAsk(["city"], false)).toEqual({ fields: ["city"], guardianIfMinor: false });
  });
});

/** A staff row as the service reads it. */
const row = {
  ...nameOnly,
  registeredName: "Mara Munteanu",
  displayName: "Mara M.",
  displayNameChosen: false,
  clubName: null,
  stravaUrl: null,
  instagramHandle: null,
  listSocials: false,
} as unknown as Registration;
const context = { kitShirt: false, eventDay: "2026-11-21", minAge: 14, now: new Date("2026-11-03T10:00:00.000Z"), declarationSigned: false };

function refusalOf(run: () => unknown): string[] {
  try {
    run();
  } catch (error) {
    return [...(error as { fields: string[] }).fields];
  }
  throw new Error("expected a refusal");
}

describe("BR-REQ-037-05 criterion 23: the person's completion", () => {
  it("writes nothing for a complete registration", () => {
    expect(planAnswerCompletion({ ...row, ...complete } as unknown as Registration, TYPED_ANSWERS, context)).toBeNull();
  });

  it("writes the missing answers, each through the form's own rule, and nothing else posted", () => {
    const plan = planAnswerCompletion(row, { ...TYPED_ANSWERS, firstName: "Maria", clubName: "Alt club" }, context);
    expect(plan?.set).toMatchObject({ birthDate: "1990-05-11", sex: "FEMALE", nationality: "RO", city: "Sibiu", phone: "+40712345678", emergencyContactName: "Ion Pop", emergencyContactPhone: "+40722345678" });
    expect(plan?.set).not.toHaveProperty("firstName");
    expect(plan?.set).not.toHaveProperty("clubName");
    expect(plan?.nameChange).toBeNull();
  });

  it("refuses an answer left empty by its name, with the marker — never a default in its place", () => {
    expect(refusalOf(() => planAnswerCompletion(row, without(TYPED_ANSWERS, "city", "phone"), context))).toEqual(["city", "phone", ANSWERS_MISSING]);
    expect(refusalOf(() => planAnswerCompletion(row, {}, context))).toEqual([...missingAnswers({}, row), ANSWERS_MISSING]);
  });

  it("refuses what the form refuses — a telephone, the emergency contact who is the person, the minimum age — every box at once", () => {
    expect(refusalOf(() => planAnswerCompletion(row, { ...TYPED_ANSWERS, phone: "12" }, context))).toEqual(["phone"]);
    expect(refusalOf(() => planAnswerCompletion(row, { ...TYPED_ANSWERS, emergencyContactPhone: TYPED_ANSWERS.phone }, context))).toEqual(["emergencyContactPhone", EMERGENCY_SAME]);
    expect(refusalOf(() => planAnswerCompletion(row, { ...TYPED_ANSWERS, birthDate: "2020-01-01", guardianName: "Ion Munteanu" }, context))).toEqual(["birthDate", UNDER_MINIMUM_AGE]);
    expect(refusalOf(() => planAnswerCompletion(row, { ...without(TYPED_ANSWERS, "city"), phone: "12" }, context))).toEqual(["phone", "city", ANSWERS_MISSING]);
  });

  it("asks a minor's guardian with the birth date, and ignores one typed for an adult (§108)", () => {
    expect(refusalOf(() => planAnswerCompletion(row, { ...TYPED_ANSWERS, birthDate: "2010-03-01" }, context))).toEqual(["guardianName"]);
    const minor = planAnswerCompletion(row, { ...TYPED_ANSWERS, birthDate: "2010-03-01", guardianName: "Ion Munteanu" }, context);
    expect(minor?.set).toMatchObject({ birthDate: "2010-03-01", guardianName: "Ion Munteanu" });
    const adult = planAnswerCompletion(row, { ...TYPED_ANSWERS, guardianName: "Ion Munteanu" }, context);
    expect(adult?.set).not.toHaveProperty("guardianName");
  });

  it("under a signed declaration adds no guardian, and refuses a minor's birth date the signed text cannot gain one for", () => {
    const signed = { ...context, declarationSigned: true };
    expect(refusalOf(() => planAnswerCompletion(row, { ...TYPED_ANSWERS, birthDate: "2010-03-01", guardianName: "Ion Munteanu" }, signed))).toEqual(["birthDate", GUARDIAN_SIGNED]);
    expect(planAnswerCompletion(row, TYPED_ANSWERS, signed)?.set).toMatchObject({ city: "Sibiu" });
  });

  it("never moves the name of record a signed declaration names (an older row that kept only that name)", () => {
    const older = { ...row, ...complete, source: "STAFF", firstName: null, lastName: null, registeredName: "Mara Munteanu" } as unknown as Registration;
    expect(refusalOf(() => planAnswerCompletion(older, { firstName: "Maria", lastName: "Munteanu" }, { ...context, declarationSigned: true }))).toEqual(["firstName", "lastName", NAME_SIGNED]);
    expect(planAnswerCompletion(older, { firstName: "Mara", lastName: "Munteanu" }, { ...context, declarationSigned: true })?.nameChange).toBeNull();
  });
});

describe("BR-REQ-037-05 criterion 23: who signs follows the answers typed above the signature (§108, §314)", () => {
  /** The boxes as a refused press kept them (`form-draft.ts`): the birth date day first, the telephones as country and digits. */
  const kept = {
    birthDate: "11.05.1990",
    sex: "FEMALE",
    nationality: "RO",
    city: "Sibiu",
    phoneCountry: "RO",
    phone: "0712345678",
    emergencyContactName: "Ion Pop",
    emergencyContactPhoneCountry: "RO",
    emergencyContactPhone: "0722345678",
  };

  it("reads a kept draft by the public form's own mapping, and nothing without one", () => {
    expect(draftAnswers(kept, "ro")).toMatchObject({ birthDate: "1990-05-11", phone: "+40712345678", emergencyContactPhone: "+40722345678", city: "Sibiu" });
    expect(draftAnswers(null, "ro")).toBeNull();
  });

  it("a minor's birth date and a guardian make the guardian the declarant the signature is checked against", () => {
    const after = registrationAfterCompletion(row, draftAnswers({ ...kept, birthDate: "01.03.2010", guardianName: "Ion Munteanu" }, "ro"), context);
    expect(after).toMatchObject({ birthDate: "2010-03-01", guardianName: "Ion Munteanu", registeredName: "Mara Munteanu" });
    expect(after && expectedSignatures(after, { minorSigns: false })).toEqual({ typedName: "Ion Munteanu", minorTypedName: null });
    expect(after && expectedSignatures(after, { minorSigns: true })).toEqual({ typedName: "Ion Munteanu", minorTypedName: "Mara Munteanu" });
  });

  it("an adult's answers keep the person as the declarant; nothing typed, or answers the press would refuse, leave the row to go by", () => {
    const adult = registrationAfterCompletion(row, draftAnswers(kept, "ro"), context);
    expect(adult && expectedSignatures(adult, { minorSigns: true })).toEqual({ typedName: "Mara Munteanu", minorTypedName: null });
    expect(registrationAfterCompletion(row, null, context)).toBeNull();
    expect(registrationAfterCompletion(row, draftAnswers({ ...kept, birthDate: "01.03.2010" }, "ro"), context)).toBeNull();
    expect(registrationAfterCompletion(row, draftAnswers({ ...kept, city: "" }, "ro"), context)).toBeNull();
  });

  it("judges by the event's own row, as the write does: its day in its zone, its minimum age, the T-shirt, the members' bib", () => {
    const event = { kitShirt: true, startsAt: new Date("2026-11-20T23:30:00.000Z"), timezone: "Europe/Bucharest", minAge: 16, bibDesign: null };
    expect(completionContext(event, context.now, true, "MANAGE_LINK")).toEqual({
      kitShirt: true,
      eventDay: "2026-11-21",
      minAge: 16,
      now: context.now,
      declarationSigned: true,
      memberBibOffered: false,
      checksName: false,
    });
    // The declaration's door reads the name the club typed as well (§907); the manage link never does.
    expect(completionContext(event, context.now, false, "DECLARATION").checksName).toBe(true);
  });
});

describe("BR-REQ-037-05: the name the club typed, checked by the person before signing (§907)", () => {
  /** A line of the internal list moved onto the official one: «Sebi Sebi» and an address, the list's name derived. */
  const sebi = { ...row, firstName: "Sebi", lastName: "Sebi", registeredName: "Sebi Sebi", displayName: "Sebi Sebi" } as unknown as Registration;
  const atSigning = { ...context, checksName: true };
  const corrected = { ...TYPED_ANSWERS, firstName: "Sebastian", lastName: "Popescu" };

  it("is asked of a staff row while no declaration is signed — never of a public row, never under a signed one", () => {
    expect(asksNameCheck({ source: "STAFF" }, false)).toBe(true);
    expect(asksNameCheck({ source: "STAFF" }, true)).toBe(false);
    expect(asksNameCheck({ source: "PUBLIC" }, false)).toBe(false);
  });

  it("draws the two name boxes first, as the form asks them — alone when nothing else is missing, never under a signature", () => {
    expect(answersToAsk(["birthDate", "city"], false, true)).toEqual({ fields: ["firstName", "lastName", "birthDate", "city"], guardianIfMinor: true });
    expect(answersToAsk([], false, true)).toEqual({ fields: ["firstName", "lastName"], guardianIfMinor: false });
    expect(answersToAsk(["city"], true, true)).toEqual({ fields: ["city"], guardianIfMinor: false });
    // A name missing outright is asked once.
    expect(answersToAsk(["firstName", "city"], false, true).fields).toEqual(["firstName", "lastName", "city"]);
  });

  it("writes a corrected name with the answers: the name of record and its key, the list's name derived from it as the form derives it", () => {
    const plan = planAnswerCompletion(sebi, corrected, atSigning);
    expect(plan?.set).toMatchObject({
      firstName: "Sebastian",
      lastName: "Popescu",
      registeredName: "Sebastian Popescu",
      nameKey: registrationNameKey("Sebastian Popescu"),
      displayName: resolveDisplayName({ firstName: "Sebastian", lastName: "Popescu", legalName: "Sebastian Popescu" }),
      city: "Sibiu",
    });
    expect(plan?.nameChange).toEqual({ from: "Sebi Sebi", to: "Sebastian Popescu" });
    expect(plan?.corrected.map((answer) => answer.field)).toEqual(expect.arrayContaining(["firstName", "lastName", "displayName"]));
  });

  it("a name left as the club typed it, or a box left blank, writes nothing of the name — and asks no more than that", () => {
    const kept = planAnswerCompletion(sebi, { ...TYPED_ANSWERS, firstName: " Sebi ", lastName: "Sebi" }, atSigning);
    expect(kept?.set).not.toHaveProperty("firstName");
    expect(kept?.set).not.toHaveProperty("registeredName");
    expect(kept?.nameChange).toBeNull();
    expect(planAnswerCompletion(sebi, TYPED_ANSWERS, atSigning)?.nameChange).toBeNull();
    // Nothing missing: the name alone, unchanged, is nothing to do; corrected, it is the whole write.
    const whole = { ...sebi, ...complete, source: "STAFF", firstName: "Sebi", lastName: "Sebi" } as unknown as Registration;
    expect(planAnswerCompletion(whole, { firstName: "Sebi", lastName: "Sebi" }, atSigning)).toBeNull();
    expect(planAnswerCompletion(whole, {}, atSigning)).toBeNull();
    expect(planAnswerCompletion(whole, { firstName: "Sebastian", lastName: "Popescu" }, atSigning)?.set).toMatchObject({ registeredName: "Sebastian Popescu" });
  });

  it("refuses a name the form refuses, by its box", () => {
    expect(refusalOf(() => planAnswerCompletion(sebi, { ...corrected, firstName: "S".repeat(101) }, atSigning))).toEqual(["firstName"]);
  });

  it("keeps a list name chosen apart from the name, as every correction of the two names does", () => {
    const chosen = { ...sebi, displayName: "Sebi" } as unknown as Registration;
    expect(planAnswerCompletion(chosen, corrected, atSigning)?.set).not.toHaveProperty("displayName");
  });

  it("never reads the name of a public row, under a signed declaration, or from the manage link", () => {
    expect(planAnswerCompletion({ ...sebi, source: "PUBLIC" } as unknown as Registration, corrected, atSigning)?.set).not.toHaveProperty("firstName");
    expect(planAnswerCompletion(sebi, corrected, { ...atSigning, declarationSigned: true })?.set).not.toHaveProperty("firstName");
    expect(planAnswerCompletion(sebi, corrected, context)?.set).not.toHaveProperty("firstName");
  });

  it("after a refused press, the signature is checked against the name the kept draft corrected", () => {
    const keptDraft = { firstName: "Sebastian", lastName: "Popescu", birthDate: "11.05.1990", sex: "FEMALE", nationality: "RO", city: "Sibiu", phoneCountry: "RO", phone: "0712345678", emergencyContactName: "Ion Pop", emergencyContactPhoneCountry: "RO", emergencyContactPhone: "0722345678" };
    const after = registrationAfterCompletion(sebi, draftAnswers(keptDraft, "ro"), atSigning);
    expect(after && expectedSignatures(after, { minorSigns: false })).toEqual({ typedName: "Sebastian Popescu", minorTypedName: null });
  });
});

describe("BR-REQ-037-05 criterion 23: the refusal in the address", () => {
  it("carries the answers' names and the known markers, nothing typed, and nothing for a refusal about other boxes", () => {
    expect(answersRefusalParam(["phone", "city", ANSWERS_MISSING, "somethingElse"])).toBe("phone,city,answersMissing");
    expect(answersRefusalParam(["typedName"])).toBeNull();
    expect(answersRefusalParam([ANSWERS_MISSING])).toBe("answersMissing");
    const read = readAnswersRefusal("birthDate,tooYoung,emergencyContactPhone,emergencySame,<script>");
    expect([...(read?.invalid ?? [])]).toEqual(["birthDate", "emergencyContactPhone"]);
    expect(read).toMatchObject({ tooYoung: true, emergencySame: true, minorSigned: false, nameSigned: false });
    expect(readAnswersRefusal(undefined)).toBeNull();
  });
});
