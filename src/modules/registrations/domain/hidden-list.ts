/**
 * «Lista ascunsă» (§NNN, amending §643): the event's own settings, as the rest of the code reads them.
 *
 * The owner, 2026-10-02: «Trebuie ca acest feature să se numească „Pune pe lista ascunsă” […] și la
 * numărate trebuie să am bife dacă vreau să îi includ sau nu» — and «direct din setările evenimentului
 * să pot avea „folosește lista ascunsă”». The registration's mark is still `registrations.outside_capacity`
 * (§643: no place, every capacity count leaves it out); the event gained four columns, and the three
 * below the switch act only while it is on. Off, the event reads exactly as before the group existed —
 * the race's one number series, «Cine vine» with its numbers, the hidden list out of them — and the rows
 * already on the list stay on it.
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
 * numărătoarea»), and whether the hidden list is in them («Numără și lista ascunsă»). Defaults — the
 * numbers said, the hidden list out — for an event whose switch is off, and for a caller with no row.
 * The places line and the free places never read this: the hidden list takes no place.
 */
export function hiddenListCounting(event: Partial<HiddenListSettings> | null | undefined): { countPublic: boolean; countHidden: boolean } {
  if (!event || event.hiddenListEnabled !== true) return { countPublic: true, countHidden: false };
  return { countPublic: event.participantCountPublic !== false, countHidden: event.hiddenListCounted === true };
}

/**
 * Where the hidden list's own numbers start (§NNN, amending §173), or null when it draws from the
 * race's series as every row did: only while the switch is on and a start is set.
 */
export function hiddenListBibStartOf(event: Partial<HiddenListSettings> | null | undefined): number | null {
  if (!event || event.hiddenListEnabled !== true) return null;
  return typeof event.hiddenListBibStart === "number" ? event.hiddenListBibStart : null;
}
