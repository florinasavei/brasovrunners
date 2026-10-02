import { describe, expect, it } from "vitest";
import type { Registration } from "@/db/schema/registrations";
import { ANSWERS_UNCHANGED, EDITABLE_ANSWERS, LOCKED_ANSWER_KINDS, planAnswerEdit, typedPhone } from "@/modules/registrations/answers";
import { type ConfirmSpec, resolveChangedFields } from "@/shared/feedback/notice";
import { CLUB_NAME } from "@/theme/brand";

/**
 * BR-REQ-037-03 criterion 12 (§NNN) — «Modifică datele», the rules that need no database: what the
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
const context = { eventDay: "2026-11-21", minAge: 14, kitShirt: true, now: new Date("2026-10-02T10:00:00.000Z") };

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
