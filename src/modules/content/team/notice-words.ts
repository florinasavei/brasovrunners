import { catalogueOf } from "@/i18n/catalogue";

// The platform's words with the club's own laid over them (§NNN, `i18n/catalogue.ts`).
const en = catalogueOf("en");
const ro = catalogueOf("ro");

/**
 * The privacy notice's `{{teamPage}}` (§459): the team page's own quoted title from the catalogue,
 * so the notice and the heading cannot differ. Works outside a request.
 */
export function teamPageClause(locale: string): string {
  return locale === "en" ? `“${en.Team.title}”` : `„${ro.Team.title}”`;
}

export function teamPageMergeValues(locale: string): { teamPage: string } {
  return { teamPage: teamPageClause(locale) };
}
