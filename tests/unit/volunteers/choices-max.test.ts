import { describe, expect, it } from "vitest";
import { countForm } from "@/i18n/count-form";
import {
  choicesOverMax,
  isVolunteerChoicesMax,
  refusedFields,
  VOLUNTEER_CHOICES_MAX_HIGHEST,
  VOLUNTEER_CHOICES_MAX_LOWEST,
  VOLUNTEER_ROLES_MAX,
  volunteerPublicInputSchema,
  volunteerPublicProfileSchemaFor,
  volunteerPublicSchemaFor,
  volunteerStaffInputSchemaFor,
} from "@/modules/volunteers/domain/volunteer";
import { bornAgedOn } from "../../helpers/volunteer-birth";

/**
 * §951 — «Cel mult câte roluri poate bifa o persoană» (amending §761; the owner, 2026-11-16: «voluntarii primesc prea multe
 * roluri» — «Bifează prea multe pe formular»), the pure part (BR-REQ-031-01, BR-REQ-050-02): what may be a limit, how a post's
 * roles are counted against it, and the two shapes of the public form refusing a post over it on the roles' own box — while
 * the organizers' form never asks. No database.
 */
const EVENT_DAY = "2026-11-21";
const ids = (count: number) => Array.from({ length: count }, (_, index) => `5d7a2f64-3b0c-4f25-9d57-0a9a6b3a${String(index).padStart(4, "0")}`);
const [A, B, C] = ids(3);

const legacy = { name: "Ana Test", email: "ana@example.test", phone: "+40712345678", message: "", locale: "ro", consent: true, agreement: true, adult: true };
const profile = { ...legacy, adult: undefined, birthDate: bornAgedOn(34, EVENT_DAY), sex: "FEMALE", city: "Brașov" };

