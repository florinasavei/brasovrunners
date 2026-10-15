import { describe, expect, it } from "vitest";
import { type BadgeDesign, badgePhoneLine, badgeWords, DEFAULT_BADGE_DESIGN } from "@/modules/volunteers/badges/badge-design";
import {
  agreementRoleWords,
  agreementStillNamesRole,
  categoryContactOf,
  compareCategories,
  contactParts,
  groupRolesByCategory,
  groupsNeedHeadings,
  roleLabel,
  roleNames,
  rolesWithCategoryWords,
  volunteerCategoryContactSchema,
  volunteerCategoryInputSchema,
  volunteerContactsOf,
} from "@/modules/volunteers/domain/volunteer";

/**
 * §NNN — an event's volunteer roles in configurable categories, each with a contact person (the owner, 2026-10-14: «categorii cu
 * sub-categorii … Toate astea configurabile», «trebuie să fie o persoană de contact pentru voluntari»): the pure rules — how roles
 * group under their headings, how a role is named alone, the contact persons a message names, the contact's boxes, and the badge's
 * telephone defaulting to the category's.
 */

const at = (id: string, sort: number, minute = 0) => ({ id, sort, createdAt: new Date(Date.UTC(2026, 9, 14, 8, minute)) });
const START = { ...at("c-start", 0), nameRo: "Start / Sosire", nameEn: "Start / Finish" };
const ROUTE = { ...at("c-route", 1), nameRo: "Traseu", nameEn: "Route" };
const EMPTY = { ...at("c-empty", 2), nameRo: "Goală", nameEn: "Empty" };

const role = (id: string, categoryId: string | null, nameRo = "Direcționare", nameEn = "Guidance") => ({ id, categoryId, nameRo, nameEn, descriptionRo: null, descriptionEn: null });

describe("§NNN the order of categories", () => {
  it("is the club's `sort`, then age, then the id — a total order", () => {
    const sorted = [at("b", 1), at("a", 1, 5), at("c", 0, 9), at("a2", 1, 5)].sort(compareCategories).map((row) => row.id);
    expect(sorted).toEqual(["c", "b", "a", "a2"]);
  });
});

describe("§NNN the roles under their categories", () => {
  const roles = [role("r1", "c-route"), role("r2", "c-start"), role("r3", null, "Foto/Video", "Photo/Video"), role("r4", "c-route", "Punct de hidratare", "Water point"), role("r5", "c-gone")];

  it("groups them in the category order, the roles in the order they come in, and the roles under none — or under a category that is not there — last", () => {
    const groups = groupRolesByCategory([START, ROUTE, EMPTY], roles);
    expect(groups.map((group) => [group.category?.id ?? null, group.roles.map((row) => row.id)])).toEqual([
      ["c-start", ["r2"]],
      ["c-route", ["r1", "r4"]],
      ["c-empty", []],
      [null, ["r3", "r5"]],
    ]);
  });

  it("leaves out a category with no role when the form asks (`withRoles`): the public form shows only the headings that have a role to tick", () => {
    const groups = groupRolesByCategory([START, ROUTE, EMPTY], roles, { withRoles: true });
    expect(groups.map((group) => group.category?.id ?? null)).toEqual(["c-start", "c-route", null]);
  });

  it("makes no loose group when every role has its category, and one loose group alone for an event with no category", () => {
    expect(groupRolesByCategory([START], [role("r1", "c-start")]).map((group) => group.category?.id)).toEqual(["c-start"]);
    const flat = groupRolesByCategory([], roles);
    expect(flat).toHaveLength(1);
    expect(flat[0]).toMatchObject({ category: null });
    expect(flat[0].roles).toHaveLength(5);
    expect(groupRolesByCategory([], [], { withRoles: true })).toEqual([]);
  });

  it("draws headings only when the event has a category: a single loose group is simply listed", () => {
    expect(groupsNeedHeadings(groupRolesByCategory([], roles))).toBe(false);
    expect(groupsNeedHeadings(groupRolesByCategory([START], roles))).toBe(true);
    // The public form drops the empty ones first; what is left may be the loose group alone — no heading then either.
    expect(groupsNeedHeadings(groupRolesByCategory([START], [role("r1", null)], { withRoles: true }))).toBe(false);
  });

  it("lists the roles in the card's order with the words of their category", () => {
    const listed = rolesWithCategoryWords([START, ROUTE], roles);
    expect(listed.map((row) => [row.id, row.categoryRo, row.categoryEn])).toEqual([
      ["r2", "Start / Sosire", "Start / Finish"],
      ["r1", "Traseu", "Route"],
      ["r4", "Traseu", "Route"],
      ["r3", null, null],
      ["r5", null, null],
    ]);
  });
});

