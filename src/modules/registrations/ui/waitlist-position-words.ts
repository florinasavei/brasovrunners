import { countForm } from "@/i18n/count-form";
import type { WaitlistStanding } from "../domain/waitlist-standing";

type Say = (key: string, values?: Record<string, string | number>) => string;

/**
 * What a person waiting is told about the line, put together from the catalogue's words under
 * `Registrations.waitlist` (§NNN, amending §615; the owner: «E ok să aștepte, ei nu vor afla când
 * s-au înscris restul pe listă și noi putem alege pe cine să luăm din listă»).
 *
 * - **Offers go out on their own** (`autoOffer`): the place, «Ești pe locul 3 din 10 persoane de pe
 *   lista de așteptare. Locurile eliberate se oferă în ordine.» — the order is real, so it is told.
 * - **The club chooses** whom to offer a freed place: no position at all, only how many others wait,
 *   «Ești pe lista de așteptare, împreună cu alte 9 persoane. Clubul alege cui oferă un loc eliberat.»,
 *   or «Ești singura persoană pe lista de așteptare.» alone — nobody learns an order the club does not keep.
 *
 * `say` is the page's translator under `Registrations`. The counted words pick their form from the
 * number they follow (`countForm`): Romanian's «din 1 persoană», «din 10 persoane», «din 20 de
 * persoane», «cu o altă persoană», «cu alte 20 de persoane»; English repeats its one form under the
 * three keys. Never a number typed here, and no name.
 */
export function waitlistStandingPhrase(say: Say, locale: string, standing: WaitlistStanding): string {
  if (standing.autoOffer) {
    const position = say(`waitlist.position.${countForm(standing.length, locale)}`, { position: standing.position, length: standing.length });
    return `${position} ${say("waitlist.orderAuto")}`;
  }
  const others = standing.length - 1;
  const company = others > 0 ? say(`waitlist.others.${countForm(others, locale)}`, { others }) : say("waitlist.alone");
  return `${company} ${say("waitlist.orderClub")}`;
}
