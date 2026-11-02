import { ZONE_WORDS } from "@/i18n/dates";
import { ID_DOCUMENT_EXAMPLE } from "@/modules/events/domain/place";
import { CLUB_SHORT_NAME, SAFETY_PROGRAMME } from "@/theme/brand";

/**
 * A catalogue sentence as a page prints it (§887): the club's words that arrive as arguments — its short mark, its
 * identity card example, its safety form's name, its zone's words — filled from their constants, as each call site
 * fills them. For a test that compares a rendered page with the catalogue's sentence.
 */
export function withClubWords(text: string, locale: "ro" | "en" = "ro"): string {
  const values: Record<string, string> = {
    short: CLUB_SHORT_NAME,
    idExample: ID_DOCUMENT_EXAMPLE,
    safetyName: SAFETY_PROGRAMME[locale],
    zoneWords: ZONE_WORDS[locale],
  };
  return text.replace(/\{(\w+)\}/g, (match, name: string) => values[name] ?? match);
}
