import { addressSearchWith } from "../domain/event-picker";

/**
 * Puts a choice into the address without a navigation (§NNN): `history.replaceState` — which Next 16's
 * App Router observes and folds into `useSearchParams` — so the link in the bar can be shared with the
 * event already chosen, and the back button is not filled with every click. Browser only; silent when
 * the address cannot be written.
 */
export function writeChoiceToAddress(changes: Readonly<Record<string, string | null>>): void {
  try {
    const next = addressSearchWith(window.location.search, changes);
    if (next === window.location.search) return;
    window.history.replaceState(window.history.state, "", `${window.location.pathname}${next}`);
  } catch {
    // An address that cannot be written is a link that is not shared with the choice; the form still posts.
  }
}
