import { describe, expect, it } from "vitest";
import { termsLineKindFor } from "@/modules/registrations/admin-repository";

/**
 * §425 — which of the three terms lines the registration's page shows: the version accepted
 * expressly on the form, the paper note for a staff or desk entry, or "no version recorded" for
 * a row sent before the column existed. Pulled out of the page's JSX (§425's review) so this
 * runs without a browser.
 */
describe("termsLineKindFor", () => {
  it("names the version and moment when the form's own tick accepted them", () => {
    const acceptedAt = new Date("2026-09-25T10:00:00.000Z");
    expect(termsLineKindFor({ termsVersion: 3, termsAcceptedAt: acceptedAt, source: "PUBLIC" })).toEqual({
      kind: "accepted",
      version: 3,
      acceptedAt,
    });
  });

  it("still reads as accepted for a staff entry that carries a version — the paper note names no version", () => {
    const acceptedAt = new Date("2026-09-25T10:00:00.000Z");
    expect(termsLineKindFor({ termsVersion: 1, termsAcceptedAt: acceptedAt, source: "STAFF" })).toEqual({
      kind: "accepted",
      version: 1,
      acceptedAt,
    });
  });

  it("says the terms are on paper for a staff entry with no version recorded", () => {
    expect(termsLineKindFor({ termsVersion: null, termsAcceptedAt: null, source: "STAFF" })).toEqual({
      kind: "onPaper",
    });
  });

  it("says no version was recorded for a public entry sent before the column existed", () => {
    expect(termsLineKindFor({ termsVersion: null, termsAcceptedAt: null, source: "PUBLIC" })).toEqual({
      kind: "notRecorded",
    });
  });
});
