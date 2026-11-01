import { describe, expect, it } from "vitest";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { describesResults, describesResultsNameAsk, MERGE_FIELDS, mergeText, RESULTS_NAME_ASK_MERGE_FIELD } from "@/modules/legal-documents/domain/merge-fields";
import { privacyNoticeEn, privacyNoticeRo } from "@/modules/legal-documents/templates/privacy-notice";
import { DECLARATION_TOKENS } from "@/modules/legal-documents/templates/tokens";
import { holdsResultsNameConsent, resultsNameConsentLine, resultsNameConsentOffered } from "@/modules/results/domain/name-consent";
import { type PublicNameInput, publicResultName } from "@/modules/results/domain/public-name";
import { resultsMergeValues, resultsNameAskClause } from "@/modules/results/notice-words";

/**
 * BR-REQ-072-01, §879 — «Vreau să apar cu numele în clasament»: the runner who registered under a privacy notice older than the first
 * that described the results asks, from their own registration's page, to be named in a race's published results.
 *
 * The rule the page, the server and the public read share: asked only while the notice in force names the tick's own marker
 * `{{resultsNameAsk}}` beside `{{results}}` — describing the results is not enough, the platform's template describes them in the
 * section that tells these runners they stay «Participant #numărul» — only for a race, only of a registration whose notice is below
 * the first results notice; a consent counts only when given under a notice at or above the first that named the marker; and the
 * name still needs every condition `publicResultName` applied before (§808): the tick, a confirmed registration, not a hidden guest.
 */
const facts = { noticeDescribesResultsNameAsk: true, firstResultsNoticeVersion: 3, eventType: "RACE" };

