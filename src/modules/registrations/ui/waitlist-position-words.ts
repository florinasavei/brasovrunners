import { countForm } from "@/i18n/count-form";
import type { WaitlistStanding } from "../domain/waitlist-standing";

type Say = (key: string, values?: Record<string, string | number>) => string;

/**
 * «Ești pe locul 3 din 10 persoane de pe lista de așteptare. Locurile eliberate se oferă în ordine.»
 * (§NNN), put together from the catalogue's words under `Registrations.waitlist`.
 *
 * `say` is the page's translator under `Registrations`. The first sentence picks its wording from the
 * length of the line (`countForm`): Romanian's «din 1 persoană», «din 10 persoane», «din 20 de
 * persoane» agree with the number they follow, and English repeats its one form under the three keys.
 * The second sentence is honest about the order: with «Ofertele din lista de așteptare pleacă
 * automat» on, a freed place goes in order; with it off the club chooses, and the page does not
 * promise an order it will not keep (§615). Never a number typed here, and no name.
 */
export function waitlistStandingPhrase(say: Say, locale: string, standing: WaitlistStanding): string {
  const position = say(`waitlist.position.${countForm(standing.length, locale)}`, { position: standing.position, length: standing.length });
  const order = say(standing.autoOffer ? "waitlist.orderAuto" : "waitlist.orderClub");
  return `${position} ${order}`;
}
