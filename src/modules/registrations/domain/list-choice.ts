import { eventTakesResults } from "@/modules/results/domain/event-type";
import { publicResultName } from "@/modules/results/domain/public-name";

/**
 * What the public-list choice's block says about a registration's name (§1016, BR-REQ-039-01): the block «Lista publică și
 * clasamentul» on «Gestionează înscrierea» and on «Înscrierile mele». It changes how the choice is drawn, never the rule
 * (§143, §186): the tick is the person's own, off unless they gave it, and the one write is `list-consent.ts`'s.
 *
 * One tick for the list and the results (§570, §808), so on a race the block names both — but it says «și în clasament» only where
 * the published results would print the name: a race (`eventTakesResults`) whose results a privacy notice describes, the
 * registration made under that notice or a later one, or the runner who registered before it and asked since («Vreau să apar cu
 * numele în clasament», §879). That is the results' own rule, `publicResultName`, asked with what the block's sentence already
 * speaks for held true — the tick on, the registration confirmed and shown, a name to print — so the page can never say «în
 * clasament» while the results print «Participant #…» (the older notice's runner, whose own question is on the same page). An event
 * that takes no results (a group run, a hike) has no ranking: there the block names the list alone, its heading too.
 *
 * Off the list, the block names what the public list prints instead only where it can print it: the list draws a «Participant (nume
 * ascuns)» row only for a confirmed registration inside the places, and only on an event whose list is shown — on (`NAMES`) and
 * inside the club's days after the event (§421; §186, `countAnonymousStartListEntries`). A pending or waiting registration off the
 * list is not on it at all, nor is one on «Lista de invitați speciali» (§743), and an event that publishes no list (the default)
 * draws no row: there the sentence says only that the name is not on the list, with «și nici în clasament» on a race, where it is
 * true whatever the notices say.
 *
 * Under the club's «Toate numele în clasament» (§NNN, `events.results_all_names`) the results print the name whatever the person
 * ticked: a ticked person's block says «și în clasament» by the same rule, asked with `allNames`, and an unticked one's says only that
 * the name is not on the list — never «nici în clasament», which the published results would contradict.
 *
 * Pure, so both pages and the test read one answer.
 */
export const LIST_CHOICE_STATES = [
  "listedWithResults",
  "listed",
  "notListedCountedWithResults",
  "notListedCounted",
  "notListedWithResults",
  "notListed",
] as const;

/** Each one is a sentence of `Registrations.list.choice`, under its own name. */
export type ListChoiceState = (typeof LIST_CHOICE_STATES)[number];

export type ListChoiceFacts = {
  /** The person's own answer: `registrations.list_opt_out` false. */
  listed: boolean;
  /** The registration is `CONFIRMED`: the only state the public list draws a «Participant (nume ascuns)» row for (§186). */
  confirmed: boolean;
  /**
   * On «Lista de invitați speciali» (`registrations.outside_capacity`, §643): off the list, never a public list's row, not even a
   * «Participant (nume ascuns)» one (§743).
   */
  outsideCapacity: boolean;
  /** The event's public participant list is drawn now: on (`NAMES`) and inside the club's days after the event (§421). */
  listShown: boolean;
  /** The event's type, or null when it could not be read: only a race takes results. */
  eventType: string | null;
  /** The privacy notice the registration recorded. */
  privacyNoticeVersion: number;
  /** «Vreau să apar cu numele în clasament», asked since by a runner under an older notice (§879), and the notice it was given under. */
  resultsNameConsent: boolean;
  resultsConsentVersion: number | null;
  /** The first approved notice that described the results (`cachedFirstResultsNoticeVersion`); null while none has. */
  firstResultsNoticeVersion: number | null;
  /**
   * The first approved notice that named that question (`cachedFirstResultsNameAskNoticeVersion`). A page may leave it null while
   * no registration it draws said yes: a no is never named by it, as `holdsResultsNameConsent` reads it.
   */
  firstResultsNameAskNoticeVersion: number | null;
  /** «Toate numele în clasament» on the event (§NNN): the results name every confirmed runner, whatever they ticked. Absent is off. */
  resultsAllNames?: boolean;
};

/** Whether the block names the results at all — its heading and «nici în clasament»: only on an event that takes them (§808). */
export function listChoiceNamesResults(eventType: string | null): boolean {
  return eventType !== null && eventTakesResults(eventType);
}

/** What the sentence holds true, for the results' rule: the name the block speaks of is shown, confirmed, and has letters. */
const SHOWN_AND_CONFIRMED = { registered: true, ticked: true, confirmed: true, hidden: false, displayName: "name", typedNameAgreed: false, typedDisplayName: null } as const;

export function listChoiceState(facts: ListChoiceFacts): ListChoiceState {
  const results = listChoiceNamesResults(facts.eventType);
  const allNames = facts.resultsAllNames === true;
  if (!facts.listed) {
    // «…și nici în clasament» only while the results follow the person's tick: never under the club's «Toate numele» (§NNN).
    const notRanked = results && !allNames;
    // The row the public list prints in place of the name: the confirmed inside the places, where the list is drawn (§186, §743).
    if (facts.confirmed && !facts.outsideCapacity && facts.listShown) return notRanked ? "notListedCountedWithResults" : "notListedCounted";
    return notRanked ? "notListedWithResults" : "notListed";
  }
  if (!results) return "listed";
  const named = publicResultName({
    ...SHOWN_AND_CONFIRMED,
    noticeVersion: facts.privacyNoticeVersion,
    firstResultsNoticeVersion: facts.firstResultsNoticeVersion,
    resultsNameConsent: facts.resultsNameConsent,
    resultsConsentVersion: facts.resultsConsentVersion,
    firstResultsNameAskNoticeVersion: facts.firstResultsNameAskNoticeVersion,
    allNames,
  });
  return named === null ? "listed" : "listedWithResults";
}
