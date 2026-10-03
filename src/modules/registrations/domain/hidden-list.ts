/**
 * «Lista ascunsă» (§647, amending §643): the event's own settings, as the rest of the code reads them.
 *
 * The owner, 2026-10-02: «Trebuie ca acest feature să se numească „Pune pe lista ascunsă” […] și la
 * numărate trebuie să am bife dacă vreau să îi includ sau nu» — and «direct din setările evenimentului
 * să pot avea „folosește lista ascunsă”». The registration's mark is still `registrations.outside_capacity`
 * (§643: no place, every capacity count leaves it out); the event gained four columns: the switch and
 * the two below it act only while it is on, and «Arată public numărătoarea» acts on every event. Off, the
 * event reads as before the group existed — the race's one number series, the hidden list out of
 * «Cine vine»'s numbers — and the rows already on the list stay on it.
 */

import { DomainError } from "@/shared/errors/domain-error";

/** The marker a refusal carries when somebody is put on the list of an event whose switch is off. */
export const HIDDEN_LIST_OFF = "HIDDEN_LIST_OFF";

/**
 * The marker a refused print of the desk's spares carries when they no longer fit before the hidden
 * list's own series (`spare-bibs.ts#spareStopOf`): the editor turns it into a sentence naming the box.
 */
export const SPARES_BEFORE_HIDDEN_LIST = "SPARES_BEFORE_HIDDEN_LIST";

/**
 * The markers a refused «Numerele listei ascunse încep de la» carries (§647): its series would start
 * inside the race's own, or would run into the desk's reserved spares (§444). Each has a second
 * sentence, `…_DATED`, for a refusal about another date of a series than the one saved — a scoped save
 * reaching it (`applyToSeries`) — which names that date. A copy (a duplicate, a repeat, the job's next
 * dates) is refused by the source's own settings, so its sentence names the box, not a date.
 */
export const HIDDEN_LIST_IN_RACE_SERIES = "HIDDEN_LIST_IN_RACE_SERIES";
export const HIDDEN_LIST_ON_SPARES = "HIDDEN_LIST_ON_SPARES";

/**
 * A refused «Numerele listei ascunse încep de la» (§647): still a VALIDATION_ERROR about the box
 * `hiddenListBibStart`, so a caller that knows nothing of it reads it as before, and it carries which of
 * the two refusals it is and, when the date judged is not the one saved, that date (`YYYY-MM-DD`, in the
 * event's zone). The action turns it into its sentence (`hiddenListRefusalOf`); the maintenance job
 * tells it apart from every other refusal of a series it extends.
 */
export class HiddenListNumbersError extends DomainError {
  readonly marker: typeof HIDDEN_LIST_IN_RACE_SERIES | typeof HIDDEN_LIST_ON_SPARES;
  readonly date: string | null;

  /** `message` is for the logs and may name a copy's date; `date` is the one the sentence names. */
  constructor(marker: HiddenListNumbersError["marker"], message: string, date: string | null = null) {
    super("VALIDATION_ERROR", message, ["hiddenListBibStart"]);
    this.name = "HiddenListNumbersError";
    this.marker = marker;
    this.date = date;
  }
}

/**
 * The code an action shows for a refused «Numerele listei ascunse încep de la» (§647), and the date its
 * sentence names, or null for any other error: `Admin.errors.<code>`, `{date}` filled by the caller in
 * its own language.
 */
export function hiddenListRefusalOf(error: unknown): { code: string; date: string | null } | null {
  if (!(error instanceof HiddenListNumbersError)) return null;
  return { code: error.date ? `${error.marker}_DATED` : error.marker, date: error.date };
}

/** The event's four columns, as stored. */
export type HiddenListSettings = {
  hiddenListEnabled: boolean;
  hiddenListBibStart?: number | null;
  participantCountPublic: boolean;
  hiddenListCounted: boolean;
};

/**
 * What «Cine vine» does with its numbers (§647): whether it says them at all («Arată public
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
 * Where the hidden list's own numbers start (§647, amending §173), or null when it draws from the
 * race's series as every row did: only while the switch is on and a start is set.
 */
export function hiddenListBibStartOf(event: Partial<HiddenListSettings> | null | undefined): number | null {
  if (!event || event.hiddenListEnabled !== true) return null;
  return typeof event.hiddenListBibStart === "number" ? event.hiddenListBibStart : null;
}
