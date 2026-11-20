import { describe, expect, it } from "vitest";
import { type ListChoiceFacts, listChoiceState } from "@/modules/registrations/domain/list-choice";
import { RESULT_EVENT_TYPES } from "@/modules/results/domain/event-type";
import { publicResultName } from "@/modules/results/domain/public-name";

/**
 * BR-REQ-039-01, §NNN — what «Lista publică și clasamentul» says about a registration's name on «Gestionează înscrierea» and
 * «Înscrierile mele». The tick is one for the list and the results (§570, §808), so the block names both, but it may say «și în
 * clasament» only where the published results would print the name — the results' own rule, `publicResultName`, walked here over
 * every combination of the facts the block reads, for a runner the sentence speaks of: the tick on, confirmed, shown, with a name.
 */

const values = {
  listed: [true, false],
  eventType: [null, "RACE", "GROUP_RUN", "HIKE", "EXTERNAL"],
  privacyNoticeVersion: [1, 2, 3],
  resultsNameConsent: [true, false],
  resultsConsentVersion: [null, 1, 2, 3],
  firstResultsNoticeVersion: [null, 2],
  firstResultsNameAskNoticeVersion: [null, 2, 3],
} satisfies { [K in keyof ListChoiceFacts]-?: readonly ListChoiceFacts[K][] };

function* everyFact(): Generator<ListChoiceFacts> {
  const keys = Object.keys(values) as (keyof typeof values)[];
  const walk = function* (index: number, partial: Partial<ListChoiceFacts>): Generator<ListChoiceFacts> {
    if (index === keys.length) {
      yield partial as ListChoiceFacts;
      return;
    }
    for (const value of values[keys[index]] as readonly unknown[]) yield* walk(index + 1, { ...partial, [keys[index]]: value });
  };
  yield* walk(0, {});
}

/** Whether the published results print this registration's name, the person on the list and confirmed (§808, §879). */
const resultsName = (facts: ListChoiceFacts) =>
  publicResultName({
    registered: true,
    ticked: true,
    displayName: "Ana Popescu",
    confirmed: true,
    hidden: false,
    noticeVersion: facts.privacyNoticeVersion,
    firstResultsNoticeVersion: facts.firstResultsNoticeVersion,
    resultsNameConsent: facts.resultsNameConsent,
    resultsConsentVersion: facts.resultsConsentVersion,
    firstResultsNameAskNoticeVersion: facts.firstResultsNameAskNoticeVersion,
    typedNameAgreed: false,
    typedDisplayName: null,
  });

/** A race registration under the first notice that describes the results: the case the block names both for. */
const underResults: ListChoiceFacts = {
  listed: true,
  eventType: "RACE",
  privacyNoticeVersion: 2,
  resultsNameConsent: false,
  resultsConsentVersion: 2,
  firstResultsNoticeVersion: 2,
  firstResultsNameAskNoticeVersion: null,
};

describe("BR-REQ-039-01 the list's block says where the name stands, by the results' own rule (§NNN)", () => {
  it("says «și în clasament» exactly where the results print the name, over every combination — and off the list, neither", () => {
    let count = 0;
    const seen = new Set<string>();
    for (const facts of everyFact()) {
      count += 1;
      const state = listChoiceState(facts);
      seen.add(state);
      const race = facts.eventType !== null && RESULT_EVENT_TYPES.includes(facts.eventType);
      const expected = !facts.listed ? "notListed" : race && resultsName(facts) !== null ? "listedWithResults" : "listed";
      if (state !== expected) throw new Error(`${JSON.stringify(facts)}: ${state}, expected ${expected}`);
    }
    expect(count).toBe(2 * 5 * 3 * 2 * 4 * 2 * 3);
    expect([...seen].sort()).toEqual(["listed", "listedWithResults", "notListed"]);
  });

  it("names the results for a race registered under a notice that describes them, or a later one", () => {
    expect(listChoiceState(underResults)).toBe("listedWithResults");
    expect(listChoiceState({ ...underResults, privacyNoticeVersion: 3 })).toBe("listedWithResults");
  });

  it("names only the list for an older notice's runner — the results print «Participant #…» — until they asked under the notice that names the question", () => {
    const older = { ...underResults, privacyNoticeVersion: 1, resultsConsentVersion: 1 };
    expect(listChoiceState(older)).toBe("listed");
    // §879: a yes counts only given under the first notice that named «Vreau să apar cu numele în clasament», or a later one.
    expect(listChoiceState({ ...older, resultsNameConsent: true, resultsConsentVersion: 3, firstResultsNameAskNoticeVersion: 3 })).toBe("listedWithResults");
    expect(listChoiceState({ ...older, resultsNameConsent: true, resultsConsentVersion: 2, firstResultsNameAskNoticeVersion: 3 })).toBe("listed");
    // A yes the page did not read the line for (nobody on it said yes) is a no.
    expect(listChoiceState({ ...older, resultsNameConsent: false, resultsConsentVersion: 3, firstResultsNameAskNoticeVersion: null })).toBe("listed");
  });

  it("names only the list while no notice describes the results, and on every event that takes none", () => {
    expect(listChoiceState({ ...underResults, firstResultsNoticeVersion: null })).toBe("listed");
    for (const eventType of ["GROUP_RUN", "HIKE", "EXTERNAL", null]) expect(listChoiceState({ ...underResults, eventType })).toBe("listed");
  });

  it("off the list says so whatever the notices and the event, a yes to the results' question included", () => {
    for (const facts of everyFact()) if (!facts.listed) expect(listChoiceState(facts)).toBe("notListed");
    expect(listChoiceState({ ...underResults, listed: false, resultsNameConsent: true, resultsConsentVersion: 3, firstResultsNameAskNoticeVersion: 2 })).toBe("notListed");
  });
});
