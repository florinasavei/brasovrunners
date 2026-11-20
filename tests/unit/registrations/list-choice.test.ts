import { describe, expect, it } from "vitest";
import { catalogueOf } from "@/i18n/catalogue";
import { LIST_CHOICE_STATES, type ListChoiceFacts, type ListChoiceState, listChoiceNamesResults, listChoiceState } from "@/modules/registrations/domain/list-choice";

/**
 * BR-REQ-039-01, §1016 — what «Lista publică și clasamentul» says about a registration's name on «Gestionează înscrierea» and
 * «Înscrierile mele». The tick is one for the list and the results (§570, §808), so on a race the block names both, but it may say
 * «și în clasament» only where the published results would print the name; and off the list it may say «pe listă apari ca
 * „Participant (nume ascuns)”» only where the public list draws that row — a confirmed registration inside the places, on a list the
 * event shows (§186, §743).
 */

const values = {
  listed: [true, false],
  confirmed: [true, false],
  outsideCapacity: [false, true],
  listShown: [true, false],
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

/**
 * The rule, written out by hand — not by asking the results' own function, which the block asks:
 *
 * - only a race takes results (§808);
 * - on a race the published results print a listed, confirmed runner's name when a notice describes the results and the
 *   registration recorded that notice or a later one, or — an older notice's runner — said yes since to «Vreau să apar cu numele în
 *   clasament» under a notice at or above the first that named it (§879);
 * - off the list, the public list prints «Participant (nume ascuns)» for a confirmed registration — never for one on «Lista de
 *   invitați speciali», which it does not draw at all off the list (§743) — and only while the event shows its list (§186, §421).
 */
function expected(facts: ListChoiceFacts): ListChoiceState {
  const race = facts.eventType === "RACE";
  if (!facts.listed) {
    if (facts.confirmed && !facts.outsideCapacity && facts.listShown) return race ? "notListedCountedWithResults" : "notListedCounted";
    return race ? "notListedWithResults" : "notListed";
  }
  if (!race || facts.firstResultsNoticeVersion === null) return "listed";
  const underResults = facts.privacyNoticeVersion >= facts.firstResultsNoticeVersion;
  const askedSince =
    facts.resultsNameConsent &&
    facts.firstResultsNameAskNoticeVersion !== null &&
    facts.resultsConsentVersion !== null &&
    facts.resultsConsentVersion >= facts.firstResultsNameAskNoticeVersion;
  return underResults || askedSince ? "listedWithResults" : "listed";
}

/** A confirmed race registration inside the places, under the first notice that describes the results, on a list the event shows. */
const underResults: ListChoiceFacts = {
  listed: true,
  confirmed: true,
  outsideCapacity: false,
  listShown: true,
  eventType: "RACE",
  privacyNoticeVersion: 2,
  resultsNameConsent: false,
  resultsConsentVersion: 2,
  firstResultsNoticeVersion: 2,
  firstResultsNameAskNoticeVersion: null,
};

describe("BR-REQ-039-01 the list's block says where the name stands, and only what the list and the results draw (§1016)", () => {
  it("follows the rule written out by hand over every combination of the facts it reads", () => {
    let count = 0;
    const seen = new Set<string>();
    for (const facts of everyFact()) {
      count += 1;
      const state = listChoiceState(facts);
      seen.add(state);
      if (state !== expected(facts)) throw new Error(`${JSON.stringify(facts)}: ${state}, expected ${expected(facts)}`);
    }
    expect(count).toBe(2 * 2 * 2 * 2 * 5 * 3 * 2 * 4 * 2 * 3);
    expect([...seen].sort()).toEqual([...LIST_CHOICE_STATES].sort());
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

  it("off the list, says «Participant (nume ascuns)» only for a confirmed registration on a list the event shows — never for a pending one, a special guest or a list that is off", () => {
    const off = { ...underResults, listed: false };
    expect(listChoiceState(off)).toBe("notListedCountedWithResults");
    // Pending or waiting: the public list draws no row for them at all (§186).
    expect(listChoiceState({ ...off, confirmed: false })).toBe("notListedWithResults");
    // On «Lista de invitați speciali», unticked: not even a «Participant (nume ascuns)» row (§743, BR-REQ-039-01 criteria 30, 37).
    expect(listChoiceState({ ...off, outsideCapacity: true })).toBe("notListedWithResults");
    // The event publishes no list (the default), or its days after the event are over (§421): no row either.
    expect(listChoiceState({ ...off, listShown: false })).toBe("notListedWithResults");
    // A yes to the results' question names nobody off the list.
    expect(listChoiceState({ ...off, resultsNameConsent: true, resultsConsentVersion: 3, firstResultsNameAskNoticeVersion: 2 })).toBe("notListedCountedWithResults");
  });

  it("never names the results — heading or sentence — on an event that takes none", () => {
    for (const eventType of ["GROUP_RUN", "HIKE", "EXTERNAL", null]) {
      expect(listChoiceNamesResults(eventType)).toBe(false);
      expect(listChoiceState({ ...underResults, eventType, listed: false })).toBe("notListedCounted");
      expect(listChoiceState({ ...underResults, eventType, listed: false, confirmed: false })).toBe("notListed");
    }
    expect(listChoiceNamesResults("RACE")).toBe(true);
  });

  it("has every state's sentence in both catalogues, the public list's label only in the two that say the row", () => {
    for (const locale of ["ro", "en"] as const) {
      const sentences: Record<string, string> = catalogueOf(locale).Registrations.list.choice;
      for (const state of LIST_CHOICE_STATES) {
        expect(sentences[state], `${locale}: ${state}`).toBeTruthy();
        expect(sentences[state].includes("{anonymous}"), `${locale}: ${state}`).toBe(state.startsWith("notListedCounted"));
      }
    }
  });
});
