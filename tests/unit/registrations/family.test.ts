import { describe, expect, it } from "vitest";
import type { RegistrationStatus } from "@/db/schema/registrations";
import {
  ADDRESS_CAP_RULE,
  addressCapSettingSchema,
  addressHasRoom,
  DEFAULT_ADDRESS_CAP,
  readAddressCapValue,
} from "@/modules/registrations/domain/address-cap";
import { decideSubmission, type FamilyRow } from "@/modules/registrations/domain/family";
import { registrationNameKey, sameRunner } from "@/modules/registrations/domain/name-key";

/**
 * §389 — a family on one address (BR-REQ-032-03, BR-REQ-034-02, BR-REQ-036-02): the runner's key,
 * the club's limit per address and its bounds, and the decision every submission is put through.
 */

describe("§389 the runner's key on an address", () => {
  it("folds what a keyboard does and nothing a person decides (foldName, §179, §314)", () => {
    expect(registrationNameKey("Ștefan  Pop")).toBe("stefan pop");
    expect(sameRunner("Ștefan Pop", "STEFAN POP")).toBe(true);
    expect(sameRunner("Ştefan Pop", "stefan pop")).toBe(true); // the cedilla spelling
    expect(sameRunner("  Ana Pop ", "ana pop")).toBe(true);
    expect(sameRunner("O'Brien Ana", "O’Brien Ana")).toBe(true);
  });

  it("keeps two runners two: another name, another order, another hyphen", () => {
    expect(sameRunner("Ana Pop", "Maria Pop")).toBe(false);
    expect(sameRunner("Pop Ana", "Ana Pop")).toBe(false);
    expect(sameRunner("Ana-Maria Pop", "Ana Maria Pop")).toBe(false);
  });

  it("is nobody's for an empty name", () => {
    expect(sameRunner("", "")).toBe(false);
    expect(sameRunner("   ", " ")).toBe(false);
  });
});

describe("§389 the club's limit of registrations per address", () => {
  it("is four unless set, between one and ten", () => {
    expect(DEFAULT_ADDRESS_CAP).toEqual({ registrationsPerAddress: 4 });
    expect(ADDRESS_CAP_RULE).toEqual({ min: 1, max: 10, default: 4 });
  });

  it("accepts a whole number inside its bounds, as a number or the digits a box posts", () => {
    for (const value of [1, 4, 10, "1", " 7 ", "10"]) {
      expect(addressCapSettingSchema.safeParse({ registrationsPerAddress: value }).success).toBe(true);
    }
  });

  it("refuses zero, eleven, a fraction, an empty box and anything else in the save", () => {
    for (const value of [0, 11, 2.5, "", " ", "abc", "-1", null]) {
      expect(addressCapSettingSchema.safeParse({ registrationsPerAddress: value }).success).toBe(false);
    }
    expect(addressCapSettingSchema.safeParse({ registrationsPerAddress: 4, extra: 1 }).success).toBe(false);
  });

  it("reads a stored value leniently: out of bounds or unreadable is the default, never a throw", () => {
    expect(readAddressCapValue({ registrationsPerAddress: 6 })).toEqual({ registrationsPerAddress: 6 });
    expect(readAddressCapValue({ registrationsPerAddress: 0 })).toEqual(DEFAULT_ADDRESS_CAP);
    expect(readAddressCapValue({ registrationsPerAddress: 99 })).toEqual(DEFAULT_ADDRESS_CAP);
    expect(readAddressCapValue({ registrationsPerAddress: "4" })).toEqual(DEFAULT_ADDRESS_CAP);
    expect(readAddressCapValue(null)).toEqual(DEFAULT_ADDRESS_CAP);
  });

  it("has room while the address holds fewer active registrations than the limit", () => {
    const cap = { registrationsPerAddress: 2 };
    expect(addressHasRoom(0, cap)).toBe(true);
    expect(addressHasRoom(1, cap)).toBe(true);
    expect(addressHasRoom(2, cap)).toBe(false);
    expect(addressHasRoom(3, cap)).toBe(false);
  });
});

