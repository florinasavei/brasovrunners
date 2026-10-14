import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";

/**
 * What the privacy notice's `{{volunteers}}` becomes (§754): the public form's own name on an event's
 * page, quoted, in that language — „Vreau să fiu voluntar” / “I want to volunteer” — read from the
 * catalogue the form's heading reads (`Event.volunteers.title`), so the approved sentence names what a
 * visitor sees. Outside a request, like `content/shop/notice-words.ts`, for the legal pages, the
 * declaration and the token legend.
 */
export function volunteersClause(locale: string): string {
  return locale === "en" ? `“${en.Event.volunteers.title}”` : `„${ro.Event.volunteers.title}”`;
}

/**
 * What the privacy notice's `{{volunteerAgreement}}` becomes (§NNN): the agreement's own title, quoted, in that
 * language — „Contract de voluntariat” / “Volunteer agreement” — read from the catalogue its public page's heading
 * reads (`Legal.volunteerAgreementTitle`), so the approved sentence names the text a volunteer accepts.
 */
export function volunteerAgreementClause(locale: string): string {
  return locale === "en" ? `“${en.Legal.volunteerAgreementTitle}”` : `„${ro.Legal.volunteerAgreementTitle}”`;
}

/** The notice's merge values, beside the other features' on the legal pages. */
export function volunteersMergeValues(locale: string): { volunteers: string; volunteerAgreement: string } {
  return { volunteers: volunteersClause(locale), volunteerAgreement: volunteerAgreementClause(locale) };
}
