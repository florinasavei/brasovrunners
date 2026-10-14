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
 * What the privacy notice's `{{volunteerAgreement}}` becomes (§758): the agreement's own title, quoted, in that
 * language — „Contract de voluntariat” / “Volunteer agreement” — read from the catalogue its public page's heading
 * reads (`Legal.volunteerAgreementTitle`), so the approved sentence names the text a volunteer accepts.
 */
export function volunteerAgreementClause(locale: string): string {
  return locale === "en" ? `“${en.Legal.volunteerAgreementTitle}”` : `„${ro.Legal.volunteerAgreementTitle}”`;
}

/**
 * What the privacy notice's `{{volunteerProfile}}` becomes (§NNN): the public form's own boxes about the person, each by
 * its label, quoted, in that language — „Vârsta”, „Sex”, „Orașul”, „Am mai fost voluntar în trecut la alte curse” —
 * read from the catalogue the form's labels read (`Event.volunteers.profile`; «Sex» is the registration form's own
 * word, `Registration.sex`), so the approved sentence names what a visitor sees. The club's group tick and the T-shirt
 * are said in the notice's own words, never quoted: the tick would put the club's name into the approved text, and the
 * size is asked only while the club gives T-shirts, which the sentence says (§357, the member tick's rule).
 */
export function volunteerProfileClause(locale: string): string {
  const words = locale === "en" ? en.Event.volunteers.profile : ro.Event.volunteers.profile;
  // «Sex» is the registration form's own word and box (`SexField`), so the one label is read from where that form reads it.
  const sex = locale === "en" ? en.Registration.sex : ro.Registration.sex;
  const [open, close] = locale === "en" ? ["“", "”"] : ["„", "”"];
  return [words.age, sex, words.city, words.before].map((label) => `${open}${label}${close}`).join(", ");
}

/** The notice's merge values, beside the other features' on the legal pages. */
export function volunteersMergeValues(locale: string): { volunteers: string; volunteerAgreement: string; volunteerProfile: string } {
  return {
    volunteers: volunteersClause(locale),
    volunteerAgreement: volunteerAgreementClause(locale),
    volunteerProfile: volunteerProfileClause(locale),
  };
}
