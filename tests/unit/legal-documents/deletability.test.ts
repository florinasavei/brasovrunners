import { describe, expect, it } from "vitest";
import { termsHasBeenInForce } from "@/modules/legal-documents/domain/deletability";

/**
 * BR-REQ-053-02, `DECISIONS.md` §203 and §290 — the one obstacle to deleting an approved legal
 * version that is not a count, as a pure function both callers can ask.
 *
 * It lived inside `assertDeletable` and nowhere else, so the delete screen did not know about it:
 * it listed a draft, the three dependant counts and "the text in force now", found none of them,
 * and told the reader the version could go. They typed the phrase and the reason, pressed, and the
 * service refused with `CONFLICT` — which the backoffice renders as "Altcineva a salvat între
 * timp". The owner: "inca nu pot sterge unele documente".
 *
 * These are the cases the screen and the service must now agree on.
 */
const NOW = new Date("2026-09-22T12:00:00.000Z");

describe("§203 a terms version that has been in force cannot be deleted", () => {
  it("refuses one whose effective date has passed", () => {
    expect(termsHasBeenInForce({ key: "TERMS", effectiveAt: new Date("2026-09-20T00:00:00.000Z") }, NOW)).toBe(true);
  });

  it("refuses one that took effect this very instant", () => {
    // The boundary is inclusive on purpose: a version in force *now* has been in force, and
    // somebody registering in this second accepted it.
    expect(termsHasBeenInForce({ key: "TERMS", effectiveAt: NOW }, NOW)).toBe(true);
  });

  it("allows one approved ahead of its date and superseded before it arrived", () => {
    // Accepted by nobody, so there is nothing to protect. This is the case §203 deliberately
    // leaves open, and the reason the rule is not simply "no terms version is ever deleted".
    expect(termsHasBeenInForce({ key: "TERMS", effectiveAt: new Date("2026-10-01T00:00:00.000Z") }, NOW)).toBe(false);
  });

  it("allows one with no effective date at all", () => {
    expect(termsHasBeenInForce({ key: "TERMS", effectiveAt: null }, NOW)).toBe(false);
  });

  it("says nothing about the other two keys, whose counts are real", () => {
    // The declaration is counted by signatures and by events, and the privacy notice by
    // acknowledgements, so `assertNothingDependsOn` is evidence for both and this rule is not
    // needed. Asserted rather than assumed: widening it to every key would refuse deletions §151
    // exists to allow.
    for (const key of ["PRIVACY_NOTICE", "EVENT_DECLARATION"] as const) {
      expect(termsHasBeenInForce({ key, effectiveAt: new Date("2026-09-20T00:00:00.000Z") }, NOW), key).toBe(false);
    }
  });
});
