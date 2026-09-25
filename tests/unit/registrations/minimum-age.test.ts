import { createTranslator } from "next-intl";
import { describe, expect, it } from "vitest";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { LEGAL_TEMPLATES } from "@/modules/legal-documents/templates/catalogue";
import {
  ageOn,
  ageRuleVariant,
  dayIn,
  isMinorOn,
  latestBirthDateFor,
  MIN_PARTICIPANT_AGE,
  yearsPhrase,
} from "@/modules/registrations/domain/age";
import {
  minimumAgeRule,
  registrationSubmissionSchema,
  staffRegistrationSubmissionSchema,
  UNDER_MINIMUM_AGE,
} from "@/modules/registrations/fields";

/**
 * §321 — a participant has reached the event's minimum age on the day of the event, by calendar
 * years, the arithmetic `isMinorOn` has always used; the day is the race's own, in the race's own
 * zone. Since §329 the number is the event's (`events.min_age`), fourteen unless set otherwise.
 *
 * The integration suite (`registrations/minimum-age.test.ts`) proves every door refuses; this
 * proves the counting those refusals rest on, at the edges where counting goes wrong: the
 * birthday itself, the day after it, 29 February, and midnight in a zone that is not UTC — and
 * the words the number is said in, at the edges where Romanian grammar changes.
 */
