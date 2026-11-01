import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";

/**
 * What the privacy notice's `{{results}}` becomes (§808, race results part 1): the public section's own name on an
 * event's page, quoted, in that language — „Clasament” / “Results” — read from the catalogue the page's heading
 * reads (`Event.results.title`), so the approved sentence names what a visitor sees. Outside a request, like
 * `volunteers/notice-words.ts`, for the legal pages, the declaration and the token legend.
 */
export function resultsClause(locale: string): string {
  return locale === "en" ? `“${en.Event.results.title}”` : `„${ro.Event.results.title}”`;
}

/**
 * What the privacy notice's `{{resultsNameAsk}}` becomes (§NNN): the tick an older notice's runner finds on their own registration's
 * page, quoted, in that language — „Vreau să apar cu numele în clasament” / “I want to appear by name in the results” — read from the
 * catalogue the page reads (`Registrations.resultsName.label`), so the approved sentence names what the runner sees.
 */
export function resultsNameAskClause(locale: string): string {
  return locale === "en" ? `“${en.Registrations.resultsName.label}”` : `„${ro.Registrations.resultsName.label}”`;
}

/** The notice's merge values, beside the other features' on the legal pages. */
export function resultsMergeValues(locale: string): { results: string; resultsNameAsk: string } {
  return { results: resultsClause(locale), resultsNameAsk: resultsNameAskClause(locale) };
}
