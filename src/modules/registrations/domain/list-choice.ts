import { eventTakesResults } from "@/modules/results/domain/event-type";
import { publicResultName } from "@/modules/results/domain/public-name";

/**
 * What the public-list choice's block says about a registration's name (§NNN, BR-REQ-039-01): the block «Lista publică și
 * clasamentul» on «Gestionează înscrierea» and on «Înscrierile mele». It changes how the choice is drawn, never the rule
 * (§143, §186): the tick is the person's own, off unless they gave it, and the one write is `list-consent.ts`'s.
 *
 * One tick for the list and the results (§570, §808), so the block names both — but it says «și în clasament» only where the
 * published results would print the name: a race (`eventTakesResults`) whose results a privacy notice describes, the
 * registration made under that notice or a later one, or the runner who registered before it and asked since («Vreau să apar cu
 * numele în clasament», §879). That is the results' own rule, `publicResultName`, asked with what the block's sentence already
 * speaks for held true — the tick on, the registration confirmed and shown, a name to print — so the page can never say «în
 * clasament» while the results print «Participant #…» (the older notice's runner, whose own question is on the same page). Off the
 * list, the name is in neither, and the page says so with the label the public list prints instead (`Event.startList.anonymous`).
 *
 * Pure, so both pages and the test read one answer.
 */
export type ListChoiceState = "listedWithResults" | "listed" | "notListed";

export type ListChoiceFacts = {
  /** The person's own answer: `registrations.list_opt_out` false. */
  listed: boolean;
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
};

/** What the sentence holds true, for the results' rule: the name the block speaks of is shown, confirmed, and has letters. */
const SHOWN_AND_CONFIRMED = { registered: true, ticked: true, confirmed: true, hidden: false, displayName: "name", typedNameAgreed: false, typedDisplayName: null } as const;

export function listChoiceState(facts: ListChoiceFacts): ListChoiceState {
  if (!facts.listed) return "notListed";
  if (facts.eventType === null || !eventTakesResults(facts.eventType)) return "listed";
  const named = publicResultName({
    ...SHOWN_AND_CONFIRMED,
    noticeVersion: facts.privacyNoticeVersion,
    firstResultsNoticeVersion: facts.firstResultsNoticeVersion,
    resultsNameConsent: facts.resultsNameConsent,
    resultsConsentVersion: facts.resultsConsentVersion,
    firstResultsNameAskNoticeVersion: facts.firstResultsNameAskNoticeVersion,
  });
  return named === null ? "listed" : "listedWithResults";
}
