import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";

/**
 * What the privacy notice's `{{participantListNumbers}}` becomes (§613): the public list's own
 * words for its «Nr.» column, quoted, in that language — „numărul de concurs” / “race number” —
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
