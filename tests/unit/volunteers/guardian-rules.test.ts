import { describe, expect, it } from "vitest";
import {
  agreementMinimumAge,
  guardianAllowsConfirm,
  guardianSharesAddress,
  guardianStandingOf,
  isVolunteerMinor,
  refusedFields,
  VOLUNTEER_ADULT_AGE,
  VOLUNTEER_MINIMUM_AGE,
  volunteerAgreementAcceptSchema,
  volunteerGuardianAcceptSchema,
  volunteerPublicProfileSchemaFor,
  volunteerPublicSchemaFor,
  volunteerStaffInputSchema,
} from "@/modules/volunteers/domain/volunteer";

/**
 * §768 — volunteers from fourteen, with a parent's or guardian's agreement under eighteen (the owner, 2026-10-14: «voluntarii
 * trebuie să aibă cel puțin 14 ani, nu 18» and «fă cu acord ceva»): the pure rules — the age boundary, what the form and the
 * organizers' entry ask of a minor, the guardian's states, and the two acceptance schemas. No database
 * (`tests/integration/volunteers/guardian.test.ts` keeps them in the rows).
 */
const ID = "5d7a2f64-3b0c-4f25-9d57-0a9a6b3a1c11";
const PUBLIC = {
  roleIds: [ID],
  name: "Ana Test",
  email: "ana@example.test",
  phone: "+40712345678",
  message: "",
  locale: "ro",
  consent: true,
  agreement: true,
  sex: "FEMALE",
  city: "Brașov",
};
const GUARDIAN = { guardianName: "  Maria   Popescu ", guardianEmail: " maria@example.test ", guardianAware: true };
const NOW = new Date("2026-10-14T10:00:00Z");

describe("§768 the age boundary: fourteen, and eighteen for a person alone", () => {
  it("is one constant of the platform, not a club setting: fourteen to be taken, eighteen to be taken alone", () => {
    expect(VOLUNTEER_MINIMUM_AGE).toBe(14);
    expect(VOLUNTEER_ADULT_AGE).toBe(18);
  });

  it("says a minor for a number under eighteen and for nobody else — no age is never a minor", () => {
    for (const age of [14, 15, 17]) expect(isVolunteerMinor(age), String(age)).toBe(true);
    for (const age of [18, 19, 40]) expect(isVolunteerMinor(age), String(age)).toBe(false);
    for (const age of [null, undefined]) expect(isVolunteerMinor(age), String(age)).toBe(false);
  });

  it("refuses thirteen on the age's own box whatever the club's texts say, and takes fourteen only with a guardian", () => {
    for (const minors of [true, false]) {
      const schema = volunteerPublicProfileSchemaFor(minors);
      const thirteen = schema.safeParse({ ...PUBLIC, age: "13", ...GUARDIAN });
      expect(thirteen.success, `minors ${minors}`).toBe(false);
      if (!thirteen.success) expect(refusedFields(thirteen.error)).toContain("age");
    }
    const open = volunteerPublicProfileSchemaFor(true);
    // Fourteen with the parent's name, address and the person's tick: taken, the boxes folded into one guardian.
    const taken = open.parse({ ...PUBLIC, age: "14", ...GUARDIAN });
    expect(taken).toMatchObject({ age: 14, guardian: { name: "Maria Popescu", email: "maria@example.test" } });
    expect(taken).not.toHaveProperty("guardianName");
    expect(taken).not.toHaveProperty("guardianAware");
    // Fourteen alone is refused, each missing box named — the name, the address, the tick.
    const alone = open.safeParse({ ...PUBLIC, age: "14" });
    expect(alone.success).toBe(false);
    if (!alone.success) expect(refusedFields(alone.error).sort()).toEqual(["guardianAware", "guardianEmail", "guardianName"]);
    // Seventeen is still a minor; eighteen goes alone, and whatever was typed in the guardian's boxes is dropped, never kept.
    expect(open.parse({ ...PUBLIC, age: "17", ...GUARDIAN }).guardian).not.toBeNull();
    const adult = open.parse({ ...PUBLIC, age: "18", ...GUARDIAN });
    expect(adult.guardian).toBeNull();
    expect(JSON.stringify(adult)).not.toContain("Popescu");
    expect(open.parse({ ...PUBLIC, age: "18" }).guardian).toBeNull();
  });

  it("asks the guardian's address as a real address and the tick as the person's own act, each named apart", () => {
    const open = volunteerPublicProfileSchemaFor(true);
    const badAddress = open.safeParse({ ...PUBLIC, age: "15", ...GUARDIAN, guardianEmail: "maria-at-example" });
    expect(badAddress.success).toBe(false);
    if (!badAddress.success) expect(refusedFields(badAddress.error)).toEqual(["guardianEmail"]);
    const noTick = open.safeParse({ ...PUBLIC, age: "15", ...GUARDIAN, guardianAware: false });
    expect(noTick.success).toBe(false);
    if (!noTick.success) expect(refusedFields(noTick.error)).toEqual(["guardianAware"]);
    const noName = open.safeParse({ ...PUBLIC, age: "15", ...GUARDIAN, guardianName: "   " });
    expect(noName.success).toBe(false);
    if (!noName.success) expect(refusedFields(noName.error)).toEqual(["guardianName"]);
  });

  it("refuses an age under eighteen while the club cannot take minors yet, on the age's own box — whatever the guardian's boxes hold", () => {
    const closed = volunteerPublicProfileSchemaFor(false);
    for (const age of ["14", "17"]) {
      const verdict = closed.safeParse({ ...PUBLIC, age, ...GUARDIAN });
      expect(verdict.success, age).toBe(false);
      if (!verdict.success) expect(refusedFields(verdict.error), age).toEqual(["age"]);
    }
    expect(closed.safeParse({ ...PUBLIC, age: "18" }).success).toBe(true);
  });

  it("takes only adults on §758's form, whatever the minors' texts say: it asks no age", () => {
    for (const minors of [true, false]) {
      const schema = volunteerPublicSchemaFor({ profile: false, minors });
      expect(schema.safeParse({ ...PUBLIC, adult: false }).success).toBe(false);
      expect(schema.safeParse({ ...PUBLIC, adult: true }).success).toBe(true);
    }
  });
});

