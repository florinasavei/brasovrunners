import { catalogueOf } from "@/i18n/catalogue";

// The platform's words with the club's own laid over them (§887, `i18n/catalogue.ts`).
const en = catalogueOf("en");
const ro = catalogueOf("ro");

/**
 * What the privacy notice's `{{participantListNumbers}}` becomes (§613): the public list's own
 * words for its «BIB» column, quoted, in that language — „numărul de concurs” / “race number” —
 * read from the catalogue the column's heading reads (`Event.startList.columnNumberFull`), so the
 * approved sentence and the list name the same thing. Outside a request, like
 * `list-state-words.ts`, for the legal pages, the declaration and the legal editor's token legend.
 */
export function listNumbersClause(locale: string): string {
  return locale === "en" ? `“${en.Event.startList.columnNumberFull}”` : `„${ro.Event.startList.columnNumberFull}”`;
}

/** The notice's merge value, beside the list states' and the socials' on the legal pages. */
export function listNumbersMergeValues(locale: string): { participantListNumbers: string } {
  return { participantListNumbers: listNumbersClause(locale) };
}
