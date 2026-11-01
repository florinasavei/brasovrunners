import { describe, expect, it } from "vitest";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { gaveResultsNameConsentSince, holdsResultsNameConsent, resultsNameConsentLine, resultsNameConsentOffered } from "@/modules/results/domain/name-consent";
import { type PublicNameInput, publicResultName } from "@/modules/results/domain/public-name";

/**
 * BR-REQ-072-01, §NNN — «Vreau să apar cu numele în clasament»: the runner who registered under a privacy notice older than the first
 * that described the results asks, from their own registration's page, to be named in a race's published results.
 *
 * The rule the page, the server and the public read share: asked only while the notice in force describes the results, only for a
 * race, only of a registration whose notice is below the line; a consent counts only when given under a notice at or above it; and the
 * name still needs every condition `publicResultName` applied before (§808): the tick, a confirmed registration, not a hidden guest.
 */
const facts = { noticeDescribesResults: true, firstResultsNoticeVersion: 3, eventType: "RACE" };

describe("BR-REQ-072-01 §NNN when «Vreau să apar cu numele în clasament» is asked", () => {
  it("draws the line at the first results notice for a race while the notice in force describes the results", () => {
    expect(resultsNameConsentLine(facts)).toBe(3);
  });

  it("draws no line — nothing is asked — while the notice in force does not describe the results", () => {
    expect(resultsNameConsentLine({ ...facts, noticeDescribesResults: false })).toBeNull();
    expect(resultsNameConsentLine({ ...facts, firstResultsNoticeVersion: null })).toBeNull();
  });

  it("draws no line for an event that takes no results", () => {
    for (const eventType of ["GROUP_RUN", "HIKE", "COFFEE", "MEETUP", "EXTERNAL", ""]) expect(resultsNameConsentLine({ ...facts, eventType }), eventType).toBeNull();
  });

  it("asks only a registration whose notice predates the line; a registrant under the results notice or a later one is not asked", () => {
    expect(resultsNameConsentOffered(1, 3)).toBe(true);
    expect(resultsNameConsentOffered(2, 3)).toBe(true);
    expect(resultsNameConsentOffered(3, 3)).toBe(false);
    expect(resultsNameConsentOffered(4, 3)).toBe(false);
    expect(resultsNameConsentOffered(1, null)).toBe(false);
  });

  it("offers the way out of a yes given from the page since registering, never of a pre-§322 yes recorded with the registration's notice", () => {
    expect(gaveResultsNameConsentSince({ resultsNameConsent: true, resultsConsentVersion: 3, privacyNoticeVersion: 1 })).toBe(true);
    expect(gaveResultsNameConsentSince({ resultsNameConsent: false, resultsConsentVersion: 3, privacyNoticeVersion: 1 })).toBe(false);
    expect(gaveResultsNameConsentSince({ resultsNameConsent: true, resultsConsentVersion: 1, privacyNoticeVersion: 1 })).toBe(false);
  });

  it("counts a consent only when given under a notice at or above the line", () => {
    expect(holdsResultsNameConsent({ resultsNameConsent: true, resultsConsentVersion: 3 }, 3)).toBe(true);
    expect(holdsResultsNameConsent({ resultsNameConsent: true, resultsConsentVersion: 5 }, 3)).toBe(true);
    // A consent from before §322, recorded under the notice of its day, names nobody.
    expect(holdsResultsNameConsent({ resultsNameConsent: true, resultsConsentVersion: 1 }, 3)).toBe(false);
    expect(holdsResultsNameConsent({ resultsNameConsent: false, resultsConsentVersion: 3 }, 3)).toBe(false);
    expect(holdsResultsNameConsent({ resultsNameConsent: true, resultsConsentVersion: 3 }, null)).toBe(false);
    expect(holdsResultsNameConsent({ resultsNameConsent: true, resultsConsentVersion: null }, 3)).toBe(false);
  });
});

describe("BR-REQ-072-01 §NNN publicResultName with the consent asked since", () => {
  const older: PublicNameInput = {
    registered: true,
    ticked: true,
    displayName: "Ana Popescu",
    confirmed: true,
    hidden: false,
    noticeVersion: 1,
    firstResultsNoticeVersion: 3,
    typedNameAgreed: false,
    typedDisplayName: null,
    resultsNameConsent: false,
    resultsConsentVersion: 1,
  };
  const asked: PublicNameInput = { ...older, resultsNameConsent: true, resultsConsentVersion: 3 };

  it("keeps an older notice's runner without the consent anonymous, «Participant #bib»", () => {
    expect(publicResultName(older)).toBeNull();
  });

  it("names an older notice's runner who consented under a notice that describes the results", () => {
    expect(publicResultName(asked)).toBe("Ana Popescu");
    expect(publicResultName({ ...asked, resultsConsentVersion: 4 })).toBe("Ana Popescu");
  });

  it("makes the runner anonymous again once the consent is withdrawn", () => {
    expect(publicResultName({ ...asked, resultsNameConsent: false })).toBeNull();
  });

  it("never stands in for the conditions it applied before: the tick, a confirmed registration, a guest the event hides, a name", () => {
    expect(publicResultName({ ...asked, ticked: false })).toBeNull();
    expect(publicResultName({ ...asked, confirmed: false })).toBeNull();
    expect(publicResultName({ ...asked, hidden: true })).toBeNull();
    expect(publicResultName({ ...asked, displayName: "  " })).toBeNull();
    expect(publicResultName({ ...asked, firstResultsNoticeVersion: null })).toBeNull();
    // A consent below the line (the pre-§322 column) is not one.
    expect(publicResultName({ ...asked, resultsConsentVersion: 2 })).toBeNull();
  });

  it("leaves a runner who registered under the results notice unchanged: their tick answers, consent or not", () => {
    const newer: PublicNameInput = { ...older, noticeVersion: 3, resultsConsentVersion: 3 };
    expect(publicResultName(newer)).toBe("Ana Popescu");
    expect(publicResultName({ ...newer, resultsNameConsent: true })).toBe("Ana Popescu");
    expect(publicResultName({ ...newer, ticked: false })).toBeNull();
  });

  it("changes nothing for a runner the club typed by hand", () => {
    const typed: PublicNameInput = { ...older, registered: false, ticked: false, displayName: null, noticeVersion: null, typedNameAgreed: false, typedDisplayName: "Ion", resultsNameConsent: true, resultsConsentVersion: 3 };
    expect(publicResultName(typed)).toBeNull();
    expect(publicResultName({ ...typed, typedNameAgreed: true })).toBe("Ion");
  });
});

describe("BR-REQ-072-01 §NNN the words, in both languages", () => {
  it("names the setting the same in both catalogues' shape, and says what is published and that it is withdrawn", () => {
    for (const catalogue of [ro, en]) {
      const words = catalogue.Registrations.resultsName;
      expect(Object.keys(words).sort()).toEqual(["changed", "failed", "help", "label", "older", "otherAdult", "title"]);
      for (const text of Object.values(words)) expect(text.length).toBeLessThanOrEqual(200);
    }
    expect(ro.Registrations.resultsName.label).toBe("Vreau să apar cu numele în clasament");
    expect(ro.Registrations.resultsName.help).toMatch(/loc.*număr.*timp.*categorie.*debifezi oricând/);
    expect(en.Registrations.resultsName.help).toMatch(/place.*race number.*time.*category.*at any time/);
  });
});