describe("§NNN a role named alone", () => {
  const guidance = { nameRo: "Direcționare", nameEn: "Guidance", descriptionRo: null, descriptionEn: null, categoryRo: "Traseu", categoryEn: "Route" };
  const photo = { nameRo: "Foto/Video", nameEn: "Photo/Video", descriptionRo: null, descriptionEn: null, categoryRo: null, categoryEn: null };

  it("says its category in brackets, in the language asked — and its name alone under none", () => {
    expect(roleLabel(guidance, "ro")).toBe("Direcționare (Traseu)");
    expect(roleLabel(guidance, "en")).toBe("Guidance (Route)");
    expect(roleLabel(photo, "ro")).toBe("Foto/Video");
    // A role read before the categories existed has no such words at all.
    expect(roleLabel({ nameRo: "Masă", nameEn: "Desk" }, "ro")).toBe("Masă");
  });

  it("is what the agreement's sentences name: the role given, the roles chosen and their tasks", () => {
    expect(roleNames([guidance, photo], "ro")).toBe("Direcționare (Traseu), Foto/Video");
    const given = agreementRoleWords({ assigned: { ...guidance, descriptionRo: "Arăți drumul.", descriptionEn: "Show the way." }, chosen: [] }, "ro", true);
    expect(given).toMatchObject({ role: "Direcționare (Traseu)", tasks: "Arăți drumul" });
    const chosen = agreementRoleWords({ assigned: null, chosen: [{ ...guidance, descriptionRo: "Arăți drumul." }, photo] }, "en", true);
    expect(chosen.choices).toBe("Guidance (Route), Photo/Video");
    expect(chosen.choiceTasks).toBe("");
    const withTasks = agreementRoleWords({ assigned: null, chosen: [{ ...guidance, descriptionEn: "Show the way." }, photo] }, "en", true);
    expect(withTasks.choiceTasks).toBe("Guidance (Route) — Show the way");
    // An earlier text with no sentence of its own for the choices puts the same names in the role's blank.
    expect(agreementRoleWords({ assigned: null, chosen: [guidance] }, "ro", false).role).toBe("Direcționare (Traseu)");
  });

  it("is compared with what an accepted agreement named, so a role moved to another category says the accepted text named another", () => {
    const person = { assigned: { ...guidance, id: "r1" }, chosen: [{ ...guidance, id: "r1" }] };
    expect(agreementStillNamesRole("Direcționare (Traseu)", person, "ro")).toBe(true);
    // The role was under no category when it was accepted: the name alone no longer matches the one it has now.
    expect(agreementStillNamesRole("Direcționare", person, "ro")).toBe(false);
    expect(agreementStillNamesRole("Direcționare", { assigned: { ...guidance, id: "r1", categoryRo: null, categoryEn: null }, chosen: [] }, "ro")).toBe(true);
  });
});

