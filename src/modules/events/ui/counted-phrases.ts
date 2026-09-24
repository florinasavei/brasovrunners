import { numberForm } from "@/i18n/number-form";
import type { PublicFill } from "../domain/registration-cta";

/**
 * The two counted sentences of an event page (§NNN), put together from the catalogue's words.
 *
 * `say` is the page's translator under the `Event` namespace — `getTranslations("Event")` on
 * the server, `createTranslator` in a test — so the sentence is the catalogue's and only the
 * choice of wording is here. Each number picks its own wording (`numberForm`), because in
 * Romanian the two halves agree with their own numbers: "1 înscris din 50 de locuri", "20 de
 * înscriși din 21 de locuri", "12 înscriși din 12 locuri".
 */
type Say = (key: string, values?: Record<string, string | number>) => string;

/** "12 înscriși din 50 de locuri" / "12 registered of 50 places". */
export function fillPhrase(say: Say, locale: string, fill: PublicFill): string {
  return say("cta.fill", {
    taken: say(`cta.fillTaken.${numberForm(locale, fill.taken)}`, { count: fill.taken }),
    places: say(`cta.fillPlaces.${numberForm(locale, fill.capacity)}`, { count: fill.capacity }),
  });
}

/**
 * "42 de participanți confirmați — 39 cu numele afișat": the start list's own total, above it.
 *
 * `confirmed` is every confirmed, real registration of the event and `named` those of them who
 * ticked "Vreau să apar pe lista de participanți" — the same two counts the list's rows are
 * drawn from, so the sentence and the rows under it cannot disagree.
 */
export function confirmedPhrase(say: Say, locale: string, counts: { confirmed: number; named: number }): string {
  return say("startList.summary", {
    confirmed: say(`startList.confirmed.${numberForm(locale, counts.confirmed)}`, { count: counts.confirmed }),
    named: counts.named,
  });
}