describe("BR-REQ-072-01 §879 when «Vreau să apar cu numele în clasament» is asked", () => {
  it("draws the line at the first results notice for a race while the notice in force names the tick and the results", () => {
    expect(resultsNameConsentLine(facts)).toBe(3);
  });

  it("draws no line — nothing is asked — while the notice in force does not name the tick, however it describes the results", () => {
    expect(resultsNameConsentLine({ ...facts, noticeDescribesResultsNameAsk: false })).toBeNull();
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

  it("counts a consent only when given under a notice at or above the first that named the tick", () => {
    expect(holdsResultsNameConsent({ resultsNameConsent: true, resultsConsentVersion: 3 }, 3)).toBe(true);
    expect(holdsResultsNameConsent({ resultsNameConsent: true, resultsConsentVersion: 5 }, 3)).toBe(true);
    // A consent from before §322, recorded under the notice of its day, names nobody.
    expect(holdsResultsNameConsent({ resultsNameConsent: true, resultsConsentVersion: 1 }, 3)).toBe(false);
    // Nor one recorded under a notice that described the results (v3) but did not yet name the tick (first named at v4).
    expect(holdsResultsNameConsent({ resultsNameConsent: true, resultsConsentVersion: 3 }, 4)).toBe(false);
    expect(holdsResultsNameConsent({ resultsNameConsent: false, resultsConsentVersion: 3 }, 3)).toBe(false);
    expect(holdsResultsNameConsent({ resultsNameConsent: true, resultsConsentVersion: 3 }, null)).toBe(false);
    expect(holdsResultsNameConsent({ resultsNameConsent: true, resultsConsentVersion: null }, 3)).toBe(false);
  });
});

describe("BR-REQ-072-01 §879 publicResultName with the consent asked since", () => {
  const older: PublicNameInput = {
    registered: true,
    ticked: true,
    displayName: "Ana Popescu",
    confirmed: true,
    hidden: false,
    noticeVersion: 1,
    firstResultsNoticeVersion: 3,
    // The results were first described at v3; the tick was first named at v4.
    firstResultsNameAskNoticeVersion: 4,
    typedNameAgreed: false,
    typedDisplayName: null,
    resultsNameConsent: false,
    resultsConsentVersion: 1,
  };
  const asked: PublicNameInput = { ...older, resultsNameConsent: true, resultsConsentVersion: 4 };

  it("keeps an older notice's runner without the consent anonymous, «Participant #bib»", () => {
    expect(publicResultName(older)).toBeNull();
  });

  it("names an older notice's runner who consented under a notice that named the tick", () => {
    expect(publicResultName(asked)).toBe("Ana Popescu");
    expect(publicResultName({ ...asked, resultsConsentVersion: 5 })).toBe("Ana Popescu");
  });

  it("names nobody on a yes recorded under a notice that described the results but not the tick, or while no notice named it", () => {
    expect(publicResultName({ ...asked, resultsConsentVersion: 3 })).toBeNull();
    expect(publicResultName({ ...asked, firstResultsNameAskNoticeVersion: null })).toBeNull();
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
    // A consent below the results line (the pre-§322 column) is not one.
    expect(publicResultName({ ...asked, resultsConsentVersion: 2 })).toBeNull();
  });

  it("leaves a runner who registered under the results notice unchanged: their tick answers, consent or not", () => {
    const newer: PublicNameInput = { ...older, noticeVersion: 3, resultsConsentVersion: 3 };
    expect(publicResultName(newer)).toBe("Ana Popescu");
    expect(publicResultName({ ...newer, resultsNameConsent: true })).toBe("Ana Popescu");
    expect(publicResultName({ ...newer, ticked: false })).toBeNull();
  });

  it("is one reading with the page's tick: a yes the page draws ticked is exactly a yes the results name an older runner by", () => {
    // The page draws the tick by `holdsResultsNameConsent`; for an older notice's runner who passes every other condition, the
    // published name follows it — a yes under a notice that only described the results (v3) is drawn empty and stays anonymous.
    for (const version of [1, 2, 3, 4, 5]) {
      for (const consent of [true, false]) {
        const row = { ...asked, resultsNameConsent: consent, resultsConsentVersion: version };
        expect(publicResultName(row) !== null, `v${version} ${consent}`).toBe(holdsResultsNameConsent(row, row.firstResultsNameAskNoticeVersion));
      }
    }
  });

  it("changes nothing for a runner the club typed by hand", () => {
    const typed: PublicNameInput = { ...older, registered: false, ticked: false, displayName: null, noticeVersion: null, typedNameAgreed: false, typedDisplayName: "Ion", resultsNameConsent: true, resultsConsentVersion: 3 };
    expect(publicResultName(typed)).toBeNull();
    expect(publicResultName({ ...typed, typedNameAgreed: true })).toBe("Ion");
  });
});

describe("BR-REQ-072-01 §879 the words, in both languages", () => {
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

describe("BR-REQ-072-01 §879 the notice's own marker {{resultsNameAsk}}", () => {
  it("is a known merge field, distinct from {{results}}, and a notice opens the tick only by naming it", () => {
    expect(MERGE_FIELDS).toContain(RESULTS_NAME_ASK_MERGE_FIELD);
    expect(describesResultsNameAsk({ sections: [{ heading: "4", paragraphs: ["Clasamentul ({{results}})."] }] })).toBe(false);
    expect(describesResultsNameAsk({ sections: [{ heading: "4", paragraphs: ["Bifa {{resultsNameAsk}}."] }] })).toBe(true);
  });

  it("is absent from the platform's template, whose section 4 tells the older registrants they stay «Participant #număr»: approving it as it is asks nobody", () => {
    for (const body of [privacyNoticeRo, privacyNoticeEn]) {
      expect(describesResults(body)).toBe(true);
      expect(describesResultsNameAsk(body)).toBe(false);
    }
  });

  it("is filled with the tick's own words, quoted, in each language, and has a legend entry in both catalogues", () => {
    expect(resultsNameAskClause("ro")).toBe(`„${ro.Registrations.resultsName.label}”`);
    expect(resultsNameAskClause("en")).toBe(`“${en.Registrations.resultsName.label}”`);
    expect(mergeText("Bifa {{resultsNameAsk}}.", resultsMergeValues("ro"))).toBe("Bifa „Vreau să apar cu numele în clasament”.");
    const entry = DECLARATION_TOKENS.find((token) => token.token === "{{resultsNameAsk}}");
    expect(entry?.messageKey).toBe("resultsNameAsk");
    expect(entry?.example.ro).toBe(resultsNameAskClause("ro"));
    expect(ro.Admin.legal.tokens.resultsNameAsk).toContain("Vreau să apar cu numele în clasament");
    expect(en.Admin.legal.tokens.resultsNameAsk).toContain("I want to appear by name in the results");
  });
});