describe("§NNN the contact person of a category", () => {
  it("is none until the club sets one of its three boxes — and then the three as set", () => {
    expect(categoryContactOf({ contactName: null, contactPhone: null, contactEmail: null })).toBeNull();
    expect(categoryContactOf({ contactName: "Ana", contactPhone: null, contactEmail: null })).toEqual({ name: "Ana", phone: null, email: null });
  });

  it("is said in the order name, telephone, address, leaving out what is not set", () => {
    expect(contactParts({ name: "Ana", phone: "+40712345678", email: "ana@club.test" })).toEqual(["Ana", "+40712345678", "ana@club.test"]);
    expect(contactParts({ name: null, phone: "+40712345678", email: null })).toEqual(["+40712345678"]);
  });

  it("is read from the form: every box optional, an empty one is null, an address must be one, a number is bounded and never parsed", () => {
    expect(volunteerCategoryContactSchema.parse({ contactName: "  Ana  Popa ", contactPhone: "", contactEmail: " ana@club.test " })).toEqual({
      contactName: "Ana Popa",
      contactPhone: null,
      contactEmail: "ana@club.test",
    });
    expect(volunteerCategoryContactSchema.parse({ contactName: "", contactPhone: "", contactEmail: "" })).toEqual({ contactName: null, contactPhone: null, contactEmail: null });
    expect(volunteerCategoryContactSchema.safeParse({ contactName: "", contactPhone: "", contactEmail: "not an address" }).success).toBe(false);
    expect(volunteerCategoryContactSchema.safeParse({ contactName: "", contactPhone: "0".repeat(41), contactEmail: "" }).success).toBe(false);
    expect(volunteerCategoryContactSchema.safeParse({ contactName: "x".repeat(121), contactPhone: "", contactEmail: "" }).success).toBe(false);
    // A landline, a foreign number: the club's to write.
    expect(volunteerCategoryContactSchema.parse({ contactName: "", contactPhone: "+44 20 7946 0000", contactEmail: "" }).contactPhone).toBe("+44 20 7946 0000");
  });

  it("is what a volunteer's message names: the category of the role given — else of the roles offered for — each person once, none for a role under no category", () => {
    const ana = { name: "Ana", phone: "+40712345678", email: null };
    const dan = { name: "Dan", phone: null, email: "dan@club.test" };
    expect(volunteerContactsOf({ assigned: { contact: ana }, chosen: [{ contact: dan }] })).toEqual([ana]);
    expect(volunteerContactsOf({ assigned: null, chosen: [{ contact: ana }, { contact: dan }, { contact: { ...ana } }, { contact: null }, {}] })).toEqual([ana, dan]);
    expect(volunteerContactsOf({ assigned: { contact: null }, chosen: [{ contact: dan }] })).toEqual([]);
    expect(volunteerContactsOf({ assigned: null, chosen: [] })).toEqual([]);
  });
});

describe("§NNN a category's names", () => {
  it("takes both languages, trimmed and folded, each at most 80 characters — one alone is refused naming its box", () => {
    expect(volunteerCategoryInputSchema.parse({ nameRo: "  Start  /  Sosire ", nameEn: "Start / Finish" })).toEqual({ nameRo: "Start / Sosire", nameEn: "Start / Finish" });
    const missing = volunteerCategoryInputSchema.safeParse({ nameRo: "Traseu", nameEn: "  " });
    expect(missing.success).toBe(false);
    expect(volunteerCategoryInputSchema.safeParse({ nameRo: "x".repeat(81), nameEn: "y" }).success).toBe(false);
  });
});

describe("§NNN the coordinator's telephone on a role's badge", () => {
  const defaults = { label: "VOLUNTAR", name: "Nume:", phoneLabel: "Coordonator" };
  const design = (over: Partial<BadgeDesign>): BadgeDesign => ({ ...DEFAULT_BADGE_DESIGN, ...over });

  it("is the design's own number when the club typed one — the same on every role, whatever the category says", () => {
    const typed = design({ showPhone: true, phone: "0712 345 678" });
    const words = badgeWords(typed, "ro", "Crosul", defaults);
    expect(badgePhoneLine(typed, words, "0799 000 111")).toBe("Coordonator: 0712 345 678");
    expect(badgePhoneLine(typed, words, null)).toBe("Coordonator: 0712 345 678");
  });

  it("defaults to the telephone of the role's category when the tick is on and the design leaves the number empty, with the same label", () => {
    const empty = design({ showPhone: true, phone: "", phoneLabelRo: "Șef traseu", phoneLabelEn: "Route lead" });
    expect(badgePhoneLine(empty, badgeWords(empty, "ro", "Crosul", defaults), "0799 000 111")).toBe("Șef traseu: 0799 000 111");
    expect(badgePhoneLine(empty, badgeWords(empty, "en", "Crosul", { ...defaults, phoneLabel: "Coordinator" }), "+40799000111")).toBe("Route lead: +40799000111");
    // The platform's word when the club typed no label.
    const unlabelled = design({ showPhone: true });
    expect(badgePhoneLine(unlabelled, badgeWords(unlabelled, "ro", "Crosul", defaults), "0799 000 111")).toBe("Coordonator: 0799 000 111");
  });

  it("is none for a role under no category, a category with no telephone, or a number that is no number — and never while the tick is off", () => {
    const empty = design({ showPhone: true });
    const words = badgeWords(empty, "ro", "Crosul", defaults);
    expect(badgePhoneLine(empty, words, null)).toBeNull();
    expect(badgePhoneLine(empty, words, undefined)).toBeNull();
    expect(badgePhoneLine(empty, words, "call me")).toBeNull();
    const off = design({ showPhone: false });
    expect(badgePhoneLine(off, badgeWords(off, "ro", "Crosul", defaults), "0799 000 111")).toBeNull();
  });
});
