import { describe, expect, it } from "vitest";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { volunteersFileSchema } from "@/modules/content/events/transfer/file-format";
import {
  openChoices,
  refusedFields,
  roleNeededFrom,
  roleTakesPeople,
  someRoleNeedsPeople,
  standingOf,
  volunteerBoxRoles,
  volunteerOfferClosedFor,
  volunteerRoleInputSchema,
} from "@/modules/volunteers/domain/volunteer";
import { badgePrintDefault, printBoxes, readPrintCounts } from "@/modules/volunteers/badges/badges";

/**
 * §NNN — a volunteer role «fără număr»: the role's needed count is optional, NULL meaning any number of people. The rules of
 * the domain that read it: the role's form (the tick decides, never the box), a role's standing («free» is null: never full), the
 * public form (never stops offering it), the badges' default («Câte ecusoane» starts at the people given the role), the event file.
 */
const ROLE = { nameRo: "Punct de apă", nameEn: "Water point", needed: "4", descriptionRo: "", descriptionEn: "" };

describe("§NNN the role's form: a number, or the tick «Fără număr»", () => {
  it("reads a typed number as before, and an old caller without the tick as unticked", () => {
    expect(volunteerRoleInputSchema.parse(ROLE)).toMatchObject({ needed: 4 });
    expect(volunteerRoleInputSchema.parse({ ...ROLE, needed: " 4 ", unlimited: "" })).toMatchObject({ needed: 4 });
  });

  it("reads the tick as no number, whatever the box holds — the server decides by the tick", () => {
    for (const needed of ["", "4", "  ", "0", "x", "-3", "99999"]) {
      expect(volunteerRoleInputSchema.parse({ ...ROLE, needed, unlimited: "on" }), needed).toMatchObject({ needed: null });
    }
    // A post that omits the number box altogether, as a disabled box is omitted: ticked, it is no refusal; unticked, it is the number's.
    const { needed: _needed, ...withoutBox } = ROLE;
    expect(volunteerRoleInputSchema.parse({ ...withoutBox, unlimited: "on" })).toMatchObject({ needed: null });
    const unticked = volunteerRoleInputSchema.safeParse(withoutBox);
    expect(unticked.success).toBe(false);
    if (!unticked.success) expect(refusedFields(unticked.error)).toEqual(["needed"]);
  });

  it("refuses neither a number nor the tick at the number's box, and a number out of range unticked", () => {
    for (const needed of ["", "0", "1.5", "four", "1001"]) {
      const verdict = volunteerRoleInputSchema.safeParse({ ...ROLE, needed, unlimited: "" });
      expect(verdict.success, needed).toBe(false);
      if (!verdict.success) expect(refusedFields(verdict.error), needed).toEqual(["needed"]);
    }
    // Only the tick's own word is a tick: anything else is no tick.
    expect(volunteerRoleInputSchema.safeParse({ ...ROLE, needed: "", unlimited: "yes" }).success).toBe(false);
    expect(volunteerRoleInputSchema.safeParse({ ...ROLE, needed: "1000" }).success).toBe(true);
  });

  it("reads a typed number as a whole number from 1 to the bound, or not at all", () => {
    expect(roleNeededFrom("1")).toBe(1);
    expect(roleNeededFrom("1000")).toBe(1000);
    for (const typed of ["", "0", "1001", "2.5", "-1", "a", " 3"]) expect(roleNeededFrom(typed), typed).toBeUndefined();
  });
});

describe("§NNN how a role without a number stands", () => {
  const role = { id: "r1", needed: null };
  const people = (count: number, state: "REGISTERED" | "CONFIRMED" | "CANCELLED" = "CONFIRMED") =>
    Array.from({ length: count }, () => ({ roleId: "r1", state }));

  it("counts the people given the role and has no places left to count: free is null, never zero", () => {
    expect(standingOf(role, [])).toEqual({ roleId: "r1", needed: null, taken: 0, confirmed: 0, free: null });
    expect(standingOf(role, people(40))).toMatchObject({ taken: 40, confirmed: 40, free: null });
    expect(standingOf(role, [...people(2, "REGISTERED"), ...people(3, "CANCELLED")])).toMatchObject({ taken: 2, confirmed: 0, free: null });
  });

  it("keeps a numbered role as it was: free falls to zero and stays there", () => {
    expect(standingOf({ id: "r1", needed: 3 }, people(5))).toMatchObject({ taken: 5, free: 0 });
    expect(standingOf({ id: "r1", needed: 3 }, people(1))).toMatchObject({ taken: 1, free: 2 });
  });

  it("takes people while it has no number, whatever it was given; a numbered role while it has places", () => {
    expect(roleTakesPeople({ free: null })).toBe(true);
    expect(roleTakesPeople({ free: 2 })).toBe(true);
    expect(roleTakesPeople({ free: 0 })).toBe(false);
    expect(roleTakesPeople(undefined)).toBe(false);
    expect(someRoleNeedsPeople([{ free: 0 }, { free: null }])).toBe(true);
    expect(someRoleNeedsPeople([{ free: 0 }])).toBe(false);
  });

  it("is never dropped from a sign-up, even with fifty people on it, while a full numbered role is", () => {
    const standings = new Map([
      ["open", standingOf(role, people(50))],
      ["full", standingOf({ id: "r1", needed: 1 }, people(1))],
    ]);
    expect(openChoices(["full", "open", "unknown"], standings)).toEqual(["open"]);
  });

  it("keeps the public form open for an event whose only role has no number, and the page's list of roles", () => {
    const base = {
      acceptsVolunteers: true,
      noticeDescribes: true,
      agreementInForce: true,
      noticeDescribesAgreement: true,
      eventAhead: true,
      published: true,
      membersOnly: false,
    };
    expect(volunteerOfferClosedFor({ ...base, standings: [{ free: null }] })).toBeNull();
    expect(volunteerOfferClosedFor({ ...base, standings: [{ free: 0 }] })).toBe("noRoleNeeds");
    const roles = [{ id: "a", free: 0 }, { id: "b", free: null }, { id: "c", free: 3 }];
    expect(volunteerBoxRoles(null, roles, null)?.map((role) => role.id)).toEqual(["b", "c"]);
  });
});

