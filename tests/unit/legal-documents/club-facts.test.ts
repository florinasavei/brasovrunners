import { describe, expect, it } from "vitest";
import { LEGAL_TEMPLATES } from "@/modules/legal-documents/templates/catalogue";
import { CLUB_LEGAL_NAME, fillClubFacts, remainingPlaceholders } from "@/modules/legal-documents/templates/club-facts";

/** `DECISIONS.md` §132 — the club's known facts written into the templates before the club reads them. */
describe("the club's facts in the templates", () => {
  it("writes the legal name and the contact address into every template, both languages, and leaves the rest as blanks", () => {
    for (const key of ["PRIVACY_NOTICE", "TERMS", "EVENT_DECLARATION"] as const) {
      for (const locale of ["ro", "en"] as const) {
        const filled = fillClubFacts(LEGAL_TEMPLATES[key][locale].body, { legalName: CLUB_LEGAL_NAME, contactEmail: "contact@example.test" });
        const text = filled.sections.flatMap((s) => [s.heading ?? "", ...s.paragraphs]).join(" ");
        expect(text).not.toMatch(/<(DENUMIREA JURIDICĂ|THE CLUB'S FULL|EMAIL DE CONTACT|CONTACT EMAIL)/);
        const left = remainingPlaceholders(filled);
        // Only what nobody handed over: the registered address and the registration number.
        expect(left.every((p) => /ADRESA|ADDRESS|ÎNREGISTRARE|REGISTRATION|LIKE THIS/.test(p)), `${key} ${locale}: ${left.join(", ")}`).toBe(true);
      }
    }
  });

  it("leaves a fact's placeholder alone when the fact is unknown", () => {
    const body = { sections: [{ heading: "<THE CLUB'S FULL LEGAL NAME>", paragraphs: ["Write to <CONTACT EMAIL>."] }] };
    const filled = fillClubFacts(body, { legalName: "X", contactEmail: null });
    expect(filled.sections[0].heading).toBe("X");
    expect(filled.sections[0].paragraphs[0]).toBe("Write to <CONTACT EMAIL>.");
    expect(remainingPlaceholders(filled)).toEqual(["<CONTACT EMAIL>"]);
  });
});