describe("§951 what may be an event's limit", () => {
  it("is none, or a whole number from one to twenty", () => {
    expect([VOLUNTEER_CHOICES_MAX_LOWEST, VOLUNTEER_CHOICES_MAX_HIGHEST]).toEqual([1, 20]);
    for (const value of [null, 1, 2, 10, 19, 20]) expect(isVolunteerChoicesMax(value), String(value)).toBe(true);
    for (const value of [0, -1, 21, 100, 1.5, 2.0000001, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) expect(isVolunteerChoicesMax(value), String(value)).toBe(false);
    // Under what an event may define: a limit never asks for more roles than a form can offer.
    expect(VOLUNTEER_CHOICES_MAX_HIGHEST).toBeLessThanOrEqual(VOLUNTEER_ROLES_MAX);
  });

  it("has a form of words for every number it may be, in both languages' counting", () => {
    const forms = (locale: string) => Array.from({ length: VOLUNTEER_CHOICES_MAX_HIGHEST }, (_, index) => countForm(index + 1, locale));
    expect(forms("ro")).toEqual(["one", ...Array.from({ length: 18 }, () => "few"), "other"]);
    expect(forms("en")).toEqual(["one", ...Array.from({ length: 19 }, () => "other")]);
  });
});

describe("§951 how a post's roles are counted against the limit", () => {
  it("is never over while the event has no limit", () => {
    for (const max of [null, undefined]) {
      expect(choicesOverMax([], max)).toBe(false);
      expect(choicesOverMax(ids(30), max)).toBe(false);
    }
  });

  it("is over only past the limit: under it and at it pass", () => {
    expect(choicesOverMax([], 1)).toBe(false);
    expect(choicesOverMax([A], 1)).toBe(false);
    expect(choicesOverMax([A, B], 1)).toBe(true);
    expect(choicesOverMax([A], 2)).toBe(false);
    expect(choicesOverMax([A, B], 2)).toBe(false);
    expect(choicesOverMax([A, B, C], 2)).toBe(true);
    expect(choicesOverMax(ids(20), 20)).toBe(false);
    expect(choicesOverMax(ids(21), 20)).toBe(true);
  });

  it("counts a role once however many times its id came, trims it, and counts an empty value as none — the draft's «a,b,» split is the post's own count", () => {
    expect(choicesOverMax([A, A, A], 1)).toBe(false);
    expect(choicesOverMax([A, ` ${A} `, B], 2)).toBe(false);
    expect(choicesOverMax([A, B, A, C], 2)).toBe(true);
    expect(choicesOverMax("".split(","), 1)).toBe(false);
    expect(choicesOverMax(`${A},`.split(","), 1)).toBe(false);
    expect(choicesOverMax(`${A},${B},,${A}`.split(","), 2)).toBe(false);
    expect(choicesOverMax(`${A},${B},${C}`.split(","), 2)).toBe(true);
  });
});

describe("§951 the public form's schema under a limit", () => {
  it("is the form it always was while the event has no limit — the very same schema", () => {
    expect(volunteerPublicSchemaFor({ profile: false, minors: false, eventDay: EVENT_DAY })).toBe(volunteerPublicInputSchema);
    expect(volunteerPublicSchemaFor({ profile: false, minors: false, eventDay: EVENT_DAY, choicesMax: null })).toBe(volunteerPublicInputSchema);
    expect(volunteerPublicSchemaFor({ profile: false, minors: false, eventDay: EVENT_DAY, choicesMax: 2 })).not.toBe(volunteerPublicInputSchema);
    for (const schema of [volunteerPublicInputSchema, volunteerPublicSchemaFor({ profile: true, minors: false, eventDay: EVENT_DAY }), volunteerPublicProfileSchemaFor(false, EVENT_DAY)]) {
      expect(schema.safeParse({ ...(schema === volunteerPublicInputSchema ? legacy : profile), roleIds: ids(VOLUNTEER_ROLES_MAX) }).success).toBe(true);
    }
  });

  it.each([
    ["§758's form", { profile: false, minors: false }, legacy],
    ["the profile's form", { profile: true, minors: false }, profile],
    ["the profile's form with the minors' path", { profile: true, minors: true }, profile],
  ] as const)("%s: refuses a post over the limit on `roleIds`, and takes one at it and one under it", (_name, mode, boxes) => {
    const schema = volunteerPublicSchemaFor({ ...mode, eventDay: EVENT_DAY, choicesMax: 2 });
    const over = schema.safeParse({ ...boxes, roleIds: [A, B, C] });
    expect(over.success).toBe(false);
    if (!over.success) expect(refusedFields(over.error)).toEqual(["roleIds"]);
    expect(schema.parse({ ...boxes, roleIds: [A, B] }).roleIds).toEqual([A, B]);
    expect(schema.parse({ ...boxes, roleIds: [B] }).roleIds).toEqual([B]);
    // The same id twice is one role: three posted, two distinct, within a limit of two.
    expect(schema.parse({ ...boxes, roleIds: [A, B, A] }).roleIds).toEqual([A, B]);
    // No role at all is still the box's refusal — the limit takes nothing away from «cel puțin un rol».
    const none = schema.safeParse({ ...boxes, roleIds: [] });
    expect(none.success).toBe(false);
    if (!none.success) expect(refusedFields(none.error)).toEqual(["roleIds"]);
    // …and so is an id that is none.
    const junk = schema.safeParse({ ...boxes, roleIds: ["nope"] });
    if (!junk.success) expect(refusedFields(junk.error)).toEqual(["roleIds"]);
    expect(junk.success).toBe(false);
  });

  it("names the roles' box with every other box that failed, in one pass", () => {
    const schema = volunteerPublicSchemaFor({ profile: true, minors: false, eventDay: EVENT_DAY, choicesMax: 1 });
    const verdict = schema.safeParse({ ...profile, roleIds: [A, B], name: " ", consent: false, sex: "ROBOT" });
    expect(verdict.success).toBe(false);
    if (!verdict.success) expect(refusedFields(verdict.error).sort()).toEqual(["consent", "name", "roleIds", "sex"]);
  });

  it("holds each limit of the range exactly", () => {
    for (const max of [1, 2, 5, 20]) {
      const schema = volunteerPublicSchemaFor({ profile: false, minors: false, eventDay: EVENT_DAY, choicesMax: max });
      expect(schema.safeParse({ ...legacy, roleIds: ids(max) }).success, `${max} at`).toBe(true);
      expect(schema.safeParse({ ...legacy, roleIds: ids(max + 1) }).success, `${max} over`).toBe(false);
    }
  });

  it("never limits the organizers' form: the staff entry reads the roles ticked and the roles given bare", () => {
    const staff = volunteerStaffInputSchemaFor(EVENT_DAY);
    const entry = staff.parse({ roleIds: ids(12), assignedRoleIds: ids(7), name: "Ion Adăugat", email: "", phone: "" });
    expect(entry.roleIds).toHaveLength(12);
    expect(entry.assignedRoleIds).toHaveLength(7);
    // Its one bound on the roles is what an event may define, as it always was.
    expect(staff.safeParse({ roleIds: ids(VOLUNTEER_ROLES_MAX), assignedRoleIds: [], name: "Ion Adăugat" }).success).toBe(true);
    expect(staff.safeParse({ roleIds: ids(VOLUNTEER_ROLES_MAX + 1), assignedRoleIds: [], name: "Ion Adăugat" }).success).toBe(false);
  });
});
