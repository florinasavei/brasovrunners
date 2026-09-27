import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";

/**
 * What the privacy notice's `{{participantListSocials}}` becomes (§500): the register form's own
 * tick, quoted, in that language — „Arată și Strava și Instagram lângă numele meu pe listă” — read
 * from the catalogue the form reads, so the approved sentence names exactly the box a runner
 * ticks. Outside a request, like `list-state-words.ts`, for the legal pages, the declaration and
 * the legal editor's token legend.
 */
export function listSocialsClause(locale: string): string {
  return locale === "en" ? `“${en.Registration.listSocials}”` : `„${ro.Registration.listSocials}”`;
}

/** The notice's merge value, beside the list states' on the legal pages. */
export function listSocialsMergeValues(locale: string): { participantListSocials: string } {
  return { participantListSocials: listSocialsClause(locale) };
}
