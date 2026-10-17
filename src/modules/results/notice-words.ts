import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";

/**
 * What the privacy notice's `{{results}}` becomes (§NNN, race results part 1): the public section's own name on an
 * event's page, quoted, in that language — „Clasament” / “Results” — read from the catalogue the page's heading
 * reads (`Event.results.title`), so the approved sentence names what a visitor sees. Outside a request, like
 * `volunteers/notice-words.ts`, for the legal pages, the declaration and the token legend.
 */
export function resultsClause(locale: string): string {
  return locale === "en" ? `“${en.Event.results.title}”` : `„${ro.Event.results.title}”`;
}

/** The notice's merge value, beside the other features' on the legal pages. */
export function resultsMergeValues(locale: string): { results: string } {
  return { results: resultsClause(locale) };
}
