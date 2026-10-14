import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { CLUB_NAME } from "@/theme/brand";

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
 * What the privacy notice's `{{volunteerProfile}}` becomes (§NNN): the public form's boxes about the person, each by
 * its own label, quoted, in that language — „Vârsta”, „Sex”, „Orașul”, „Am mai fost voluntar în trecut la alte curse”,
 * „Fac parte din grupul Brașov Runners”, „Mărimea tricoului” — read from the catalogue the form's labels read
 * (`Event.volunteers.profile`), the club's name from `CLUB_NAME` as the form draws it, so the approved sentence names
 * what a visitor sees. The T-shirt is listed because the form asks it only while the club gives T-shirts, which the
 * notice's own sentence says.
 */
export function volunteerProfileClause(locale: string): string {
  const words = locale === "en" ? en.Event.volunteers.profile : ro.Event.volunteers.profile;
  // «Sex» is the registration form's own word and box (`SexField`), so the one label is read from where that form reads it.
  const sex = locale === "en" ? en.Registration.sex : ro.Registration.sex;
  const [open, close] = locale === "en" ? ["“", "”"] : ["„", "”"];
  return [words.age, sex, words.city, words.before, words.club.replace("{club}", CLUB_NAME), words.shirt].map((label) => `${open}${label}${close}`).join(", ");
}

/** The notice's merge values, beside the other features' on the legal pages. */
export function volunteersMergeValues(locale: string): { volunteers: string; volunteerAgreement: string; volunteerProfile: string } {
  return {
    volunteers: volunteersClause(locale),
    volunteerAgreement: volunteerAgreementClause(locale),
    volunteerProfile: volunteerProfileClause(locale),
  };
}
