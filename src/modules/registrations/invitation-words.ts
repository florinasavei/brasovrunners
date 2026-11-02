import { catalogueOf } from "@/i18n/catalogue";

// The platform's words with the club's own laid over them (§887, `i18n/catalogue.ts`).
const en = catalogueOf("en");
const ro = catalogueOf("ro");

/**
 * What the privacy notice's `{{eventInvitations}}` becomes (§647): the backoffice section's own name,
 * quoted, in that language — „Invitații” / “Invitations” — read from the catalogue the section's heading
 * reads (`Admin.invitations.title`), so the approved sentence names the screen the club uses. Outside a
 * request, like `list-number-words.ts`, for the legal pages, the declaration and the token legend.
 */
export function eventInvitationsClause(locale: string): string {
  return locale === "en" ? `“${en.Admin.invitations.title}”` : `„${ro.Admin.invitations.title}”`;
}

/** The notice's merge value, beside the list's and the offers' on the legal pages. */
export function eventInvitationsMergeValues(locale: string): { eventInvitations: string } {
  return { eventInvitations: eventInvitationsClause(locale) };
}