describe("§768 the organizers' entry holds the same line", () => {
  const staff = { roleIds: [ID], assignedRoleId: "", name: "Ana Test", email: "ana@example.test", phone: "+40712345678", note: "" };

  it("asks a name for a person under eighteen, and the address only if the organizer has it — the consent may be on paper", () => {
    const noGuardian = volunteerStaffInputSchema.safeParse({ ...staff, age: "16" });
    expect(noGuardian.success).toBe(false);
    if (!noGuardian.success) expect(refusedFields(noGuardian.error)).toEqual(["guardianName"]);
    const onPaper = volunteerStaffInputSchema.parse({ ...staff, age: "16", guardianName: " Maria  Popescu " });
    expect(onPaper).toMatchObject({ age: 16, guardian: { name: "Maria Popescu", email: null } });
    const withAddress = volunteerStaffInputSchema.parse({ ...staff, age: "16", guardianName: "Maria Popescu", guardianEmail: "maria@example.test" });
    expect(withAddress.guardian).toEqual({ name: "Maria Popescu", email: "maria@example.test" });
    // An address typed must be one.
    const typo = volunteerStaffInputSchema.safeParse({ ...staff, age: "16", guardianName: "Maria Popescu", guardianEmail: "nope" });
    if (!typo.success) expect(refusedFields(typo.error)).toEqual(["guardianEmail"]);
    expect(typo.success).toBe(false);
  });

  it("refuses thirteen, takes an adult or no age with no guardian, and drops what an adult's boxes hold", () => {
    expect(volunteerStaffInputSchema.safeParse({ ...staff, age: "13", guardianName: "Maria Popescu" }).success).toBe(false);
    expect(volunteerStaffInputSchema.parse({ ...staff }).guardian).toBeNull();
    expect(volunteerStaffInputSchema.parse({ ...staff, age: "18" }).guardian).toBeNull();
    const adult = volunteerStaffInputSchema.parse({ ...staff, age: "40", guardianName: "Maria Popescu", guardianEmail: "maria@example.test" });
    expect(adult.guardian).toBeNull();
    expect(JSON.stringify(adult)).not.toContain("Popescu");
  });
});

describe("§768 where a volunteer stands with their parent's or guardian's agreement", () => {
  const minor = { age: 15, guardianAcceptedAt: null, guardianTokenExpiresAt: null };

  it("is «Acordul părintelui lipsește» until the guardian accepts, «link sent» while a link is live, and nothing for an adult", () => {
    expect(guardianStandingOf(minor, NOW)).toBe("missing");
    expect(guardianStandingOf({ ...minor, guardianTokenExpiresAt: new Date(NOW.getTime() + 60_000) }, NOW)).toBe("linkSent");
    // A link past its expiry is no link.
    expect(guardianStandingOf({ ...minor, guardianTokenExpiresAt: new Date(NOW.getTime() - 1) }, NOW)).toBe("missing");
    expect(guardianStandingOf({ ...minor, guardianAcceptedAt: NOW }, NOW)).toBe("accepted");
    // Accepted wins over a link still on the row.
    expect(guardianStandingOf({ ...minor, guardianAcceptedAt: NOW, guardianTokenExpiresAt: new Date(NOW.getTime() + 60_000) }, NOW)).toBe("accepted");
    for (const age of [18, 40, null]) expect(guardianStandingOf({ ...minor, age }, NOW), String(age)).toBe("notNeeded");
  });

  it("lets a volunteer be confirmed when they are an adult or their guardian accepted — never a minor without", () => {
    expect(guardianAllowsConfirm({ age: 15, guardianAcceptedAt: null })).toBe(false);
    expect(guardianAllowsConfirm({ age: 15, guardianAcceptedAt: NOW })).toBe(true);
    expect(guardianAllowsConfirm({ age: 17, guardianAcceptedAt: null })).toBe(false);
    expect(guardianAllowsConfirm({ age: 18, guardianAcceptedAt: null })).toBe(true);
    expect(guardianAllowsConfirm({ age: null, guardianAcceptedAt: null })).toBe(true);
  });
});

