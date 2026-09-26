import en from "../../../../messages/en.json";
import ro from "../../../../messages/ro.json";

/**
 * What the privacy notice's `{{teamPage}}` becomes (§459): the team page's own title in that
 * language, quoted — „Echipa” / “The team” — read from the catalogue the page itself reads, so the
 * approved sentence and the page's heading cannot name different things. Outside a request, like
 * `registrations/list-state-words.ts`.
 */
export function teamPageClause(locale: string): string {
  return locale === "en" ? `“${en.Team.title}”` : `„${ro.Team.title}”`;
}

/** The notice's merge value, beside the deadlines' and the list states' on the legal pages. */
export function teamPageMergeValues(locale: string): { teamPage: string } {
  return { teamPage: teamPageClause(locale) };
}
