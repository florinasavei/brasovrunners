import type { Deadlines } from "@/modules/deadlines/domain/deadlines";
import { daysPhrase, hoursPhrase, minutesPhrase } from "@/modules/deadlines/domain/duration-words";
import { confirmationDueWords, confirmationWindow } from "@/modules/registrations/domain/hold-deadlines";
import { LIST_STATE_KEYS, PUBLIC_LIST_GROUPS, type PublicListGroup } from "@/modules/registrations/domain/public-list-states";

/**
 * What each state word on the public participant list means (§396; the owner, 2026-09-29, of a
 * list reading «Confirmat» and «Înscris, în așteptarea confirmării»: «Acum trebuie să explic ce
 * înseamnă „în așteptarea confirmării”»). One sentence per state, in the catalogue's words, drawn
 * as the legend under the list and as the «?» beside each word.
 *
 * **The deadlines are the event's and the club's, never a number of this file.** The pending
 * sentence says the event's own participation window (§104, §407) — «cu o săptămână» and «cu 2
 * zile înainte de start», or «la start» — when the event has one, and the club's declaration hold
 * («Termene», §377) when it does not; the waiting list's sentence says the club's offer window. So
 * the sentence and what the allocator does cannot disagree.
 *
 * `say` is the page's translator under `Event`, as in `counted-phrases.ts`.
 */
type Say = (key: string, values?: Record<string, string | number>) => string;

export type ListStateLegendLine = { group: PublicListGroup; sentence: string };

export function listStateLegend(
  say: Say,
  locale: string,
  params: {
    /** The groups the list shows; the legend explains only these, in the list's order. */
    groups: readonly PublicListGroup[];
    event: { startsAt: Date; confirmationOpensDaysBefore?: number | null; confirmationDeadlineDaysBefore?: number | null };
    deadlines: Pick<Deadlines, "holdMinutes" | "offerHours">;
  },
): ListStateLegendLine[] {
  const hold = minutesPhrase(locale, params.deadlines.holdMinutes);
  const offer = hoursPhrase(locale, params.deadlines.offerHours);
  const window = confirmationWindow(params.event);
  const explanation = (group: PublicListGroup): string => {
    if (group === "CONFIRMED") return say("startList.legend.confirmed");
    if (group === "WAITLISTED") return say("startList.legend.waitlisted", { offer });
    if (!window) return say("startList.legend.pendingHold", { hold });
    return `${say("startList.legend.pendingWindow", {
      opens: daysPhrase(locale, params.event.confirmationOpensDaysBefore ?? 0),
      due: confirmationDueWords(locale, params.event.confirmationDeadlineDaysBefore ?? 0),
    })} ${say("startList.legend.pendingWindowLate", { hold })}`;
  };
  return PUBLIC_LIST_GROUPS.filter((group) => params.groups.includes(group)).map((group) => ({
    group,
    sentence: say("startList.legend.line", {
      word: say(`startList.states.${LIST_STATE_KEYS[group]}`),
      explanation: explanation(group),
    }),
  }));
}
