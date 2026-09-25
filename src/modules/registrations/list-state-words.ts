import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";

/**
 * The public list's three state words, read from the catalogue outside a request (`DECISIONS.md`
 * §396): for the privacy notice's `{{participantListStates}}`, which is merged on the legal pages
 * and in the legal editor's token legend, where no `Event` translator is at hand.
 *
 * Read from `Event.startList.states` rather than typed again here, so the approved notice and the
 * list it describes name exactly the same words — "Confirmat", "Înscris, în așteptarea
 * confirmării", "Pe lista de așteptare".
 */
type StateWords = Record<"confirmed" | "pending" | "waitlisted", string>;

const WORDS: Record<"ro" | "en", StateWords> = {
  ro: ro.Event.startList.states,
  en: en.Event.startList.states,
};

/** The three words in one language. */
export function listStateWords(locale: string): StateWords {
  return locale === "en" ? WORDS.en : WORDS.ro;
}

/**
 * What `{{participantListStates}}` becomes in the privacy notice: the three words as the list
 * prints them, quoted, in that language — „Confirmat”, „Înscris, în așteptarea confirmării” sau
 * „Pe lista de așteptare”.
 */
export function listStatesClause(locale: string): string {
  const words = listStateWords(locale);
  return locale === "en"
    ? `“${words.confirmed}”, “${words.pending}” or “${words.waitlisted}”`
    : `„${words.confirmed}”, „${words.pending}” sau „${words.waitlisted}”`;
}

/** The notice's merge value, beside the deadlines' on the legal pages. */
export function listStatesMergeValues(locale: string): { participantListStates: string } {
  return { participantListStates: listStatesClause(locale) };
}
