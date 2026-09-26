import { createTranslator } from "next-intl";
import { describe, expect, it } from "vitest";
import {
  currentFamilyStep,
  type FamilySigningRow,
  type FamilyStep,
  familySigningSteps,
  familyStepPosition,
  familyStepWordsKey,
  FAMILY_PASS_MINUTES,
  familyPassExpiresAt,
  hasNextFamilyStep,
  isFamilyWizard,
  isSignable,
  signedBefore,
} from "@/modules/registrations/domain/family-signing";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { type FamilySigningPass, openFamilyPass, passFitsLink, sealFamilyPass } from "@/modules/registrations/family-signing";

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

  it("«Semnez mai târziu»: a person put off is shown as later, never current, and the next one is current", () => {
    const steps = familySigningSteps([ana, maria, ion], { originId: "m", originSignable: true, signedIds: [], skippedIds: ["m"] });
    expect(steps.map((step) => [step.id, step.state])).toEqual([
      ["m", "later"],
      ["a", "current"],
      ["i", "next"],
    ]);
    const allPutOff = familySigningSteps([ana, maria, ion], { originId: "m", originSignable: false, signedIds: ["m"], skippedIds: ["a", "i"] });
    expect(allPutOff.map((step) => step.state)).toEqual(["signed", "later", "later"]);
    expect(currentFamilyStep(allPutOff)).toBeNull();
    // Put off, then signed from their own link elsewhere: no longer waiting here.
    const signedElsewhere = familySigningSteps([ana, { ...maria, status: "CONFIRMED" }], { originId: "a", originSignable: false, signedIds: ["a"], skippedIds: ["m"] });
    expect(signedElsewhere.map((step) => step.state)).toEqual(["signed", "closed"]);
  });

  it("walks only the people fixed when the pass was issued — nobody added to the address later", () => {
    const newcomer = row("n", "Newcomer Pop", "PENDING_DECLARATION", 9);
    const steps = familySigningSteps([ana, maria, newcomer], { originId: "a", originSignable: false, signedIds: ["a"], eligibleIds: ["a", "m"] });
    expect(steps.map((step) => step.id)).toEqual(["a", "m"]);
    const fromMine = familySigningSteps([ana, maria, newcomer], { originId: null, originSignable: false, signedIds: [], eligibleIds: ["a", "m", "n"] });
    expect(fromMine.map((step) => [step.id, step.state])).toEqual([
      ["a", "current"],
      ["m", "next"],
      ["n", "next"],
    ]);
  });

  it("shows a person who signed before the wizard began as signed, and counts them in «din M» (found in review)", () => {
    const anaConfirmed = { ...ana, status: "CONFIRMED" as const, declared: true };
    const ionQueued = { ...ion, status: "WAITLISTED" as const, declared: true };
    const steps = familySigningSteps([anaConfirmed, maria, ionQueued], { originId: "m", originSignable: true, signedIds: [] });
    expect(steps.map((step) => [step.id, step.state])).toEqual([
      ["m", "current"],
      ["a", "signed"],
      ["i", "signed"],
    ]);
    expect(familyStepPosition(steps)).toEqual({ step: 1, total: 3 });
    // One person left beside people already signed is still the stepper, never a lone page that hides them.
    expect(isFamilyWizard(steps)).toBe(true);
    // From «Înscrierile mele» the one who signed earlier comes first by registration order, and the count starts after them.
    const fromMine = familySigningSteps([anaConfirmed, maria], { originId: null, originSignable: false, signedIds: [] });
    expect(fromMine.map((step) => step.state)).toEqual(["signed", "current"]);
    expect(familyStepPosition(fromMine)).toEqual({ step: 2, total: 2 });
    // Put off earlier, then signed from their own link: signed, no longer «nu mai așteaptă».
    const signedLater = familySigningSteps([{ ...ana, status: "CONFIRMED" }, { ...maria, status: "CONFIRMED", declared: true }], {
      originId: "a",
      originSignable: false,
      signedIds: ["a"],
      skippedIds: ["m"],
    });
    expect(signedLater.map((step) => step.state)).toEqual(["signed", "signed"]);
  });

  it("never takes a queue place without a signature for a signed one — the declaration is what says so", () => {
    expect(signedBefore({ status: "CONFIRMED", declared: true })).toBe(true);
    expect(signedBefore({ status: "WAITLISTED", declared: true })).toBe(true);
    expect(signedBefore({ status: "WAITLISTED", declared: false })).toBe(false);
    expect(signedBefore({ status: "CONFIRMED" })).toBe(false);
    for (const status of ["PENDING_DECLARATION", "WAITLIST_OFFERED", "CANCELLED", "EXPIRED", "PENDING_EMAIL_CONFIRMATION"] as const) {
      expect(signedBefore({ status, declared: true }), status).toBe(false);
    }
    const steps = familySigningSteps([ana, { ...maria, status: "WAITLISTED", declared: false }], { originId: "a", originSignable: true, signedIds: [] });
    expect(steps.map((step) => step.id)).toEqual(["a"]);
  });

  it("says whether another person follows the current one", () => {
    expect(hasNextFamilyStep(familySigningSteps([ana, maria], { originId: "a", originSignable: true, signedIds: [] }))).toBe(true);
    expect(hasNextFamilyStep(familySigningSteps([ana, maria], { originId: "a", originSignable: false, signedIds: ["a"] }))).toBe(false);
  });

  it("the pass lapses at the earliest hold still running among the people left, and never later than its own minutes", () => {
    const now = at(0);
    const soon = new Date(now.getTime() + 10 * 60_000);
    const steps = familySigningSteps(
      [
        { ...ana, holdExpiresAt: new Date(now.getTime() - 60_000) },
        { ...maria, holdExpiresAt: soon },
        { ...ion, holdExpiresAt: new Date(now.getTime() + 5 * 60_000) },
      ],
      { originId: "a", originSignable: false, signedIds: [], skippedIds: ["i"] },
    );
    // Ana's lapsed hold is not a cap; Ion was put off; Maria's hold in ten minutes is.
    expect(familyPassExpiresAt(steps, now)).toEqual(soon);
    const far = familySigningSteps([{ ...maria, holdExpiresAt: new Date(now.getTime() + 7 * 86_400_000) }], { originId: "m", originSignable: true, signedIds: [] });
    expect(familyPassExpiresAt(far, now)).toEqual(new Date(now.getTime() + FAMILY_PASS_MINUTES * 60_000));
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
  const pass: FamilySigningPass = {
    binding: "link",
    participantId: "11111111-1111-4111-8111-111111111111",
    eventId: "22222222-2222-4222-8222-222222222222",
    originId: "33333333-3333-4333-8333-333333333333",
    eligibleIds: ["33333333-3333-4333-8333-333333333333", "44444444-4444-4444-8444-444444444444", "55555555-5555-4555-8555-555555555555"],
    signedIds: ["33333333-3333-4333-8333-333333333333"],
    skippedIds: ["44444444-4444-4444-8444-444444444444"],
    done: false,
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

  it("keeps whether it came from «Înscrierile mele», and refuses a shape that mixes the two bindings", () => {
    const mine: FamilySigningPass = { ...pass, binding: "mine", originId: null, signedIds: [], skippedIds: [], done: true };
    expect(openFamilyPass(sealFamilyPass(mine, "k") as string, at(10), "k")).toEqual(mine);
    expect(openFamilyPass(sealFamilyPass({ ...pass, binding: "mine" }, "k") as string, at(10), "k")).toBeNull();
    expect(openFamilyPass(sealFamilyPass({ ...pass, originId: null }, "k") as string, at(10), "k")).toBeNull();
  });

  it("the fresh link wins: beside a live link, only a pass opened on that very link carries the wizard on (found in review)", () => {
    expect(passFitsLink(pass, pass.originId)).toBe(true);
    // A skipped person signing later from their own link, with a stale walk from another link on the device.
    expect(passFitsLink(pass, "44444444-4444-4444-8444-444444444444")).toBe(false);
    expect(passFitsLink({ ...pass, binding: "mine", originId: null }, pass.originId)).toBe(false);
    expect(passFitsLink(pass, null)).toBe(false);
  });

  it("is nothing once it has lapsed", () => {
    const sealed = sealFamilyPass(pass, "k") as string;
    expect(openFamilyPass(sealed, at(39), "k")).not.toBeNull();
    expect(openFamilyPass(sealed, at(40), "k")).toBeNull();
  });
});

describe("§NNN the stepper's words, in both languages (found in review)", () => {
  type Family = { stepTitle: string; state: Record<string, string> };
  const catalogues = { ro, en } as const;
  const words = (locale: keyof typeof catalogues) =>
    createTranslator({ locale, messages: catalogues[locale], namespace: "Registrations" });
  const step = (state: FamilyStep["state"], status: FamilyStep["status"] = "PENDING_DECLARATION"): FamilyStep => ({
    id: state,
    registeredName: "Ana Pop",
    status,
    state,
    holdExpiresAt: null,
    checkinCode: null,
  });
  const expected = {
    ro: { signed: "semnată", waitlisted: "pe lista de așteptare", current: "acum", next: "urmează", later: "mai târziu", closed: "nu mai așteaptă semnătura" },
    en: { signed: "signed", waitlisted: "on the waiting list", current: "now", next: "next", later: "later", closed: "no longer waiting for a signature" },
  } as const;

  it("says each of the five states — and a signature that found no place — in words, never by the tick alone", () => {
    for (const locale of ["ro", "en"] as const) {
      const t = words(locale);
      const said = (s: FamilyStep) => t(`declare.family.state.${familyStepWordsKey(s)}`);
      expect(said(step("signed", "CONFIRMED")), locale).toBe(expected[locale].signed);
      expect(said(step("signed", "WAITLISTED")), locale).toBe(expected[locale].waitlisted);
      expect(said(step("current")), locale).toBe(expected[locale].current);
      expect(said(step("next")), locale).toBe(expected[locale].next);
      expect(said(step("later")), locale).toBe(expected[locale].later);
      expect(said(step("closed", "EXPIRED")), locale).toBe(expected[locale].closed);
    }
  });

  it("has the same state keys in both catalogues, and no Romanian word under English", () => {
    const family = (locale: keyof typeof catalogues) =>
      (catalogues[locale] as unknown as { Registrations: { declare: { family: Family } } }).Registrations.declare.family;
    expect(Object.keys(family("en").state).sort()).toEqual(Object.keys(family("ro").state).sort());
    expect(Object.keys(family("ro").state).sort()).toEqual(["closed", "current", "later", "next", "signed", "waitlisted"]);
    for (const key of Object.keys(family("ro").state)) expect(family("en").state[key], key).not.toBe(family("ro").state[key]);
  });

  it("«Declarația N din M»: the current person's place, counted from one, every person on the list in M", () => {
    const steps = [step("signed", "CONFIRMED"), step("later"), step("current"), step("next")];
    const position = familyStepPosition(steps);
    expect(position).toEqual({ step: 3, total: 4 });
    expect(words("ro")("declare.family.stepTitle", { ...position!, name: "Ion Pop" })).toBe("Declarația 3 din 4 — Ion Pop");
    expect(words("en")("declare.family.stepTitle", { ...position!, name: "Ion Pop" })).toBe("Declaration 3 of 4 — Ion Pop");
    // Nobody current: no line at all, never «Declarația 0 din 4».
    expect(familyStepPosition([step("signed", "CONFIRMED"), step("later")])).toBeNull();
  });
});
