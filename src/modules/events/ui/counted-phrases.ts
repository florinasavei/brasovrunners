import { countForm } from "@/i18n/count-form";
import type { PublicFill } from "../domain/registration-cta";

/**
 * The two counted sentences of an event page (§346), put together from the catalogue's words.
 *
 * `say` is the page's translator under the `Event` namespace — `getTranslations("Event")` on
 * the server, `createTranslator` in a test — so the sentence is the catalogue's and only the
 * choice of wording is here. Each number picks its own wording (`countForm`), because in
 * Romanian the two halves agree with their own numbers: "1 înscris din 50 de locuri", "20 de
 * înscriși din 21 de locuri", "12 înscriși din 12 locuri".
 */
type Say = (key: string, values?: Record<string, string | number>) => string;

/**
 * "12 înscriși din 50 de locuri" / "12 of 50 places taken" — each language's own word order
 * from the same two numbers: the catalogue decides where the words go, this only picks the forms.
 */
export function fillPhrase(say: Say, locale: string, fill: PublicFill): string {
  return say("cta.fill", {
    taken: say(`cta.fillTaken.${countForm(fill.taken, locale)}`, { count: fill.taken }),
    places: say(`cta.fillPlaces.${countForm(fill.capacity, locale)}`, { count: fill.capacity }),
  });
}

/**
 * "7 locuri libere din 10" / "7 places left out of 10" — the listing card's count (§409): the free
 * places the button offers, read against the event's size. Both numbers are `RegistrationCta`'s
 * own (`registration-door.ts`), never a second count. The free number picks the wording: "1 loc
 * liber din 10", "19 locuri libere din 50", "20 de locuri libere din 50".
 */
export function freePlacesPhrase(say: Say, locale: string, free: number, capacity: number): string {
  return say(`cta.freeOf.${countForm(free, locale)}`, { count: free, places: capacity });
}

/**
 * "Mai sunt 3 locuri pe lista de așteptare" / "3 places left on the waiting list" (§348): the
 * room a capped waiting list has left, under its button. Romanian's "de" from twenty on, as the
 * rest: "Mai este 1 loc", "Mai sunt 19 locuri", "Mai sunt 20 de locuri".
 */
export function waitlistRoomPhrase(say: Say, locale: string, room: number): string {
  return say(`cta.waitlistRoom.${countForm(room, locale)}`, { count: room });
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
    confirmed: say(`startList.confirmed.${countForm(counts.confirmed, locale)}`, { count: counts.confirmed }),
    named: counts.named,
  });
}

/**
 * "3 înscriși în așteptarea confirmării", "5 pe lista de așteptare" (§396): the rows the list
 * gains behind the privacy notice's gate, each group in its own words, and only the groups that
 * have anybody — "0 pe lista de așteptare" is a sentence about nobody. Counted from the same
 * query the rows are drawn from, so only those who ticked «Vreau să apar»: the phrase counts the
 * rows under it, never the people who asked not to be on it.
 */
export function othersPhrases(say: Say, locale: string, counts: { pending: number; waitlisted: number }): string[] {
  const phrases: string[] = [];
  if (counts.pending > 0) phrases.push(say(`startList.pendingCount.${countForm(counts.pending, locale)}`, { count: counts.pending }));
  if (counts.waitlisted > 0) phrases.push(say(`startList.waitlistedCount.${countForm(counts.waitlisted, locale)}`, { count: counts.waitlisted }));
  return phrases;
}

/**
 * The partner marker's words (§367, amended §375 — the owner, 2026-09-24: "For the partnership,
 * I just need 1 icon, I do not need to show the full partners list, there might be multiple
 * partners"), and again (§379 — "the chip is too long, just say 'colaborare' in the Romanian
 * one"): "Colaborare" / "Partnership" — the same generic label everywhere
 * the marker appears: the listing card's chip, the calendar entry's tooltip and accessible name,
 * and the event page's overline.
 *
 * It never names a partner and never counts them: the marker says only that the event is held with
 * one or more partners — there may be several, and a card is a summary. The full list — each
 * partner by name, with its links — is the event page's partner cards (§344), which this never replaces.
 *
 * `hasPartner` is whether `readCoHosts(event)` found any; null when it did not, so nothing
 * renders where there is no partner to mark.
 */
export function partnerPhrase(say: Say, hasPartner: boolean): string | null {
  return hasPartner ? say("partner.marker") : null;
}
