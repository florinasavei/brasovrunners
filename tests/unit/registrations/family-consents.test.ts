import { describe, expect, it } from "vitest";
import { anotherPersonSubmissionSchema, withoutAnotherAdultsConsents } from "@/modules/registrations/fields";

/**
 * §NNN — what the family form (§389) may carry for another adult: none of the consents only that
 * adult can give. Dropped before the schema reads anything, so a form posted without JavaScript,
 * or by anything else, stores no health note, no socials and no list tick, and makes no
 * first-person fitness statement; the address holder's acknowledgement stands in for it. A minor
 * is left alone: the parent consents for the child.
 */
const NOW = new Date("2026-09-25T10:00:00.000Z");

const posted = (overrides: Record<string, unknown> = {}) => ({
  firstName: "Maria",
  lastName: "Pop",
  birthDate: "1985-03-02",
  sex: "UNSPECIFIED",
  emergencyContactName: "Ion Vecinul",
  emergencyContactPhone: "+40722222222",
  email: "familia.pop@example.ro",
  locale: "ro",
  privacyAcknowledged: true,
  rulesAcknowledged: true,
  termsAccepted: true,
  resultsNameConsent: false,
  healthNotes: "astm",
  healthConsent: true,
  stravaUrl: "https://www.strava.com/athletes/12345",
  instagramHandle: "maria.pop",
  listOptOut: false,
  fitnessDeclared: true,
  fitnessAcknowledged: true,
  honeypot: "",
  renderedAt: "2026-09-25T09:59:00.000Z",
  ...overrides,
});

describe("§NNN the family form and another adult's consents", () => {
  it("drops the health note, the socials, the list tick and the fitness statement for an adult", () => {
    expect(withoutAnotherAdultsConsents(posted(), NOW)).toMatchObject({
      healthNotes: undefined,
      healthConsent: false,
      stravaUrl: undefined,
      instagramHandle: undefined,
      listOptOut: true,
      fitnessDeclared: undefined,
      // The rest is untouched.
      firstName: "Maria",
      termsAccepted: true,
      fitnessAcknowledged: true,
    });
  });

  it("drops them on the eighteenth birthday itself, and not the day before", () => {
    expect(withoutAnotherAdultsConsents(posted({ birthDate: "2008-09-25" }), NOW)).toMatchObject({ listOptOut: true });
    expect(withoutAnotherAdultsConsents(posted({ birthDate: "2008-09-26" }), NOW)).toMatchObject({ listOptOut: false, healthNotes: "astm" });
  });

  it("leaves a minor's, and a date it cannot read, exactly as posted", () => {
    const minor = posted({ birthDate: "2011-05-10" });
    expect(withoutAnotherAdultsConsents(minor, NOW)).toBe(minor);
    const unreadable = posted({ birthDate: "not a date" });
    expect(withoutAnotherAdultsConsents(unreadable, NOW)).toBe(unreadable);
    expect(withoutAnotherAdultsConsents(null, NOW)).toBeNull();
  });

  it("asks the acknowledgement of an adult and the statement of a minor's parent", () => {
    const adult = anotherPersonSubmissionSchema.safeParse(withoutAnotherAdultsConsents(posted({ fitnessAcknowledged: false }), NOW));
    expect(adult.error?.issues.map((issue) => issue.path.join("."))).toEqual(["fitnessAcknowledged"]);
    expect(anotherPersonSubmissionSchema.safeParse(withoutAnotherAdultsConsents(posted(), NOW)).success).toBe(true);

    const child = { birthDate: "2011-05-10", guardianName: "Ana Pop" };
    const unsaid = anotherPersonSubmissionSchema.safeParse(posted({ ...child, fitnessDeclared: false, fitnessAcknowledged: false }));
    expect(unsaid.error?.issues.map((issue) => issue.path.join("."))).toEqual(["fitnessDeclared"]);
    expect(anotherPersonSubmissionSchema.safeParse(posted({ ...child, fitnessAcknowledged: false })).success).toBe(true);
  });
});
