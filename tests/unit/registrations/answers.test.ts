import { describe, expect, it } from "vitest";
import type { Registration } from "@/db/schema/registrations";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import {
  ANSWERS_UNCHANGED,
  answersRefusalCode,
  EDITABLE_ANSWERS,
  EMERGENCY_SAME,
  GUARDIAN_ADULT,
  GUARDIAN_SIGNED,
  LOCKED_ANSWER_KINDS,
  MINOR_AT_REGISTRATION,
  planAnswerEdit,
  typedPhone,
} from "@/modules/registrations/answers";
import { type ConfirmSpec, resolveChangedFields } from "@/shared/feedback/notice";
import { CLUB_NAME } from "@/theme/brand";

/**
 * BR-REQ-037-03 criterion 12 (§645) — «Modifică datele», the rules that need no database: what the
 * allowlist holds and what it never will, what one correction writes, and the question that names
 * the fields the press changes.
 */
const current = {
  firstName: "Ana",
  lastName: "Pop",
  registeredName: "Ana Pop",
  displayName: "Ana Pop",
  birthDate: "1990-05-01",
  sex: "FEMALE",
  nationality: "RO",
  country: "RO",
  city: "Brasov",
  phone: "+40711111111",
  emergencyContactName: "Ion Pop",
  emergencyContactPhone: "+40722222222",
  guardianName: null,
  clubMemberDeclared: false,
  clubName: "CS Alt Club",
  stravaUrl: null,
  instagramHandle: null,
  tshirtSize: "NONE",
  listSocials: false,
} as unknown as Registration;
const context = { eventDay: "2026-11-21", minAge: 14, kitShirt: true, now: new Date("2026-10-02T10:00:00.000Z"), createdAt: new Date("2026-09-01T10:00:00.000Z"), declarationSigned: false };

function refusalOf(run: () => unknown): string[] {
  try {
    run();
  } catch (error) {
    return [...(error as { fields: string[] }).fields];
  }
  throw new Error("expected a refusal");
}

describe("BR-REQ-037-03 criterion 12: the allowlist", () => {
  it("is the answers the person typed — never the address, a consent, a declaration's statement, or the state", () => {
    for (const locked of ["email", "healthNotes", "healthConsent", "listOptOut", "listSocials", "promoConsent", "resultsNameConsent", "fitnessDeclared", "termsAccepted", "rulesAcknowledged", "status", "bibNumber", "kind", "locale"]) {
      expect(EDITABLE_ANSWERS as readonly string[], locked).not.toContain(locked);
    }
    expect(new Set(Object.values(LOCKED_ANSWER_KINDS))).toEqual(new Set(["address", "consents", "declaration"]));
  });
});

describe("BR-REQ-037-03 criterion 12: one correction's plan", () => {
  it("writes only the changed columns and lists each with its two values", () => {
    const plan = planAnswerEdit(current, { city: "Brașov", phone: "+40 711 111 111", tshirtSize: "M" }, context);
    expect(plan.set).toEqual({ city: "Brașov", tshirtSize: "M" });
    expect(plan.corrected).toEqual([
      { field: "city", from: "Brasov", to: "Brașov" },
      { field: "tshirtSize", from: "NONE", to: "M" },
    ]);
    expect(plan.nameChange).toBeNull();
  });

  it("refuses a change that changes nothing, and an empty one, with the marker", () => {
    expect(refusalOf(() => planAnswerEdit(current, { city: "Brasov " }, context))).toEqual([ANSWERS_UNCHANGED]);
    expect(refusalOf(() => planAnswerEdit(current, {}, context))).toEqual([ANSWERS_UNCHANGED]);
  });

  it("refuses a key outside the allowlist by its name", () => {
    expect(refusalOf(() => planAnswerEdit(current, { email: "other@example.org" }, context))).toEqual(["email"]);
    expect(refusalOf(() => planAnswerEdit(current, { status: "CANCELLED" }, context))).toEqual(["status"]);
  });

  it("writes the club's own name with the tick, and keeps a T-shirt only where the event gives one", () => {
    expect(planAnswerEdit(current, { clubMemberDeclared: true }, context).set).toEqual({ clubMemberDeclared: true, clubName: CLUB_NAME });
    expect(refusalOf(() => planAnswerEdit(current, { tshirtSize: "M" }, { ...context, kitShirt: false }))).toEqual([ANSWERS_UNCHANGED]);
  });

  it("requires both names once either moves, and composes the name of record from them", () => {
    const parts = { ...current, firstName: null, lastName: null } as unknown as Registration;
    expect(refusalOf(() => planAnswerEdit(parts, { firstName: "Ana" }, context))).toEqual(["lastName"]);
    const plan = planAnswerEdit(current, { firstName: "Ana Maria" }, context);
    expect(plan.nameChange).toEqual({ from: "Ana Pop", to: "Ana Maria Pop" });
    expect(plan.set).toMatchObject({ registeredName: "Ana Maria Pop", nameKey: "ana maria pop", displayName: "Ana Maria Pop" });
  });
});

