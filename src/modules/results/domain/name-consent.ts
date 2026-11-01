import { eventTakesResults } from "./event-type";

/**
 * «Vreau să apar cu numele în clasament» — the runner who registered under an older privacy notice asks, after registration, to be
 * named in a race's published results (§NNN; the owner asked for it, §808 having left those runners to the owner and the lawyer).
 *
 * The line is §808's: a tick given under a notice that said «Rezultate cu nume nu publicăm încă» agreed to a list, not to a ranking by
 * name, so `publicResultName` shows such a runner as «Participant #bib». This is the separate asking the older terms promised: the
 * runner's own press, on their own registration's page, recorded with the notice in force at the moment (`results_consent_version`).
 *
 * **It does nothing until the club's texts allow it.** The question is put only while the privacy notice in force, in every language,
 * describes the results (`noticeDescribesResults`, so `firstResultsNoticeVersion` is not null either), only for a race (the one event
 * that takes results, `eventTakesResults`), and only to a registration whose own notice predates the first that described them — a
 * runner who registered under that notice or a later one was told already, and their tick answers. Pure, so the page that draws the
 * button, the server that accepts the press and the test that pins it read one rule.
 */

/** The line a registration's notice must be under for the question to be put: the first results notice, or null while nothing may be asked. */
export function resultsNameConsentLine(facts: { noticeDescribesResults: boolean; firstResultsNoticeVersion: number | null; eventType: string }): number | null {
  if (!facts.noticeDescribesResults || facts.firstResultsNoticeVersion === null) return null;
  if (!eventTakesResults(facts.eventType)) return null;
  return facts.firstResultsNoticeVersion;
}

/** Whether this registration is asked: the line is drawn and the notice it recorded is below it. */
export function resultsNameConsentOffered(noticeVersion: number, line: number | null): boolean {
  return line !== null && noticeVersion < line;
}

/**
 * Whether the runner said yes from their own page since registering (the yes recorded a notice newer than the registration's own):
 * what the page offers the way out of, whatever the notice in force says today (art. 7(3) GDPR). A pre-§322 yes, recorded with the
 * registration's own notice, is not one.
 */
export function gaveResultsNameConsentSince(row: { resultsNameConsent: boolean; resultsConsentVersion: number; privacyNoticeVersion: number }): boolean {
  return row.resultsNameConsent && row.resultsConsentVersion > row.privacyNoticeVersion;
}

/**
 * Whether a registration holds a consent that counts (`publicResultName`'s own reading): given, and under a notice at or above the
 * first that described the results. A consent from before §322, recorded under the notice of its day, counts for nothing.
 */
export function holdsResultsNameConsent(row: { resultsNameConsent: boolean; resultsConsentVersion: number | null }, firstResultsNoticeVersion: number | null): boolean {
  return row.resultsNameConsent && firstResultsNoticeVersion !== null && row.resultsConsentVersion !== null && row.resultsConsentVersion >= firstResultsNoticeVersion;
}
