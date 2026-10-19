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
 * What the privacy notice's `{{volunteerProfile}}` becomes (§765): the public form's own boxes about the person, each by
 * its label, quoted, in that language — „Data nașterii”, „Sex”, „Orașul”, „Am mai fost voluntar în trecut la alte curse” —
 * read from the catalogue the form's labels read (`Event.volunteers.profile`; «Data nașterii» and «Sex» are the registration
 * form's own words, `Registration.birthDate` and `Registration.sex`, §773), so the approved sentence names what a visitor sees. The club's group tick and the T-shirt
 * are said in the notice's own words, never quoted: the tick would put the club's name into the approved text, and the
 * size is asked only while the club gives T-shirts, which the sentence says (§357, the member tick's rule).
 */
export function volunteerProfileClause(locale: string): string {
  const words = locale === "en" ? en.Event.volunteers.profile : ro.Event.volunteers.profile;
  // «Data nașterii» and «Sex» are the registration form's own words and boxes (`BirthDateField`, `SexField`), so each label is read from where that form reads it.
  const registration = locale === "en" ? en.Registration : ro.Registration;
  const [open, close] = locale === "en" ? ["“", "”"] : ["„", "”"];
  return [registration.birthDate, registration.sex, words.city, words.before].map((label) => `${open}${label}${close}`).join(", ");
}

/**
 * What the privacy notice's `{{volunteerMinors}}` becomes (§768): the guardian's two boxes on the volunteers' page, each by
 * its label, quoted, in that language — „Numele părintelui sau tutorelui”, „Emailul părintelui sau tutorelui” — read from
 * the catalogue the form's labels read (`Event.volunteers.guardian`), so the approved sentence names what a visitor sees
 * when they say they are under eighteen.
 */
export function volunteerMinorsClause(locale: string): string {
  const words = locale === "en" ? en.Event.volunteers.guardian : ro.Event.volunteers.guardian;
  const [open, close] = locale === "en" ? ["“", "”"] : ["„", "”"];
  return [words.name, words.email].map((label) => `${open}${label}${close}`).join(", ");
}

/**
 * What the privacy notice's `{{volunteersList}}` becomes (§NNN): the tick's own words on the volunteers' form, quoted, in that language —
 * „Vreau să apar pe lista publică a voluntarilor” / “I want to appear on the public list of volunteers” — read from the catalogue the
 * form's label reads (`Event.volunteers.list.tick`), so the approved sentence names what a visitor ticks.
 */
export function volunteersListClause(locale: string): string {
  return locale === "en" ? `“${en.Event.volunteers.list.tick}”` : `„${ro.Event.volunteers.list.tick}”`;
}

/** The notice's merge values, beside the other features' on the legal pages. */
export function volunteersMergeValues(locale: string): {
  volunteers: string;
  volunteerAgreement: string;
  volunteerProfile: string;
  volunteerMinors: string;
  volunteersList: string;
} {
  return {
    volunteers: volunteersClause(locale),
    volunteerAgreement: volunteerAgreementClause(locale),
    volunteerProfile: volunteerProfileClause(locale),
    volunteerMinors: volunteerMinorsClause(locale),
    volunteersList: volunteersListClause(locale),
  };
}
