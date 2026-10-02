import { countForm } from "@/i18n/count-form";
import { hoursPhrase } from "@/modules/deadlines/domain/duration-words";
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
export function fillPhrase(say: Say, locale: string, fill: PublicFill, options: { withWaiting?: boolean } = {}): string {
  const taken = say(`cta.fillTaken.${countForm(fill.taken, locale)}`, { count: fill.taken });
  const places = say(`cta.fillPlaces.${countForm(fill.capacity, locale)}`, { count: fill.capacity });
  /*
    The parts after the dash (§615; the owner read «105 înscriși» beside 86 confirmed names as an
    inconsistency): the confirmed and those in progress when anything is in progress, and the places
    kept for the waiting list when it has a claim — «6 înscriși din 10 locuri — 4 confirmați, 2 în curs
    de confirmare, 4 locuri păstrate pentru lista de așteptare». Only the parts that exist.
  */
  const parts: string[] = [];
  const progress = fill.confirmed === undefined ? 0 : fill.taken - fill.confirmed;
  if (fill.confirmed !== undefined && progress > 0) {
    parts.push(say(`cta.fillConfirmed.${countForm(fill.confirmed, locale)}`, { count: fill.confirmed }));
    parts.push(say("cta.fillInProgress", { count: progress }));
  }
  if (fill.kept !== undefined && fill.kept > 0) parts.push(say(`cta.fillKept.${countForm(fill.kept, locale)}`, { count: fill.kept }));
  /*
    The people waiting, last (§629; the owner: the event page says how many wait): «… , 10 pe lista de
    așteptare» whenever anybody does, so the number is on the places line in every state that draws it.
    The full state's lead already says it («3 așteaptă deja un loc», §587), and the page does not say a
    number twice in one card: it asks for the line without it (`withWaiting: false`).
  */
  if (options.withWaiting !== false && fill.waitlisted !== undefined && fill.waitlisted > 0) parts.push(waitingPhrase(say, fill.waitlisted));
  if (parts.length === 0) return say("cta.fill", { taken, places });
  return say("cta.fillParts", { taken, places, parts: parts.join(", ") });
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
 * "Mulțumim! Toate cele 50 de locuri s-au ocupat — 3 așteaptă deja un loc." (§587, amending
 * §348): the full event's thank-you lead, from the event's size and the line's length the door
 * already counted; an empty line says «Fii primul pe lista de așteptare.» instead of a nought.
 * `waiting` null is a count the club keeps private (§634): «… s-au ocupat. Intră pe lista de
 * așteptare.», which says neither the number nor that nobody waits.
 */
export function fullThanksPhrase(say: Say, locale: string, capacity: number, waiting: number | null): string {
  const key = waiting === null ? "cta.fullThanksJoin" : waiting > 0 ? "cta.fullThanks" : "cta.fullThanksFirst";
  return say(`${key}.${countForm(capacity, locale)}`, waiting === null ? { capacity } : { capacity, waiting });
}

/** "3 pe lista de așteptare" (§587, amending §346): beside the free places, once anybody waits. */
export function waitingPhrase(say: Say, waiting: number): string {
  return say("cta.waitingCount", { count: waiting });
}

/**
 * "1 loc oferit din lista de așteptare" / "1 place offered from the waiting list" (§612): a place
 * promised to the head of the line, which `computeOccupied` counts as taken and is not free — but is
 * not somebody still waiting either. Romanian's three forms through `countForm`: «1 loc oferit»,
 * «2 locuri oferite», «20 de locuri oferite».
 */
export function offeredPhrase(say: Say, locale: string, offered: number): string {
  return say(`cta.offeredCount.${countForm(offered, locale)}`, { count: offered });
}

/**
 * What an open event says about its line after the free places (§612, amending §587): the offers
 * still open, then the people waiting with no offer yet — each only when it has anybody, in that
 * order. The card joins them with a middle dot; the event page draws one line each.
 */
export function openLinePhrases(say: Say, locale: string, line: { offered: number; waitlisted: number }): string[] {
  const phrases: string[] = [];
  if (line.offered > 0) phrases.push(offeredPhrase(say, locale, line.offered));
  if (line.waitlisted > 0) phrases.push(waitingPhrase(say, line.waitlisted));
  return phrases;
}

/**
 * "Când se eliberează un loc, primești un email și ai 24 de ore să confirmi — altfel locul trece
 * mai departe." (§587, amending §348): how a waiting-list offer works, under the full event's
 * button and above the join form — with the club's own offer window («Termene», `offerHours`,
 * §377), the number the allocator gives an offer, in the site's hour words (`hoursPhrase`).
 */
export function waitlistOfferPhrase(say: Say, locale: string, offerHours: number): string {
  return say("cta.fullOffer", { hours: hoursPhrase(locale, offerHours) });
}

/**
 * "42 de participanți confirmați — 39 cu numele afișat": the start list's own total, above it.
 *
 * `confirmed` is every confirmed, real registration of the event and `named` those of them who
 * ticked "Vreau să apar pe lista de participanți & rezultate" — the same two counts the list's rows are
 * drawn from, so the sentence and the rows under it cannot disagree.
 */
export function confirmedPhrase(say: Say, locale: string, counts: { confirmed: number; named: number }): string {
  return say("startList.summary", {
    confirmed: say(`startList.confirmed.${countForm(counts.confirmed, locale)}`, { count: counts.confirmed }),
    named: counts.named,
  });
}

/**
 * The «Cine vine» fold's two headline readings (§632, amending §346): the number in its title and
 * the bold line under it.
 *
 * The owner, 2026-10-02, of a page reading «150 de înscriși din 150 de locuri — 134 de confirmați, 16
 * în curs de confirmare» above «Cine vine (134)»: «pune-o și pe cei care trebuie să confirme
 * înregistrarea». So, for a **capped** event whose cached public read knows the counts (`fill`
 * with `confirmed`), the people completing their registration — `fill.taken - fill.confirmed`, the
 * places line's own «în curs de confirmare» — are added to the title, and the line says the split:
 * «150 de înscriși — 134 de confirmați (120 cu numele afișat), 16 în curs de confirmare».
 *
 * Everything else reads exactly as before — «Cine vine (134)» over «134 de participanți confirmați —
 * 120 cu numele afișat»:
 * - **nothing in progress**: the two readings are the same number;
 * - **an uncapped event** (`fill` null): on purpose. §32 declined to publish a head count of held
 *   places with no «out of» beside it, and the places line does not show there either, so the page
 *   has no in-progress number to repeat;
 * - **a cache entry from before the counts** (`confirmed` absent): no split to say.
 *
 * `confirmed` is the start list's own count — REAL rows only (`countPublicStartList`) — while the
 * in-progress figure is the places line's, from the allocator's kind-blind count (`readPublicPlaces`,
 * `AGENTS.md` §12.6). On QA a TEST row can therefore make the two reads differ by the test rows, as
 * §615 already accepts for the places line beside the title; production has no TEST row. The number
 * comes from the page's one cached read (`readRegistrationDoor`), never a query of this list's own.
 */
export function startListHeadline(
  say: Say,
  locale: string,
  counts: { confirmed: number; named: number },
  fill: PublicFill | null,
): { count: number; inProgress: number; line: string } {
  const inProgress = fill && fill.confirmed !== undefined ? Math.max(fill.taken - fill.confirmed, 0) : 0;
  if (inProgress === 0) return { count: counts.confirmed, inProgress, line: confirmedPhrase(say, locale, counts) };
  const count = counts.confirmed + inProgress;
  return {
    count,
    inProgress,
    // The places line's own words for each part (`cta.fill*`), so the page says one thing one way.
    line: say("startList.summaryInProgress", {
      taken: say(`cta.fillTaken.${countForm(count, locale)}`, { count }),
      confirmed: say(`cta.fillConfirmed.${countForm(counts.confirmed, locale)}`, { count: counts.confirmed }),
      named: counts.named,
      inProgress: say("cta.fillInProgress", { count: inProgress }),
    }),
  };
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
