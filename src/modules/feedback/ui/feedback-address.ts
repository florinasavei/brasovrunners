import { addressSearchWith, switchSearch } from "../domain/event-picker";

/**
 * Puts a choice into the address without a navigation (§716): `history.replaceState` with `null` as
 * the state, as Next's documentation has it - Next then copies its own internal state and syncs the
 * router (`useSearchParams`), where the page's own `window.history.state` carries `__NA` and makes
 * Next skip that sync. The link in the bar can be shared with the event already chosen, and the back
 * button is not filled with every click. «Schimbă tipul mesajului» (`data-feedback-switch`) is kept
 * current with the same words. Browser only; silent when the address cannot be written.
 */
export function writeChoiceToAddress(changes: Readonly<Record<string, string | null>>): void {
  try {
    const next = addressSearchWith(window.location.search, changes);
    if (next === window.location.search) return;
    window.history.replaceState(null, "", `${window.location.pathname}${next}`);
    const link = document.querySelector<HTMLAnchorElement>("[data-feedback-switch]");
    if (link) link.setAttribute("href", `${link.pathname}${switchSearch(next)}`);
  } catch {
    // An address that cannot be written is a link that is not shared with the choice; the form still posts.
  }
}
