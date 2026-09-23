import { describe, expect, it } from "vitest";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import {
  ageOn,
  dayIn,
  isMinorOn,
  latestBirthDateFor,
  MIN_PARTICIPANT_AGE,
} from "@/modules/registrations/domain/age";
import {
  minimumAgeRule,
  registrationSubmissionSchema,
  staffRegistrationSubmissionSchema,
  UNDER_MINIMUM_AGE,
} from "@/modules/registrations/fields";

/**
 * §321 — a participant is at least fourteen on the day of the event, by calendar years, the
 * arithmetic `isMinorOn` has always used; the day is the race's own, in the race's own zone.
 *
 * The integration suite (`registrations/minimum-age.test.ts`) proves every door refuses; this
 * proves the counting those refusals rest on, at the edges where counting goes wrong: the
 * birthday itself, the day after it, 29 February, and midnight in a zone that is not UTC.
 */
describe("§321 the minimum age is counted by the calendar, on the race day", () => {
  it("is fourteen", () => {
    expect(MIN_PARTICIPANT_AGE).toBe(14);
  });

  it("lets in somebody whose fourteenth birthday is the race day, and not the day after", () => {
    const raceDay = "2026-11-21";
    expect(ageOn("2012-11-21", raceDay)).toBe(14);
    // Fourteen tomorrow is thirteen today.
    expect(ageOn("2012-11-22", raceDay)).toBe(13);
    expect(ageOn("2012-11-20", raceDay)).toBe(14);
    expect(ageOn("1990-05-17", raceDay)).toBe(36);
  });

  it("counts a 29 February birthday on 1 March in a common year, as isMinorOn does", () => {
    // 2026 is a common year: the fourteenth birthday of somebody born on 29 February 2012 is
    // 1 March, so on 28 February they are still thirteen.
    expect(ageOn("2012-02-29", "2026-02-28")).toBe(13);
    expect(ageOn("2012-02-29", "2026-03-01")).toBe(14);
    // The same rollover the eighteen rule has always used, so the two never disagree.
    expect(isMinorOn("2008-02-29", new Date("2026-02-28T12:00:00Z"))).toBe(true);
    expect(isMinorOn("2008-02-29", new Date("2026-03-01T00:00:00Z"))).toBe(false);
  });

  it("answers null rather than a reason for what is not a date", () => {
    expect(ageOn("", "2026-11-21")).toBeNull();
    expect(ageOn("21.11.2012", "2026-11-21")).toBeNull();
    expect(ageOn("2012-13-40", "2026-11-21")).toBeNull();
    expect(ageOn("2012-11-21", "not a day")).toBeNull();
  });

  it("reads the race day in the race's own zone, not in UTC", () => {
    // 00:30 in Brașov on 21 November is 22:30 UTC on the 20th: the day on the start line is the 21st.
    const justAfterMidnight = new Date("2026-11-20T22:30:00.000Z");
    expect(dayIn(justAfterMidnight, "Europe/Bucharest")).toBe("2026-11-21");
    expect(dayIn(justAfterMidnight, "UTC")).toBe("2026-11-20");
    // Summer time moves the offset to three hours; the same rule holds.
    expect(dayIn(new Date("2026-06-13T21:30:00.000Z"), "Europe/Bucharest")).toBe("2026-06-14");
    // A morning start is the same day everywhere near here.
    expect(dayIn(new Date("2026-11-21T07:00:00.000Z"), "Europe/Bucharest")).toBe("2026-11-21");
  });

  it("gives the picker the latest birth date the server accepts, and nothing a day later", () => {
    for (const day of ["2026-11-21", "2026-03-01", "2026-02-28", "2028-02-29", "2026-12-31", "2027-01-01"]) {
      const latest = latestBirthDateFor(MIN_PARTICIPANT_AGE, day);
      const next = new Date(`${latest}T00:00:00Z`);
      next.setUTCDate(next.getUTCDate() + 1);
      expect(ageOn(latest, day), `${latest} on ${day}`).toBe(MIN_PARTICIPANT_AGE);
      expect(ageOn(next.toISOString().slice(0, 10), day), `the day after ${latest} on ${day}`).toBe(MIN_PARTICIPANT_AGE - 1);
    }
    expect(latestBirthDateFor(14, "2026-11-21")).toBe("2012-11-21");
    // 2014 has no 29 February: the 28th is the last birthday that is fourteen on 29 February 2028.
    expect(latestBirthDateFor(14, "2028-02-29")).toBe("2014-02-28");
  });
});