describe("§NNN the badges' «Câte ecusoane» default", () => {
  it("starts a role with a number at what it needs, and one without at the people given it, within one pile", () => {
    expect(badgePrintDefault({ needed: 3, assigned: 9 })).toBe(3);
    expect(badgePrintDefault({ needed: null, assigned: 9 })).toBe(9);
    expect(badgePrintDefault({ needed: null, assigned: 0 })).toBe(0);
    expect(badgePrintDefault({ needed: null, assigned: 5000 })).toBe(300);
  });

  it("reads the print form with the box absent as the default, and a typed number as typed", () => {
    const roles = [
      { id: "n", needed: 2, assigned: 0 },
      { id: "u", needed: null, assigned: 7 },
    ];
    const absent = readPrintCounts(new URLSearchParams(), roles);
    if ("refused" in absent) throw new Error("the defaults are never a refusal");
    expect(absent.roles.get("n")).toEqual({ count: 2, spares: 0 });
    expect(absent.roles.get("u")).toEqual({ count: 7, spares: 0 });
    const typed = readPrintCounts(new URLSearchParams({ [printBoxes.count("u")]: "12" }), roles);
    if ("refused" in typed) throw new Error("a typed number in range is never a refusal");
    expect(typed.roles.get("u")).toEqual({ count: 12, spares: 0 });
  });
});

describe("§NNN the event's file", () => {
  const file = (needed: number | null) => ({
    categories: [],
    roles: [{ name: { ro: "Punct de apă", en: "Water point" }, needed, description: { ro: null, en: null }, colour: null, category: null }],
  });

  it("carries null for a role without a number and reads it back, the same file", () => {
    const parsed = volunteersFileSchema.parse(JSON.parse(JSON.stringify(file(null))));
    expect(parsed.roles[0].needed).toBeNull();
    expect(volunteersFileSchema.parse(JSON.parse(JSON.stringify(file(4)))).roles[0].needed).toBe(4);
  });

  it("still refuses a number that is no number of people", () => {
    for (const needed of [0, -1, 1001, 2.5]) expect(volunteersFileSchema.safeParse(file(needed)).success, String(needed)).toBe(false);
  });
});

describe("§NNN the words", () => {
  const catalogues = { ro, en } as const;
  const path = (root: unknown, keys: string[]) => keys.reduce<unknown>((at, key) => (at as Record<string, unknown> | undefined)?.[key], root);
  const KEYS = [
    ["Admin", "volunteers", "summaryPlusNoNumber"],
    ["Admin", "volunteers", "summaryOnlyNoNumber"],
    ["Admin", "volunteers", "standingNoNumber"],
    ["Admin", "volunteers", "assign", "standingNoNumber"],
    ["Admin", "volunteers", "role", "unlimited"],
    ["Admin", "volunteers", "role", "unlimitedHelp"],
    ["Admin", "volunteers", "role", "neededHelp"],
    ["Admin", "badges", "print", "countHelpNoNumber"],
    ["Admin", "badges", "print", "introNoNumber"],
  ];

  it("has every new sentence in both languages, short, and the tick named as the owner asked", () => {
    for (const keys of KEYS) {
      for (const language of ["ro", "en"] as const) {
        const words = path(catalogues[language], keys);
        expect(typeof words, `${language} ${keys.join(".")}`).toBe("string");
        for (const sentence of (words as string).split(/(?<=[.!?])\s+/)) expect(sentence.length, `${language} ${keys.join(".")}`).toBeLessThanOrEqual(200);
      }
    }
    expect(ro.Admin.volunteers.role.unlimited).toBe("Fără număr — oricâți oameni");
    expect(en.Admin.volunteers.role.unlimited).toBe("No limit — any number of people");
    // The help names both ways, the number and the tick.
    expect(ro.Admin.volunteers.role.neededHelp).toContain("Cel puțin 1");
    expect(ro.Admin.volunteers.role.neededHelp).toContain("Fără număr");
    expect(en.Admin.volunteers.role.neededHelp).toContain("At least 1");
    expect(en.Admin.volunteers.role.neededHelp).toContain("No limit");
  });

  it("keeps the placeholders of every new sentence the same in both languages", () => {
    const holes = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
    for (const keys of KEYS) expect(holes(path(ro, keys) as string), keys.join(".")).toEqual(holes(path(en, keys) as string));
  });
});
