/**
 * The city every club event happens in (`DECISIONS.md` §NNN).
 *
 * The one thing said about a place that is not announced yet where a *name* has to stand rather
 * than a sentence: the structured data's `Place` (schema.org requires one, and "Brașov" is true)
 * and the declaration's `{{eventLocation}}` ("în locația Brașov" is a statement a runner can sign;
 * "în locația Locația se anunță în curând" is not a sentence). Every surface a person reads says
 * "Locația se anunță în curând" instead, from the `Event` catalogue.
 */
export const CLUB_LOCALITY = "Brașov";
