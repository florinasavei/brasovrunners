import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";

/**
 * What the privacy notice's `{{feedbackForms}}` becomes (§676): the forms' own name, quoted, in that
 * language — „Spune-ne ceva” / “Tell us something” — read from the catalogue the page's heading reads
 * (`Tell.noticeName`, the title's words without «(anonim)», §699, so an approved notice keeps matching), so the approved sentence names the forms a visitor sees. Outside a request,
 * like `registrations/invitation-words.ts`, for the legal pages, the declaration and the token legend.
 */
export function feedbackFormsClause(locale: string): string {
  return locale === "en" ? `“${en.Tell.noticeName}”` : `„${ro.Tell.noticeName}”`;
}

/**
 * What the privacy notice's `{{feedbackFormsNamed}}` becomes (§678): the named mode's radio, quoted —
 * „Cu nume și prenume” / “With my name” — read from the catalogue the form's radio reads
 * (`Tell.identity.named`), so the approved sentence names the choice a visitor sees.
 */
export function feedbackFormsNamedClause(locale: string): string {
  return locale === "en" ? `“${en.Tell.identity.named}”` : `„${ro.Tell.identity.named}”`;
}

/** The notice's merge values, beside the newsletter's and the invitations' on the legal pages: the forms' name and the named mode's. */
export function feedbackFormsMergeValues(locale: string): { feedbackForms: string; feedbackFormsNamed: string } {
  return { feedbackForms: feedbackFormsClause(locale), feedbackFormsNamed: feedbackFormsNamedClause(locale) };
}
