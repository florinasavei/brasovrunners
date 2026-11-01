import { eventTakesResults } from "./event-type";

/**
 * «Vreau să apar cu numele în clasament» — the runner who registered under an older privacy notice asks, after registration, to be
 * named in a race's published results (§NNN; the owner asked for it, §808 having left those runners to the owner and the lawyer).
 *
 * The line is §808's: a tick given under a notice that said «Rezultate cu nume nu publicăm încă» agreed to a list, not to a ranking by
 * name, so `publicResultName` shows such a runner as «Participant #bib». This is the separate asking the older terms promised: the
 * runner's own press, on their own registration's page, recorded with the notice in force at the moment (`results_consent_version`).
 *
 * **It does nothing until the club approves a text that says so.** Describing the results (`{{results}}`) is not enough: the
 * platform's template names it in the very section that tells the older registrants they appear «doar cu numărul … chiar dacă ai
 * bifat». So the question is put only while the privacy notice in force, in every language, names the tick's own marker
 * `{{resultsNameAsk}}` beside `{{results}}` (`noticeDescribesResultsNameAsk`), which the club and its lawyer add when they amend that
 * sentence; only for a race (the one event that takes results, `eventTakesResults`); and only to a registration whose own notice
 * predates the first that described the results — a runner who registered under that notice or a later one was told already, and
 * their tick answers. A yes counts only when given under a notice at or above the first that named the marker
 * (`firstResultsNameAskNoticeVersion`). Pure, so the page that draws the button, the server that accepts the press and the test that
 * pins it read one rule.
 */

/**
 * The line a registration's notice must be under for the question to be put: the first results notice, or null while nothing may be
 * asked — the notice in force does not name `{{resultsNameAsk}}` and `{{results}}` in every language, or the event takes no results.
 */
export function resultsNameConsentLine(facts: { noticeDescribesResultsNameAsk: boolean; firstResultsNoticeVersion: number | null; eventType: string }): number | null {
  if (!facts.noticeDescribesResultsNameAsk || facts.firstResultsNoticeVersion === null) return null;
  if (!eventTakesResults(facts.eventType)) return null;
  return facts.firstResultsNoticeVersion;
}

/** Whether this registration is asked: the line is drawn and the notice it recorded is below it. */
export function resultsNameConsentOffered(noticeVersion: number, line: number | null): boolean {
  return line !== null && noticeVersion < line;
}

/**
 * Whether a registration holds a consent that counts: given, and under a notice at or above the first that named «Vreau să apar cu
 * numele în clasament» (`firstResultsNameAskNoticeVersion`). A consent from before §322, or one recorded under a notice that described
 * the results but not the tick, counts for nothing. The **one** reading of a yes: `publicResultName` names the runner by it, the
 * press treats it as the answer already given (a yes again is no change), and the manage page draws the tick ticked by it and offers
 * its way out whatever the notice in force says today (art. 7(3) GDPR) — so the page never says «named» while the results show
 * «Participant #bib».
 */
export function holdsResultsNameConsent(row: { resultsNameConsent: boolean; resultsConsentVersion: number | null }, firstResultsNameAskNoticeVersion: number | null): boolean {
  return (
    row.resultsNameConsent &&
    firstResultsNameAskNoticeVersion !== null &&
    row.resultsConsentVersion !== null &&
    row.resultsConsentVersion >= firstResultsNameAskNoticeVersion
  );
}
