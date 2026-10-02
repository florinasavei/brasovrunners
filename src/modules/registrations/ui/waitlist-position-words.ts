import { countForm } from "@/i18n/count-form";
import type { WaitlistStanding } from "../domain/waitlist-standing";

type Say = (key: string, values?: Record<string, string | number>) => string;

/**
 * What a person waiting is told about the line, put together from the catalogue's words under
 * `Registrations.waitlist` (§629, amending §615; the owner: «E ok să aștepte, ei nu vor afla când
 * s-au înscris restul pe listă și noi putem alege pe cine să luăm din listă»).
 *
 * - **Offers go out on their own** (`autoOffer`): the place, «Ești pe locul 3 din 10 persoane de pe
 *   lista de așteptare. Locurile eliberate se oferă în ordine.» — the order is real, so it is told.
 * - **Alone in the line** (either reading): «Ești singura persoană pe lista de așteptare.» and then the setting's sentence — never «locul 1 din 1 persoană».
 * - **The club chooses** whom to offer a freed place: no position at all, only how many others wait,
 *   «Ești pe lista de așteptare, împreună cu alte 9 persoane. Clubul alege cui oferă un loc eliberat.»,
 *   or «Ești singura persoană pe lista de așteptare.» alone — nobody learns an order the club does not keep.
 *
 * - **The count kept private** (`countPublic: false`, §634): nothing that says the line's length — no
 *   «din 10 persoane», no «cu alte 9», not «singura persoană», which says one, and no position either,
 *   in either reading: whoever has just joined is last, so their place IS the line's length. Only
 *   «Ești pe lista de așteptare.», then the setting's sentence, as always.
 *
 * `say` is the page's translator under `Registrations`. The counted words pick their form from the
 * number they follow (`countForm`): Romanian's «din 1 persoană», «din 10 persoane», «din 20 de
 * persoane», «cu o altă persoană», «cu alte 20 de persoane»; English repeats its one form under the
 * three keys. Never a number typed here, and no name.
 */
export function waitlistStandingPhrase(say: Say, locale: string, standing: WaitlistStanding): string {
  const order = say(standing.autoOffer ? "waitlist.orderAuto" : "waitlist.orderClub");
  // The count kept private (§634): only that they wait — no position, since a newcomer's place is the line's length.
  if (standing.countPublic === false) return `${say("waitlist.onList")} ${order}`;
  const others = standing.length - 1;
  // Alone in the line, «locul 1 din 1 persoană» is not how anybody says it: the same words in both readings of the setting.
  if (others <= 0) return `${say("waitlist.alone")} ${order}`;
  if (standing.autoOffer) {
    const position = say(`waitlist.position.${countForm(standing.length, locale)}`, { position: standing.position, length: standing.length });
    return `${position} ${order}`;
  }
  return `${say(`waitlist.others.${countForm(others, locale)}`, { others })} ${order}`;
}