describe("§321 the rule on the schema, for whichever caller adds it", () => {
  const complete = {
    firstName: "Maria",
    lastName: "Popescu",
    birthDate: "2012-11-22",
    sex: "FEMALE",
    nationality: "RO",
    city: "Brașov",
    phone: "+40711111111",
    emergencyContactName: "Ion Popescu",
    emergencyContactPhone: "+40722222222",
    guardianName: "Ion Popescu",
    email: "maria@example.ro",
    locale: "ro",
    privacyAcknowledged: true,
    fitnessDeclared: true,
    rulesAcknowledged: true,
    resultsNameConsent: false,
    listOptOut: false,
  };
  const paths = (result: { success: boolean; error?: { issues: { path: PropertyKey[] }[] } }) =>
    result.success ? [] : result.error!.issues.map((issue) => issue.path.join("."));

  it("names the birth date and the marker, so the summary can link one and say the other", () => {
    const result = registrationSubmissionSchema.superRefine(minimumAgeRule("2026-11-21")).safeParse(complete);
    expect(paths(result)).toEqual(["birthDate", UNDER_MINIMUM_AGE]);
  });

  it("accepts the same person on the day they turn fourteen", () => {
    const result = registrationSubmissionSchema
      .superRefine(minimumAgeRule("2026-11-22"))
      .safeParse(complete);
    expect(result.success).toBe(true);
  });

  it("gives a malformed date the schema's own reason only", () => {
    const result = registrationSubmissionSchema
      .superRefine(minimumAgeRule("2026-11-21"))
      .safeParse({ ...complete, birthDate: "22/11/2012" });
    expect(paths(result)).toContain("birthDate");
    expect(paths(result)).not.toContain(UNDER_MINIMUM_AGE);
  });

  it("has nothing to count on a staff entry that gives no birth date, and counts one that does", () => {
    const rule = minimumAgeRule("2026-11-21");
    const withoutBirthDate = Object.fromEntries(
      Object.entries(complete).filter(([key]) => key !== "birthDate" && key !== "guardianName"),
    );
    expect(staffRegistrationSubmissionSchema.superRefine(rule).safeParse(withoutBirthDate).success).toBe(true);
    expect(paths(staffRegistrationSubmissionSchema.superRefine(rule).safeParse(complete))).toEqual([
      "birthDate",
      UNDER_MINIMUM_AGE,
    ]);
  });
});

describe("§321 the catalogues say the same number as the constant", () => {
  /*
    The number is written in words in the catalogues, because Romanian changes at twenty
    ("14 ani", "20 de ani") and an interpolated {age} would read wrongly the day somebody raised
    it. So the two are held together here: change the constant and this names every sentence
    that still says the old number.
  */
  const sentences = (messages: typeof ro) => ({
    ageRule: messages.Registration.ageRule,
    birthDateHelp: messages.Registration.birthDateHelp,
    tooYoung: messages.Registration.errors.tooYoung,
    underMinimumAge: messages.Admin.errors.UNDER_MINIMUM_AGE,
    staffHelp: messages.Admin.registrations.birthDateMinimumAge,
  });

  for (const [locale, messages] of [["ro", ro], ["en", en]] as const) {
    it(`says ${MIN_PARTICIPANT_AGE} in every ${locale} sentence about the minimum age`, () => {
      for (const [key, sentence] of Object.entries(sentences(messages))) {
        expect(sentence, `${locale} ${key}`).toContain(String(MIN_PARTICIPANT_AGE));
      }
    });
  }
});