describe("BR-REQ-037-03 criterion 12: the rules that say which one refused", () => {
  it("refuses the participant's own number as the emergency contact with §231's marker, not as an invalid number", () => {
    expect(refusalOf(() => planAnswerEdit(current, { emergencyContactPhone: "0711 111 111" }, context))).toEqual(["emergencyContactPhone", EMERGENCY_SAME]);
  });

  it("keeps the guardian a signed declaration names: corrected or cleared, refused with its marker", () => {
    const minor = { ...current, birthDate: "2012-03-01", guardianName: "Maria Pop" } as unknown as Registration;
    const signed = { ...context, minAge: null, declarationSigned: true };
    expect(refusalOf(() => planAnswerEdit(minor, { guardianName: "Elena Pop" }, signed))).toEqual(["guardianName", GUARDIAN_SIGNED]);
    expect(refusalOf(() => planAnswerEdit(minor, { guardianName: "" }, signed))).toEqual(["guardianName", GUARDIAN_SIGNED]);
    // Before any declaration it is an answer like the others.
    expect(planAnswerEdit(minor, { guardianName: "Elena Pop" }, { ...signed, declarationSigned: false }).set).toEqual({ guardianName: "Elena Pop" });
    // The other answers of a signed row are still corrected.
    expect(planAnswerEdit(minor, { city: "Brașov" }, signed).set).toEqual({ city: "Brașov" });
  });

  it("keeps no socials on a row a minor's when written, as the minors' sweep judges it, with its own marker", () => {
    // Eighteen on 2026-09-15: a minor on the day the row was written (2026-09-01), an adult today (2026-10-02).
    const grownUp = { ...current, birthDate: "2008-09-15", guardianName: "Maria Pop" } as unknown as Registration;
    expect(refusalOf(() => planAnswerEdit(grownUp, { stravaUrl: "https://www.strava.com/athletes/123" }, context))).toEqual(["stravaUrl", MINOR_AT_REGISTRATION]);
    expect(refusalOf(() => planAnswerEdit(grownUp, { instagramHandle: "@ana.pop" }, context))).toEqual(["instagramHandle", MINOR_AT_REGISTRATION]);
    // A minor today is refused by the rule of today, without the marker.
    const minor = { ...current, birthDate: "2012-03-01", guardianName: "Maria Pop" } as unknown as Registration;
    expect(refusalOf(() => planAnswerEdit(minor, { instagramHandle: "ana.pop" }, { ...context, minAge: null }))).toEqual(["instagramHandle"]);
    // The same person's row written after the eighteenth birthday keeps them.
    const later = { ...context, createdAt: new Date("2026-09-20T10:00:00.000Z") };
    expect(planAnswerEdit(grownUp, { instagramHandle: "@ana.pop" }, later).set).toEqual({ instagramHandle: "ana.pop" });
    // Clearing them is always allowed.
    const withSocials = { ...grownUp, instagramHandle: "ana.pop" } as unknown as Registration;
    expect(planAnswerEdit(withSocials, { instagramHandle: "" }, context).set).toEqual({ instagramHandle: null });
  });
});

