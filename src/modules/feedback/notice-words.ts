import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";

/**
 * What the privacy notice's `{{feedbackForms}}` becomes (§676): the forms' own name, quoted, in that
 * language — „Spune-ne ceva” / “Tell us something” — read from the catalogue the page's heading reads
 * (`Tell.title`), so the approved sentence names the forms a visitor sees. Outside a request,
 * like `registrations/invitation-words.ts`, for the legal pages, the declaration and the token legend.
 */
export function feedbackFormsClause(locale: string): string {
  return locale === "en" ? `“${en.Tell.title}”` : `„${ro.Tell.title}”`;
}

/** The notice's merge value, beside the newsletter's and the invitations' on the legal pages. */
export function feedbackFormsMergeValues(locale: string): { feedbackForms: string } {
  return { feedbackForms: feedbackFormsClause(locale) };
}
