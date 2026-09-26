import { describe, expect, it } from "vitest";
import {
  currentFamilyStep,
  type FamilySigningRow,
  familySigningSteps,
  isFamilyWizard,
  isSignable,
} from "@/modules/registrations/domain/family-signing";
import { openFamilyPass, sealFamilyPass } from "@/modules/registrations/family-signing";

/**
 * §NNN (over §389, §446) — a family's declarations signed as a wizard (BR-REQ-033-02):
 * one stepper over the address's registrations at the event, the opened person first, one person
 * per step, and a pass that carries the wizard from one person to the next.
 */
const at = (minute: number) => new Date(Date.UTC(2026, 8, 26, 10, minute));
const row = (id: string, registeredName: string, status: FamilySigningRow["status"], minute: number): FamilySigningRow => ({
  id,
  registeredName,
  status,
  createdAt: at(minute),
});

describe("§NNN the family's steps", () => {
  const ana = row("a", "Ana Pop", "PENDING_DECLARATION", 1);
  const maria = row("m", "Maria Pop", "PENDING_DECLARATION", 2);
  const ion = row("i", "Ion Pop", "WAITLIST_OFFERED", 3);

  it("puts the opened person first, then the others in the order they registered, and signs the opened one now", () => {
    const steps = familySigningSteps([ion, maria, ana], { originId: "m", originSignable: true, signedIds: [] });
    expect(steps.map((step) => [step.registeredName, step.state])).toEqual([
      ["Maria Pop", "current"],
      ["Ana Pop", "next"],
      ["Ion Pop", "next"],
    ]);
    expect(currentFamilyStep(steps)?.id).toBe("m");
    expect(isFamilyWizard(steps)).toBe(true);
  });

  it("leaves out a person with nothing to sign — an unconfirmed address, a queue without an offer, a cancellation", () => {
    const steps = familySigningSteps(
      [ana, row("u", "Unconfirmed Pop", "PENDING_EMAIL_CONFIRMATION", 4), row("w", "Queued Pop", "WAITLISTED", 5), row("c", "Gone Pop", "CANCELLED", 6)],
      { originId: "a", originSignable: true, signedIds: [] },
    );
    expect(steps.map((step) => step.id)).toEqual(["a"]);
    // One person alone is the page every declaration always had.
    expect(isFamilyWizard(steps)).toBe(false);
  });

  it("once the link is spent, never offers its own person again: the next signable one is current", () => {
    const signedAna = { ...ana, status: "CONFIRMED" as const };
    const steps = familySigningSteps([signedAna, maria, ion], { originId: "a", originSignable: false, signedIds: ["a"] });
    expect(steps.map((step) => step.state)).toEqual(["signed", "current", "next"]);
    expect(currentFamilyStep(steps)?.id).toBe("m");
  });

  it("an origin whose link is spent is never current, even if its row could be signed again", () => {
    const steps = familySigningSteps([ana, maria], { originId: "a", originSignable: false, signedIds: [] });
    expect(steps.map((step) => step.state)).toEqual(["signed", "current"]);
  });

  it("keeps everybody signed in the pass on the list, whatever they became, and has no current step at the end", () => {
    const steps = familySigningSteps(
      [
        { ...ana, status: "CONFIRMED" },
        { ...maria, status: "WAITLISTED" },
        { ...ion, status: "CONFIRMED" },
      ],
      { originId: "a", originSignable: false, signedIds: ["a", "m", "i"] },
    );
    expect(steps.map((step) => [step.id, step.state, step.status])).toEqual([
      ["a", "signed", "CONFIRMED"],
      ["m", "signed", "WAITLISTED"],
      ["i", "signed", "CONFIRMED"],
    ]);
    expect(currentFamilyStep(steps)).toBeNull();
  });

  it("a person who moved on without a signature stays on the list as closed, never current", () => {
    const steps = familySigningSteps([{ ...ana, status: "CONFIRMED" }, { ...maria, status: "EXPIRED" }, ion], {
      originId: "a",
      originSignable: false,
      signedIds: ["a", "m"],
    });
    // Maria was signed in the pass (then lapsed): signed. A stranger's EXPIRED row would not be here at all.
    expect(steps.map((step) => step.state)).toEqual(["signed", "signed", "current"]);
    const opened = familySigningSteps([{ ...ana, status: "EXPIRED" }, maria], { originId: "a", originSignable: true, signedIds: [] });
    expect(opened.map((step) => step.state)).toEqual(["closed", "current"]);
  });

  it("signs from the two states `signDeclaration` accepts, and from no other", () => {
    expect(isSignable("PENDING_DECLARATION")).toBe(true);
    expect(isSignable("WAITLIST_OFFERED")).toBe(true);
    for (const status of ["PENDING_EMAIL_CONFIRMATION", "WAITLISTED", "CONFIRMED", "CANCELLED", "EXPIRED"] as const) {
      expect(isSignable(status)).toBe(false);
    }
  });
});

describe("§NNN the pass (AGENTS.md §13.2 step 4)", () => {
  const pass = {
    participantId: "11111111-1111-4111-8111-111111111111",
    eventId: "22222222-2222-4222-8222-222222222222",
    originId: "33333333-3333-4333-8333-333333333333",
    signedIds: ["33333333-3333-4333-8333-333333333333", "44444444-4444-4444-8444-444444444444"],
    expiresAt: at(40),
  };

  it("round-trips under its own key, sealed, and opens under no other", () => {
    const sealed = sealFamilyPass(pass, "secret-one:family-signing");
    expect(sealed).toBeTruthy();
    expect(sealed).not.toContain(pass.participantId);
    expect(openFamilyPass(sealed as string, at(10), "secret-one:family-signing")).toEqual(pass);
    expect(openFamilyPass(sealed as string, at(10), "secret-two:family-signing")).toBeNull();
    expect(openFamilyPass(`${(sealed as string).slice(0, -2)}AA`, at(10), "secret-one:family-signing")).toBeNull();
  });

  it("is nothing once it has lapsed", () => {
    const sealed = sealFamilyPass(pass, "k") as string;
    expect(openFamilyPass(sealed, at(39), "k")).not.toBeNull();
    expect(openFamilyPass(sealed, at(40), "k")).toBeNull();
  });
});
