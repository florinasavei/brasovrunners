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
 * The partner marker's words (§NNN; the owner: "a special marker with this partnered event, so
 * that people know this is not a regular Brașov Runners group run"): "În parteneriat cu Brașov
 * Running Festival" / "With Brașov Running Festival" — on the listing card's chip, in the
 * calendar entry's tooltip and accessible name, and on the event page's overline.
 *
 * One partner by name, two by name ("… cu A și B"), and from three the first by name and the rest
 * counted ("… cu A și încă 2 parteneri"): a chip on a 320-pixel card has room for a name and a
 * number, not a list — the whole list is the event page's partner cards (§344). Names in the
 * order the club listed them (`readCoHosts`). Null when the event has no partner: no marker.
 *
 * The count picks a plain key (`countForm`), never an ICU plural: "și încă 2 parteneri", "și încă
 * 20 de parteneri". `more.one` is there because every counted phrase has the three keys, though
 * "the first and one more" is two partners, which the `two` wording names.
 */
export function partnerPhrase(say: Say, locale: string, names: readonly string[]): string | null {
  if (names.length === 0) return null;
  if (names.length === 1) return say("partner.one", { partner: names[0] });
  if (names.length === 2) return say("partner.two", { first: names[0], second: names[1] });
  const others = names.length - 1;
  return say(`partner.more.${countForm(others, locale)}`, { first: names[0], count: others });
}