describe("§321 the minimum age is counted by the calendar, on the race day", () => {
  it("defaults to fourteen — the column's default and what a new event is offered, not the rule", () => {
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

  it("gives the picker the latest birth date the server accepts, and nothing a day later, for any minimum", () => {
    for (const minAge of [MIN_PARTICIPANT_AGE, 16, 18, 40]) {
      for (const day of ["2026-11-21", "2026-03-01", "2026-02-28", "2028-02-29", "2026-12-31", "2027-01-01"]) {
        const latest = latestBirthDateFor(minAge, day);
        const next = new Date(`${latest}T00:00:00Z`);
        next.setUTCDate(next.getUTCDate() + 1);
        expect(ageOn(latest, day), `${latest} on ${day}, minimum ${minAge}`).toBe(minAge);
        expect(ageOn(next.toISOString().slice(0, 10), day), `the day after ${latest} on ${day}, minimum ${minAge}`).toBe(minAge - 1);
      }
    }
    expect(latestBirthDateFor(14, "2026-11-21")).toBe("2012-11-21");
    expect(latestBirthDateFor(16, "2026-11-21")).toBe("2010-11-21");
    // 2014 has no 29 February: the 28th is the last birthday that is fourteen on 29 February 2028.
    expect(latestBirthDateFor(14, "2028-02-29")).toBe("2014-02-28");
    // No minimum: the day itself, and the page's other bound (today) is what then applies.
    expect(latestBirthDateFor(0, "2026-11-21")).toBe("2026-11-21");
  });
});

describe("§329 a number of years, as a sentence says it", () => {
  it("puts 'de' before 'ani' where Romanian does — last two digits 00 or 20 to 99 — and '1 an' in the singular", () => {
    const expected: Record<number, string> = {
      0: "0 ani",
      1: "1 an",
      14: "14 ani",
      18: "18 ani",
      19: "19 ani",
      20: "20 de ani",
      21: "21 de ani",
      99: "99 de ani",
      100: "100 de ani",
      101: "101 ani",
      119: "119 ani",
      120: "120 de ani",
    };
    for (const [years, phrase] of Object.entries(expected)) {
      expect(yearsPhrase(Number(years), "ro"), `${years} in Romanian`).toBe(phrase);
    }
  });

  it("says 'year' for one and 'years' for every other number in English", () => {
    const expected: Record<number, string> = {
      0: "0 years",
      1: "1 year",
      14: "14 years",
      18: "18 years",
      19: "19 years",
      20: "20 years",
      21: "21 years",
      99: "99 years",
      100: "100 years",
      101: "101 years",
      120: "120 years",
    };
    for (const [years, phrase] of Object.entries(expected)) {
      expect(yearsPhrase(Number(years), "en"), `${years} in English`).toBe(phrase);
    }
  });

  it("picks the sentence that reads right for the number: no minimum, a minor's minimum, an adult's", () => {
    expect(ageRuleVariant(0)).toBe("guardianOnly");
    expect(ageRuleVariant(1)).toBe("minimumAndGuardian");
    expect(ageRuleVariant(14)).toBe("minimumAndGuardian");
    expect(ageRuleVariant(17)).toBe("minimumAndGuardian");
    // Nobody who may enter needs a parent from eighteen on, so the guardian sentence goes.
    expect(ageRuleVariant(18)).toBe("minimumOnly");
    expect(ageRuleVariant(40)).toBe("minimumOnly");
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
    const result = registrationSubmissionSchema.superRefine(minimumAgeRule("2026-11-21", 14)).safeParse(complete);
    expect(paths(result)).toEqual(["birthDate", UNDER_MINIMUM_AGE]);
  });

  it("accepts the same person on the day they turn fourteen", () => {
    const result = registrationSubmissionSchema
      .superRefine(minimumAgeRule("2026-11-22", 14))
      .safeParse(complete);
    expect(result.success).toBe(true);
  });

  it("counts the event's own number (§329): sixteen refuses fifteen and takes sixteen on the day", () => {
    const fifteen = { ...complete, birthDate: "2011-11-22" };
    expect(paths(registrationSubmissionSchema.superRefine(minimumAgeRule("2026-11-21", 16)).safeParse(fifteen))).toEqual([
      "birthDate",
      UNDER_MINIMUM_AGE,
    ]);
    // The same person is fourteen-plus, so the club's default would have let them in: the rule
    // is the event's number, not the constant.
    expect(registrationSubmissionSchema.superRefine(minimumAgeRule("2026-11-21", MIN_PARTICIPANT_AGE)).safeParse(fifteen).success).toBe(true);
    const sixteenOnTheDay = { ...complete, birthDate: "2010-11-21" };
    expect(registrationSubmissionSchema.superRefine(minimumAgeRule("2026-11-21", 16)).safeParse(sixteenOnTheDay).success).toBe(true);
  });

  it("has no minimum to count at zero", () => {
    // Born the week of the race: anyone the birth-date range allows.
    const baby = { ...complete, birthDate: "2026-09-01" };
    const result = registrationSubmissionSchema.superRefine(minimumAgeRule("2026-11-21", 0)).safeParse(baby);
    expect(paths(result)).not.toContain(UNDER_MINIMUM_AGE);
  });

  it("gives a malformed date the schema's own reason only", () => {
    const result = registrationSubmissionSchema
      .superRefine(minimumAgeRule("2026-11-21", 14))
      .safeParse({ ...complete, birthDate: "22/11/2012" });
    expect(paths(result)).toContain("birthDate");
    expect(paths(result)).not.toContain(UNDER_MINIMUM_AGE);
  });

  it("has nothing to count on a staff entry that gives no birth date, and counts one that does", () => {
    const rule = minimumAgeRule("2026-11-21", 14);
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

describe("§329 every sentence about the minimum age says the event's number, through yearsPhrase", () => {
  /*
    Until §329 the catalogues wrote "14 ani" in words and this test held them to the constant,
    because Romanian changes at twenty and an interpolated number would have read wrongly the day
    somebody raised it. The number is the event's now, so the sentences interpolate `{age}` and
    the grammar lives in one tested helper, `yearsPhrase`: this holds every sentence to that —
    no number of its own, a placeholder, and the right words for 14, 20 and 101 once filled.
  */
  const sentences = (messages: typeof ro) => ({
    "Registration.ageRule.minimumAndGuardian": messages.Registration.ageRule.minimumAndGuardian,
    "Registration.ageRule.minimumOnly": messages.Registration.ageRule.minimumOnly,
    "Registration.birthDateHelp": messages.Registration.birthDateHelp,
    "Registration.errors.tooYoung": messages.Registration.errors.tooYoung,
    "Admin.errors.UNDER_MINIMUM_AGE": messages.Admin.errors.UNDER_MINIMUM_AGE,
  });

  for (const [locale, messages] of [["ro", ro], ["en", en]] as const) {
    it(`carries {age} and no number of its own in every ${locale} sentence that states the minimum`, () => {
      for (const [key, sentence] of Object.entries(sentences(messages))) {
        expect(sentence, `${locale} ${key}`).toContain("{age}");
        // Eighteen is the guardian's age (§108), not the minimum, and may stand in words.
        expect(sentence.replace(/\b18\b/g, ""), `${locale} ${key} writes a number of its own`).not.toMatch(/\d/);
      }
    });

    it(`reads right in ${locale} once the event's number is filled in`, () => {
      const t = createTranslator({ locale, messages, namespace: "Registration" });
      for (const years of [14, 20, 101]) {
        const age = yearsPhrase(years, locale);
        expect(t(`ageRule.${ageRuleVariant(years)}`, { age }), `${years}`).toContain(age);
        expect(t("errors.tooYoung", { age })).toContain(age);
        expect(t("birthDateHelp", { age })).toContain(age);
      }
    });

    it(`names who registers a minor only where a minor may enter, in ${locale}`, () => {
      const t = createTranslator({ locale, messages, namespace: "Registration" });
      // Fourteen: the minimum, then the parent.
      expect(t("ageRule.minimumAndGuardian", { age: yearsPhrase(14, locale) })).toMatch(/18/);
      // Eighteen or more: nobody who may enter needs a parent.
      expect(t("ageRule.minimumOnly", { age: yearsPhrase(18, locale) })).not.toMatch(/părinte|parent/);
      // No minimum: the parent sentence alone, and never "from 0 years".
      const none = t("ageRule.guardianOnly");
      expect(none).not.toContain("{age}");
      expect(none).not.toMatch(/\b0\b/);
      expect(none).toMatch(/părinte|parent/);
      // The birth date's help on an event with no minimum says only the categories.
      expect(t("birthDateHelpNoMinimum")).not.toMatch(/\d/);
    });
  }

  it("has every sentence variant in both catalogues", () => {
    for (const variant of ["minimumAndGuardian", "minimumOnly", "guardianOnly"] as const) {
      expect(ro.Registration.ageRule[variant], `ro ${variant}`).toBeTruthy();
      expect(en.Registration.ageRule[variant], `en ${variant}`).toBeTruthy();
    }
  });

  it("puts the event's minimum in Romanian with the grammar the helper gives it", () => {
    const t = createTranslator({ locale: "ro", messages: ro, namespace: "Registration" });
    expect(t("ageRule.minimumAndGuardian", { age: yearsPhrase(14, "ro") })).toBe(
      "Participanți de la 14 ani; sub 18 ani, înscrierea o face un părinte.",
    );
    expect(t("ageRule.minimumOnly", { age: yearsPhrase(21, "ro") })).toBe("Participanți de la 21 de ani.");
    expect(t("errors.tooYoung", { age: yearsPhrase(16, "ro") })).toBe(
      "Vârsta minimă de participare la acest eveniment este 16 ani împliniți în ziua cursei.",
    );
    expect(t("ageRule.guardianOnly")).toBe("Sub 18 ani, înscrierea o face un părinte.");
  });

  it("gives the volunteer the chosen event's number in the backoffice's sentence, in both languages", () => {
    for (const [locale, messages] of [["ro", ro], ["en", en]] as const) {
      const admin = createTranslator({ locale, messages, namespace: "Admin" });
      const age = yearsPhrase(21, locale);
      expect(admin("errors.UNDER_MINIMUM_AGE", { age }), locale).toContain(age);
    }
  });
});

describe("§329 the platform's legal templates leave the number to the event", () => {
  /*
    The terms and the privacy notice used to say "14". The number is each event's now, so the
    templates say that a minimum is set per event and shown on its page — and no number of their
    own, which would be untrue of every event that set another. The texts in effect change only
    when the club approves a new version (§29, §95).
  */
  for (const key of ["TERMS", "PRIVACY_NOTICE"] as const) {
    for (const locale of ["ro", "en"] as const) {
      it(`${key} ${locale}: a minimum per event, on the event's page, no number but the guardian's eighteen`, () => {
        const paragraphs = LEGAL_TEMPLATES[key][locale].body.sections.flatMap((section) => section.paragraphs);
        const sentence = paragraphs.find((paragraph) => /vârst[aă] minimă|minimum age/i.test(paragraph));
        expect(sentence, "the template still states the rule").toBeDefined();
        expect(sentence).toMatch(locale === "ro" ? /pagina/ : /page/);
        // No number of the template's own but the guardian's eighteen. The privacy notice's
        // paragraph also cites its legal bases since the GDPR rewrite (§323) — "art. 8 GDPR",
        // "art. 6(1)(b)" — which are articles, not ages, so they are set aside before the check.
        // Since the counsel review (§NNN) it also cites the Civil Code the Romanian way — "art. 41
        // alin. (2)" — and states the Code's own threshold of fourteen (art. 41, 43: the parent acts
        // for a child under 14 and approves the acts of one aged 14 to 18). That is the law's age,
        // the same for every event, not a minimum of the template's. A cross-reference to another
        // section of the notice ("secțiunea 4") is a heading's number, not an age either.
        const withoutCitations = sentence!
          .replace(/\bart\.\s*\d+(\(\d+\))*(\([a-z]\))?(\s*alin\.\s*\(\d+\))?/g, "")
          .replace(/\b(?:secțiunea|section)\s+\d+/g, "");
        expect(withoutCitations.replace(/\b1[48]\b/g, "")).not.toMatch(/\d/);
      });
    }
  }
});
