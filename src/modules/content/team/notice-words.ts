import en from "../../../../messages/en.json";
import ro from "../../../../messages/ro.json";

/**
 * The privacy notice's `{{teamPage}}` (§459): the team page's own quoted title from the catalogue,
 * so the notice and the heading cannot differ. Works outside a request.
 */
export function teamPageClause(locale: string): string {
  return locale === "en" ? `“${en.Team.title}”` : `„${ro.Team.title}”`;
}

export function teamPageMergeValues(locale: string): { teamPage: string } {
  return { teamPage: teamPageClause(locale) };
}
