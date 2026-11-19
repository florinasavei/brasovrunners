import { describe, expect, it } from "vitest";
import { catalogueOf } from "@/i18n/catalogue";
import { type PublicNameInput, publicResultName } from "@/modules/results/domain/public-name";
import { PUBLIC_NAME_REASONS, publicNameReason, publicNameVerdict, type PublicNameReasonInput, UNNAMED_REASONS } from "@/modules/results/domain/public-name-reason";

/**
 * §985, BR-REQ-039-01 — why a published result is «Participant #…» (the owner, 2026-11-18, with every line of «Clasament» reading «Pe site:
 * Participant #001»). The reason is read from `publicResultName`'s own input and is `named` exactly when that function gives a name: one
 * rule, walked here over every combination of the input, and then each reason with the case it names.
 */

const values = {
  registered: [true, false],
  ticked: [true, false],
  displayName: [null, "", "  ", "Ana Popescu"],
  confirmed: [true, false],
  hidden: [true, false],
  noticeVersion: [null, 1, 2, 3],
  firstResultsNoticeVersion: [null, 2],
  resultsNameConsent: [true, false],
  resultsConsentVersion: [null, 1, 3],
  firstResultsNameAskNoticeVersion: [null, 2],
  typedNameAgreed: [true, false],
  typedDisplayName: [null, "", " ", "Ion Vasile"],
  hiddenByClub: [undefined, false, true],
} satisfies { [K in keyof PublicNameReasonInput]-?: readonly PublicNameReasonInput[K][] };

/** Every input the table above makes: 147 456 of them. */
function* everyInput(): Generator<PublicNameReasonInput> {
  const keys = Object.keys(values) as (keyof typeof values)[];
  const walk = function* (index: number, partial: Partial<PublicNameReasonInput>): Generator<PublicNameReasonInput> {
    if (index === keys.length) {
      yield partial as PublicNameReasonInput;
      return;
    }
    const key = keys[index];
    for (const value of values[key] as readonly unknown[]) yield* walk(index + 1, { ...partial, [key]: value });
  };
  yield* walk(0, {});
}

const named: PublicNameInput = {
  registered: true,
  ticked: true,
  displayName: "Ana Popescu",
  confirmed: true,
  hidden: false,
  noticeVersion: 2,
  firstResultsNoticeVersion: 2,
  resultsNameConsent: false,
  resultsConsentVersion: 2,
  firstResultsNameAskNoticeVersion: null,
  typedNameAgreed: false,
  typedDisplayName: null,
};
const typed: PublicNameInput = { ...named, registered: false, ticked: false, displayName: null, confirmed: false, noticeVersion: null, typedNameAgreed: true, typedDisplayName: "Ion Vasile" };

describe("§985 publicNameReason is publicResultName's own rule", () => {
  it("is «named» exactly when publicResultName gives a name, over every combination of the input — and every other answer is a known reason", () => {
    let count = 0;
    const seen = new Set<string>();
    for (const input of everyInput()) {
      count += 1;
      const reason = publicNameReason(input);
      expect(PUBLIC_NAME_REASONS).toContain(reason);
      if ((publicResultName(input) !== null) !== (reason === "named")) throw new Error(`disagree on ${JSON.stringify(input)}: ${reason}`);
      // The verdict the page reads carries the same two answers.
      const verdict = publicNameVerdict(input);
      if (verdict.named !== (publicResultName(input) !== null) || verdict.nameReason !== reason) throw new Error(`verdict differs on ${JSON.stringify(input)}`);
      seen.add(reason);
    }
    expect(count).toBe(147_456);
    // The table reaches every reason, so none of them is a dead branch.
    expect([...seen].sort()).toEqual([...PUBLIC_NAME_REASONS].sort());
  });

  it("never names anybody by `hiddenByClub`: the club's tick only tells the reason apart", () => {
    for (const input of everyInput()) {
      const without = { ...input, hiddenByClub: undefined };
      if ((publicNameReason(input) === "named") !== (publicNameReason(without) === "named")) throw new Error(`hiddenByClub moved the name on ${JSON.stringify(input)}`);
    }
  });
});

