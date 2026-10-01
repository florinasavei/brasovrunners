import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";

/**
 * The privacy notice's `{{gmailFallback}}` (§622): the switch's own label on «Emailuri», quoted,
 * read from the catalogue the panel reads — «Gmail preia când Mailgun se oprește» — so the approved
 * sentence names exactly the setting that sends a participant's message through Google. Outside a
 * request, like `content/team/notice-words.ts`, for the legal pages, the declaration and the signed PDF.
 */
export function gmailFallbackClause(locale: string): string {
  return locale === "en" ? `“${en.Admin.emails.transport.fallback}”` : `„${ro.Admin.emails.transport.fallback}”`;
}

export function gmailFallbackMergeValues(locale: string): { gmailFallback: string } {
  return { gmailFallback: gmailFallbackClause(locale) };
}
