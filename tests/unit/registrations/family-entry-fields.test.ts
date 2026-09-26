import { describe, expect, it } from "vitest";
import { birthDateText, familyEntryFields, personOfEntry, shortRunnerName } from "@/modules/registrations/family-entries";

/**
 * §446 — what of a public submission is kept for the address to confirm another person from its
 * inbox, and how the email and the confirmation page name the people (amending §389, with §421).
 */
const NOW = new Date("2026-09-26T10:00:00.000Z");

const posted = (overrides: Record<string, unknown> = {}) => ({
  firstName: "Maria",
  lastName: "Pop",
  birthDate: "1990-07-11",
  sex: "FEMALE",
  phone: "+40711111111",
  emergencyContactName: "Ion Vecinul",
  emergencyContactPhone: "+40722222222",
  email: "familia.pop@example.ro",
  emailConfirm: "familia.pop@example.ro",
  locale: "ro",
  privacyAcknowledged: true,
  fitnessDeclared: true,
  fitnessAcknowledged: true,
  termsAccepted: true,
  termsVersionShown: 3,
  rulesAcknowledged: true,
  resultsNameConsent: false,
  listOptOut: false,
  healthNotes: "astm",
  healthConsent: true,
  stravaUrl: "https://www.strava.com/athletes/12345",
  instagramHandle: "maria.pop",
  honeypot: "",
  renderedAt: "2026-09-26T09:59:00.000Z",
  ...overrides,
});

describe("§446 the kept form of another person", () => {
  it("keeps neither the address nor the anti-bot fields nor an acknowledgement nobody was asked yet", () => {
    const fields = familyEntryFields(posted(), NOW);
    for (const name of ["email", "emailConfirm", "honeypot", "renderedAt", "fitnessAcknowledged"]) expect(fields).not.toHaveProperty(name);
    expect(fields).toMatchObject({ firstName: "Maria", lastName: "Pop", birthDate: "1990-07-11", termsAccepted: true, termsVersionShown: 3, rulesAcknowledged: true });
  });

  it("keeps none of another adult's own consents (§421): the health note, the socials, the list tick, the fitness statement", () => {
    const fields = familyEntryFields(posted(), NOW);
    expect(fields).not.toHaveProperty("healthNotes");
    expect(fields).not.toHaveProperty("stravaUrl");
    expect(fields).not.toHaveProperty("instagramHandle");
    expect(fields).not.toHaveProperty("fitnessDeclared");
    expect(fields.healthConsent).toBe(false);
    expect(fields.listOptOut).toBe(true);
  });

  it("keeps a minor's, which the parent gives for the child", () => {
    const fields = familyEntryFields(posted({ birthDate: "2013-04-02", guardianName: "Ana Pop" }), NOW);
    expect(fields).toMatchObject({ healthNotes: "astm", healthConsent: true, listOptOut: false, fitnessDeclared: true, guardianName: "Ana Pop" });
  });

  it("is plain JSON: nothing undefined is carried", () => {
    const fields = familyEntryFields(posted({ city: undefined }), NOW);
    expect(Object.values(fields).includes(undefined)).toBe(false);
    expect(JSON.parse(JSON.stringify(fields))).toEqual(fields);
  });
});

describe("§446 how the people are named", () => {
  it("a registered runner is the first name and the last name's initial", () => {
    expect(shortRunnerName({ firstName: "Ana", lastName: "popescu", displayName: "Ana P." })).toBe("Ana P.");
    expect(shortRunnerName({ firstName: "Ștefan", lastName: "Ștefănescu", displayName: "x" })).toBe("Ștefan Ș.");
    expect(shortRunnerName({ firstName: null, lastName: null, displayName: "Ana P." })).toBe("Ana P.");
  });

  it("the person the form named is the legal name, and the birth date reads as the pickers write it", () => {
    const person = personOfEntry({ fields: { firstName: "Maria", lastName: "Pop", birthDate: "2013-04-02" } });
    expect(person.legalName).toBe("Maria Pop");
    expect(birthDateText(person.birthDate)).toBe("02.04.2013");
    expect(person.adult(NOW)).toBe(false);
    expect(personOfEntry({ fields: { firstName: "Ion", lastName: "Pop", birthDate: "1980-01-01" } }).adult(NOW)).toBe(true);
    expect(birthDateText(null)).toBe("");
  });
});