describe("BR-REQ-037-03 criterion 12: only a minor's row names a guardian (§108)", () => {
  const minor = { ...current, birthDate: "2012-03-01", guardianName: "Maria Pop" } as unknown as Registration;
  const noMinAge = { ...context, minAge: null };

  it("refuses a guardian typed on an adult's row with its own marker", () => {
    expect(refusalOf(() => planAnswerEdit(current, { guardianName: "Maria Pop" }, context))).toEqual(["guardianName", GUARDIAN_ADULT]);
    // An adult's birth date and a guardian in the same press: still an adult's row.
    expect(refusalOf(() => planAnswerEdit(minor, { birthDate: "1990-05-01", guardianName: "Elena Pop" }, noMinAge))).toEqual(["guardianName", GUARDIAN_ADULT]);
  });

  it("clears the guardian when a corrected birth date makes the row an adult's on the day it was written, audited", () => {
    const plan = planAnswerEdit(minor, { birthDate: "1990-05-01" }, noMinAge);
    expect(plan.set).toEqual({ birthDate: "1990-05-01", guardianName: null });
    expect(plan.corrected).toEqual([
      { field: "birthDate", from: "2012-03-01", to: "1990-05-01" },
      { field: "guardianName", from: "Maria Pop", to: null },
    ]);
  });

  it("keeps the guardian of a row a minor's when written, though the person is an adult today", () => {
    // Eighteen on 2026-09-15: a minor on 2026-09-01, when the row was written.
    const grownUp = { ...current, birthDate: "2008-09-15", guardianName: "Maria Pop" } as unknown as Registration;
    expect(planAnswerEdit(grownUp, { birthDate: "2008-09-10" }, context).set).toEqual({ birthDate: "2008-09-10" });
    expect(planAnswerEdit(grownUp, { guardianName: "Elena Pop" }, context).set).toEqual({ guardianName: "Elena Pop" });
  });

  it("owes a guardian on the day it allows one: a row a minor's when written, the person an adult today", () => {
    // Eighteen on 2026-09-15: a minor on 2026-09-01, when the row was written; an adult on 2026-10-02.
    const grownUp = { ...current, birthDate: "2008-09-15", guardianName: "Maria Pop" } as unknown as Registration;
    // A: clearing the guardian leaves a minor's row with none.
    expect(refusalOf(() => planAnswerEdit(grownUp, { guardianName: "" }, context))).toEqual(["guardianName"]);
    // B: an adult's row corrected to a birth date a minor's when written, with no guardian.
    expect(refusalOf(() => planAnswerEdit(current, { birthDate: "2008-09-10" }, context))).toEqual(["guardianName"]);
    expect(planAnswerEdit(current, { birthDate: "2008-09-10", guardianName: "Maria Pop" }, context).set).toEqual({ birthDate: "2008-09-10", guardianName: "Maria Pop" });
    // C: the same date on an adult's signed row, refused on the birth date: no guardian can be added.
    expect(refusalOf(() => planAnswerEdit(current, { birthDate: "2008-09-10" }, { ...context, declarationSigned: true }))).toEqual(["birthDate", GUARDIAN_SIGNED]);
    // D: the row itself corrected to an adult's birth date before any declaration: the guardian goes, audited.
    const plan = planAnswerEdit(grownUp, { birthDate: "1990-05-01" }, context);
    expect(plan.set).toEqual({ birthDate: "1990-05-01", guardianName: null });
    expect(plan.corrected).toEqual([
      { field: "birthDate", from: "2008-09-15", to: "1990-05-01" },
      { field: "guardianName", from: "Maria Pop", to: null },
    ]);
  });

  it("under a signed declaration the guardian stays, and a birth date that would need one or drop one is refused on the birth date", () => {
    const signed = { ...noMinAge, declarationSigned: true };
    // An adult's date on a signed minor's row: the guardian can neither go (the declaration names them)
    // nor stay on an adult's row, so the birth date is refused with both markers.
    expect(refusalOf(() => planAnswerEdit(minor, { birthDate: "1990-05-01" }, signed))).toEqual(["birthDate", GUARDIAN_SIGNED, GUARDIAN_ADULT]);
    // A minor's date that stays a minor's on the same signed row is still corrected.
    expect(planAnswerEdit(minor, { birthDate: "2012-04-01" }, signed).set).toEqual({ birthDate: "2012-04-01" });
    // A minor's date on an adult's signed row: no guardian can be added under the signature.
    expect(refusalOf(() => planAnswerEdit(current, { birthDate: "2012-03-01" }, signed))).toEqual(["birthDate", GUARDIAN_SIGNED]);
  });
});