describe("§389 what one submission does on an address", () => {
  let id = 0;
  const row = (registeredName: string, status: RegistrationStatus = "CONFIRMED"): FamilyRow => ({ id: `r${++id}`, status, registeredName });
  const cap = { registrationsPerAddress: 3 };
  const decide = (rows: FamilyRow[], legalName: string, via: "form" | "link" | "staff", familyOpen = true) =>
    decideSubmission({ rows, legalName, via, familyOpen, cap });

  it("a first registration on the address is created, whichever door", () => {
    for (const via of ["form", "link", "staff"] as const) expect(decide([], "Ana Pop", via).kind).toBe("insert");
  });

  it("(a) the same runner again from the form is today's re-send, whatever the spelling", () => {
    const ana = row("Ana Pop", "PENDING_DECLARATION");
    expect(decide([ana], "ANA  POP", "form")).toEqual({ kind: "resend", registration: ana });
  });

  it("(b) another runner on a registered address, from the form, creates nothing and asks the address", () => {
    const ana = row("Ana Pop");
    expect(decide([ana], "Maria Pop", "form")).toEqual({ kind: "offerAnother", about: ana, atCap: false });
  });

  it("(b) at the limit, the email says so instead of offering the link", () => {
    const rows = [row("Ana Pop"), row("Ion Pop", "WAITLISTED"), row("Dan Pop", "PENDING_EMAIL_CONFIRMATION")];
    const decision = decide(rows, "Maria Pop", "form");
    expect(decision).toMatchObject({ kind: "offerAnother", atCap: true });
  });

  it("counts only active registrations against the limit: a cancelled or lapsed one frees its slot", () => {
    const rows = [row("Ana Pop"), row("Ion Pop", "CANCELLED"), row("Dan Pop", "EXPIRED"), row("Eva Pop")];
    expect(decide(rows, "Maria Pop", "form")).toMatchObject({ kind: "offerAnother", atCap: false });
    expect(decide(rows, "Maria Pop", "link")).toEqual({ kind: "insert" });
  });

  it("the same runner's cancelled registration, beside an active one, is another person for the form", () => {
    // Bringing it back adds a registration to the address as surely as a new one — the link decides.
    const ion = row("Ion Pop", "CANCELLED");
    const rows = [row("Ana Pop"), ion];
    expect(decide(rows, "Ion Pop", "form")).toMatchObject({ kind: "offerAnother" });
    expect(decide(rows, "Ion Pop", "link")).toEqual({ kind: "restart", registration: ion });
  });

  it("with nobody active on the address, a returning runner restarts their own row and a new one is inserted", () => {
    const ana = row("Ana Pop", "CANCELLED");
    expect(decide([ana], "Ana Pop", "form")).toEqual({ kind: "restart", registration: ana });
    expect(decide([ana], "Maria Pop", "form")).toEqual({ kind: "insert" });
  });

  it("from the link: this runner registered already, or the address at the limit, is refused out loud", () => {
    const rows = [row("Ana Pop"), row("Ion Pop"), row("Dan Pop")];
    expect(decide(rows.slice(0, 1), "ana pop", "link")).toEqual({ kind: "refuseAlreadyRegistered" });
    expect(decide(rows, "Maria Pop", "link")).toEqual({ kind: "refuseAtCap" });
  });

  it("a staff entry racing past its own check re-sends to the one there, as before", () => {
    const ana = row("Ana Pop");
    expect(decide([ana], "Maria Pop", "staff")).toEqual({ kind: "resend", registration: ana });
  });

  it("while the schema holds one registration per address, everything is as it was, and the link cannot be honoured", () => {
    const ana = row("Ana Pop");
    expect(decide([ana], "Maria Pop", "form", false)).toEqual({ kind: "resend", registration: ana });
    const cancelled = row("Ana Pop", "CANCELLED");
    expect(decide([cancelled], "Maria Pop", "form", false)).toEqual({ kind: "restart", registration: cancelled });
    expect(decide([ana], "Maria Pop", "link", false)).toEqual({ kind: "refuseClosed" });
  });
});
