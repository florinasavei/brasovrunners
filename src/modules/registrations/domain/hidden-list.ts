/**
 * «Lista ascunsă» (§NNN, amending §643): the event's own settings, as the rest of the code reads them.
 *
 * The owner, 2026-10-02: «Trebuie ca acest feature să se numească „Pune pe lista ascunsă” […] și la
 * numărate trebuie să am bife dacă vreau să îi includ sau nu» — and «direct din setările evenimentului
 * să pot avea „folosește lista ascunsă”». The registration's mark is still `registrations.outside_capacity`
 * (§643: no place, every capacity count leaves it out); the event gained four columns: the switch and
 * the two below it act only while it is on, and «Arată public numărătoarea» acts on every event. Off, the
 * event reads as before the group existed — the race's one number series, the hidden list out of
 * «Cine vine»'s numbers — and the rows already on the list stay on it.
 */

/** The marker a refusal carries when somebody is put on the list of an event whose switch is off. */
export const HIDDEN_LIST_OFF = "HIDDEN_LIST_OFF";

/** The event's four columns, as stored. */
export type HiddenListSettings = {
  hiddenListEnabled: boolean;
  hiddenListBibStart?: number | null;
  participantCountPublic: boolean;
  hiddenListCounted: boolean;
};

/**
 * What «Cine vine» does with its numbers (§NNN): whether it says them at all («Arată public
 * numărătoarea» — on every event, whatever the switch says), and whether the hidden list is in them
 * («Numără și lista ascunsă» — only while the switch is on). Defaults — the numbers said, the hidden
 * list out — for a caller with no row. The places line and the free places never read this: the
 * hidden list takes no place.
 */
export function hiddenListCounting(event: Partial<HiddenListSettings> | null | undefined): { countPublic: boolean; countHidden: boolean } {
  const countPublic = event?.participantCountPublic !== false;
  return { countPublic, countHidden: event?.hiddenListEnabled === true && event.hiddenListCounted === true };
}

/**
 * Where the hidden list's own numbers start (§NNN, amending §173), or null when it draws from the
 * race's series as every row did: only while the switch is on and a start is set.
 */
export function hiddenListBibStartOf(event: Partial<HiddenListSettings> | null | undefined): number | null {
  if (!event || event.hiddenListEnabled !== true) return null;
  return typeof event.hiddenListBibStart === "number" ? event.hiddenListBibStart : null;
}