describe("§768 the two acceptance schemas", () => {
  it("asks the guardian's tick and typed name, the name folded — each the guardian's own act, named apart", () => {
    expect(volunteerGuardianAcceptSchema.parse({ agreement: true, typedName: "  Maria   Popescu ", locale: "ro" })).toEqual({
      agreement: true,
      typedName: "Maria Popescu",
      locale: "ro",
    });
    const noTick = volunteerGuardianAcceptSchema.safeParse({ agreement: false, typedName: "Maria Popescu", locale: "ro" });
    expect(noTick.success).toBe(false);
    if (!noTick.success) expect(refusedFields(noTick.error)).toEqual(["agreement"]);
    const noName = volunteerGuardianAcceptSchema.safeParse({ agreement: true, typedName: "   ", locale: "ro" });
    expect(noName.success).toBe(false);
    if (!noName.success) expect(refusedFields(noName.error)).toEqual(["typedName"]);
    expect(volunteerGuardianAcceptSchema.safeParse({ agreement: true, typedName: "x".repeat(121), locale: "ro" }).success).toBe(false);
  });

  it("leaves the volunteer's age tick to the service: the link of a person under eighteen asks none (their parent accepts beside them)", () => {
    // The schema reads the tick as a boolean; whether it is owed depends on the row's age, which `acceptVolunteerAgreementByLink` knows.
    expect(volunteerAgreementAcceptSchema.parse({ agreement: true, locale: "ro" })).toMatchObject({ agreement: true, adult: false });
    expect(volunteerAgreementAcceptSchema.parse({ agreement: true, adult: true, locale: "en" }).adult).toBe(true);
    expect(volunteerAgreementAcceptSchema.safeParse({ agreement: false, adult: true, locale: "ro" }).success).toBe(false);
  });
});

describe("§768 every refused box is named in one pass, and the text read decides the age it says", () => {
  it("names the parent's boxes together with a sex that is no answer — never a second refusal for the same form", () => {
    const verdict = volunteerPublicProfileSchemaFor(true).safeParse({ ...PUBLIC, sex: "ROBOT", age: "15" });
    expect(verdict.success).toBe(false);
    if (!verdict.success) expect(refusedFields(verdict.error)).toEqual(["sex", "guardianName", "guardianEmail", "guardianAware"]);
    const staff = volunteerStaffInputSchema.safeParse({ roleIds: [ID], assignedRoleId: "", name: "Ana Test", email: "ana@example.test", phone: "+40712345678", note: "", age: "15", sex: "ROBOT" });
    expect(staff.success).toBe(false);
    if (!staff.success) expect(refusedFields(staff.error)).toEqual(["sex", "guardianName"]);
    // While the club cannot take a minor the guardian's boxes are not asked: the age alone.
    const closed = volunteerPublicProfileSchemaFor(false).safeParse({ ...PUBLIC, sex: "ROBOT", age: "15" });
    if (!closed.success) expect(refusedFields(closed.error)).toEqual(["sex", "age"]);
  });

  it("says fourteen in a text that carries the minors' clause and eighteen in one that does not", () => {
    const body = (paragraph: string) => ({ sections: [{ paragraphs: [paragraph] }] });
    expect(agreementMinimumAge(body("Voluntarul fiind minor, părintele, {{volunteerGuardian}}, își dă acordul."))).toBe(VOLUNTEER_MINIMUM_AGE);
    expect(agreementMinimumAge(body("Voluntarul este {{minimumAge}}."))).toBe(VOLUNTEER_ADULT_AGE);
    expect(agreementMinimumAge(null)).toBe(VOLUNTEER_ADULT_AGE);
  });

  it("knows a guardian's address that is the volunteer's own mailbox, through the canonicalizer", () => {
    expect(guardianSharesAddress("dan@example.test", "DAN@example.test")).toBe(true);
    expect(guardianSharesAddress("dan@example.test", "maria@example.test")).toBe(false);
    expect(guardianSharesAddress("dan@example.test", null)).toBe(false);
    expect(guardianSharesAddress("dan@example.test", "not an address")).toBe(false);
  });
});