describe("BR-REQ-037-03 criterion 12: the page's sentence names the rule, and the box that moved", () => {
  it("names the birth date when only the birth date moved and the row still holds socials", () => {
    const withSocials = { ...current, instagramHandle: "ana.pop" } as unknown as Registration;
    // A minor's when written (2026-09-01), an adult today.
    expect(refusalOf(() => planAnswerEdit(withSocials, { birthDate: "2008-09-15", guardianName: "Maria Pop" }, context))).toEqual(["birthDate", MINOR_AT_REGISTRATION]);
    // A minor today too: the same sentence, the birth date is what moved.
    expect(refusalOf(() => planAnswerEdit(withSocials, { birthDate: "2012-03-01", guardianName: "Maria Pop" }, { ...context, minAge: null }))).toEqual(["birthDate", MINOR_AT_REGISTRATION]);
  });

  it("maps each marker to its sentence, the birth date's own where the birth date is the box refused", () => {
    expect(answersRefusalCode([ANSWERS_UNCHANGED])).toBe("ANSWERS_UNCHANGED");
    expect(answersRefusalCode(["emergencyContactPhone", EMERGENCY_SAME])).toBe("ANSWER_EMERGENCY_SAME");
    expect(answersRefusalCode(["guardianName", GUARDIAN_SIGNED])).toBe("ANSWER_GUARDIAN_SIGNED");
    expect(answersRefusalCode(["birthDate", GUARDIAN_SIGNED])).toBe("ANSWER_BIRTH_DATE_GUARDIAN_SIGNED");
    expect(answersRefusalCode(["birthDate", GUARDIAN_SIGNED, GUARDIAN_ADULT])).toBe("ANSWER_BIRTH_DATE_GUARDIAN_SIGNED_ADULT");
    expect(answersRefusalCode(["guardianName", GUARDIAN_ADULT])).toBe("ANSWER_GUARDIAN_ADULT");
    expect(answersRefusalCode(["stravaUrl", MINOR_AT_REGISTRATION])).toBe("ANSWER_SOCIALS_MINOR_AT_REGISTRATION");
    expect(answersRefusalCode(["birthDate", MINOR_AT_REGISTRATION])).toBe("ANSWER_BIRTH_DATE_MINOR_AT_REGISTRATION");
    expect(answersRefusalCode(["city"])).toBeNull();
  });

  it("has every sentence in both languages, under 200 characters, the birth date's naming it", () => {
    const codes = ["ANSWER_GUARDIAN_SIGNED", "ANSWER_BIRTH_DATE_GUARDIAN_SIGNED", "ANSWER_BIRTH_DATE_GUARDIAN_SIGNED_ADULT", "ANSWER_GUARDIAN_ADULT", "ANSWER_SOCIALS_MINOR_AT_REGISTRATION", "ANSWER_BIRTH_DATE_MINOR_AT_REGISTRATION"];
    for (const [catalogue, word] of [[ro, "Data nașterii"], [en, "birth date"]] as const) {
      const errors = catalogue.Admin.errors as Record<string, string>;
      for (const code of codes) {
        expect(errors[code], code).toBeTruthy();
        expect(errors[code].length, code).toBeLessThan(200);
      }
      expect(errors.ANSWER_BIRTH_DATE_MINOR_AT_REGISTRATION).toContain(word);
      expect(errors.ANSWER_BIRTH_DATE_GUARDIAN_SIGNED).toContain(word);
      expect(errors.ANSWER_BIRTH_DATE_GUARDIAN_SIGNED_ADULT).toContain(word);
    }
  });
});

describe("BR-REQ-037-03 criterion 12: a telephone as an Administrator types it", () => {
  it("composes the international form the way the form does, and leaves the rest to the rule", () => {
    expect(typedPhone("0712 345 678")).toBe("+40712345678");
    expect(typedPhone("+40 712-345-678")).toBe("+40712345678");
    expect(typedPhone("0049 151 2345 6789")).toBe("+4915123456789");
    expect(typedPhone("asd")).toBe("asd");
  });
});

describe("BR-REQ-037-03 criterion 12: the question names the fields the press changes", () => {
  const spec: ConfirmSpec = {
    title: "Corectezi datele?",
    body: "Corectezi la Ana Pop: {fields}. Nimic altceva nu se schimbă.",
    changedFields: { labels: { firstName: "Prenume", city: "Orașul", clubMemberDeclared: "Membru (declarat)" }, separator: ", " },
    confirmLabel: "Salvează datele",
    cancelLabel: "Renunță",
  };
  const form = (values: Record<string, string>) => (field: string) => values[field] ?? null;

  it("names each moved field by its label, in the form's order; a box unticked counts", () => {
    const resolved = resolveChangedFields(
      spec,
      form({ firstName: "Ana", "was.firstName": "Ana", city: "Brașov", "was.city": "Brasov", "was.clubMemberDeclared": "on" }),
    );
    expect(resolved?.body).toBe("Corectezi la Ana Pop: Orașul, Membru (declarat). Nimic altceva nu se schimbă.");
    expect(resolved?.changedFields).toBeUndefined();
  });

  it("asks nothing when no field moved — the server says so", () => {
    expect(resolveChangedFields(spec, form({ firstName: " Ana ", "was.firstName": "Ana", city: "Brasov", "was.city": "Brasov", "was.clubMemberDeclared": "" }))).toBeNull();
  });
});
