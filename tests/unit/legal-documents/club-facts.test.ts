import { describe, expect, it } from "vitest";
import { LEGAL_TEMPLATES } from "@/modules/legal-documents/templates/catalogue";
import { clubFactsFromEnv, fillClubFacts, remainingPlaceholders } from "@/modules/legal-documents/templates/club-facts";

/** `DECISIONS.md` §132 — the club's facts, from the environment, written into the templates before the club reads them. */
describe("the club's facts in the templates", () => {
  const all = clubFactsFromEnv({
    CLUB_LEGAL_NAME: "Asociația Exemplu",
    CLUB_REGISTRATION_NUMBER: "CIF 12345678",
    CLUB_REGISTERED_ADDRESS: "Str. Exemplu nr. 1, Brașov",
    EMAIL_REPLY_TO: "contact@example.test",
  });

  it("fills every placeholder of every template, both languages, when all four facts are set", () => {
    for (const key of ["PRIVACY_NOTICE", "TERMS", "EVENT_DECLARATION"] as const) {
      for (const locale of ["ro", "en"] as const) {
        const filled = fillClubFacts(LEGAL_TEMPLATES[key][locale].body, all);
        expect(remainingPlaceholders(filled), `${key} ${locale}`).toEqual([]);
        const text = filled.sections.flatMap((s) => [s.heading ?? "", ...s.paragraphs]).join(" ");
        expect(text).toContain("Asociația Exemplu");
        // The declaration names the organizer only; the notice and the terms carry the contact.
        if (key !== "EVENT_DECLARATION") expect(text).toContain("contact@example.test");
      }
    }
  });

  it("leaves a fact's placeholder standing when the deployment does not know it, and names it", () => {
    const partial = clubFactsFromEnv({ CLUB_LEGAL_NAME: "X", CLUB_REGISTRATION_NUMBER: undefined, CLUB_REGISTERED_ADDRESS: undefined, EMAIL_REPLY_TO: undefined });
    const body = { sections: [{ heading: "<THE CLUB'S FULL LEGAL NAME>", paragraphs: ["Write to <CONTACT EMAIL>, <REGISTERED ADDRESS>."] }] };
    const filled = fillClubFacts(body, partial);
    expect(filled.sections[0].heading).toBe("X");
    expect(remainingPlaceholders(filled)).toEqual(["<CONTACT EMAIL>", "<REGISTERED ADDRESS>"]);
  });

  it("holds no fact in the source: the repository is public", () => {
    const empty = clubFactsFromEnv({ CLUB_LEGAL_NAME: undefined, CLUB_REGISTRATION_NUMBER: undefined, CLUB_REGISTERED_ADDRESS: undefined, EMAIL_REPLY_TO: undefined });
    expect(Object.values(empty).every((value) => value === null)).toBe(true);
  });
});