describe("§985 each reason names its case", () => {
  it("names a runner the rule names", () => {
    expect(publicNameReason(named)).toBe("named");
    expect(publicNameReason(typed)).toBe("named");
  });

  it("says first that no approved notice describes the results: then nobody is named, whatever else holds", () => {
    expect(publicNameReason({ ...named, firstResultsNoticeVersion: null })).toBe("noResultsNotice");
    expect(publicNameReason({ ...named, firstResultsNoticeVersion: null, ticked: false })).toBe("noResultsNotice");
    expect(publicNameReason({ ...typed, firstResultsNoticeVersion: null })).toBe("noResultsNotice");
    expect(publicNameReason({ ...typed, firstResultsNoticeVersion: null, typedNameAgreed: false })).toBe("noResultsNotice");
  });

  it("says, of a runner typed by hand, that no agreement was recorded — or, of a nameless row, that there is no name", () => {
    expect(publicNameReason({ ...typed, typedNameAgreed: false })).toBe("typedNoAgreement");
    expect(publicNameReason({ ...typed, typedDisplayName: null })).toBe("noName");
    expect(publicNameReason({ ...typed, typedDisplayName: "   ", typedNameAgreed: false })).toBe("noName");
  });

  it("says the person did not tick — and the club's «Apare pe site» only when the person did", () => {
    expect(publicNameReason({ ...named, ticked: false })).toBe("notTicked");
    expect(publicNameReason({ ...named, ticked: false, hiddenByClub: true })).toBe("hiddenByClub");
    expect(publicNameReason({ ...named, ticked: false, hiddenByClub: false })).toBe("notTicked");
  });

  it("says the registration is not confirmed, the guest is hidden, the notice is older — in that order after the tick", () => {
    expect(publicNameReason({ ...named, confirmed: false })).toBe("notConfirmed");
    expect(publicNameReason({ ...named, confirmed: false, ticked: false })).toBe("notTicked");
    expect(publicNameReason({ ...named, hidden: true })).toBe("hiddenGuest");
    expect(publicNameReason({ ...named, hidden: true, confirmed: false })).toBe("notConfirmed");
    expect(publicNameReason({ ...named, noticeVersion: 1 })).toBe("olderNotice");
    expect(publicNameReason({ ...named, noticeVersion: null })).toBe("olderNotice");
    // Asked since under a notice that named the tick (§879): named after all.
    expect(publicNameReason({ ...named, noticeVersion: 1, resultsNameConsent: true, resultsConsentVersion: 3, firstResultsNameAskNoticeVersion: 3 })).toBe("named");
    // A yes recorded under a notice that did not name it counts for nothing.
    expect(publicNameReason({ ...named, noticeVersion: 1, resultsNameConsent: true, resultsConsentVersion: 2, firstResultsNameAskNoticeVersion: 3 })).toBe("olderNotice");
  });

  it("says there is no name to show when every condition holds but the name is blank", () => {
    expect(publicNameReason({ ...named, displayName: "  " })).toBe("noName");
    expect(publicNameReason({ ...named, displayName: null })).toBe("noName");
  });
});

describe("§985 BR-REQ-040-04 every reason has its sentence in both languages", () => {
  it("has `Admin.results.publicWhy.<reason>` for every reason but «named», in Romanian and in English", () => {
    for (const locale of ["ro", "en"] as const) {
      const why = (catalogueOf(locale) as unknown as { Admin: { results: { publicWhy: Record<string, string> } } }).Admin.results.publicWhy;
      expect(Object.keys(why).sort(), locale).toEqual([...UNNAMED_REASONS].sort());
      for (const reason of UNNAMED_REASONS) expect(why[reason]?.trim(), `${locale} ${reason}`).toBeTruthy();
    }
  });
});
