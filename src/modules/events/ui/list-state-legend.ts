import type { Deadlines } from "@/modules/deadlines/domain/deadlines";
import { daysPhrase, hoursPhrase, minutesPhrase } from "@/modules/deadlines/domain/duration-words";
import { confirmationDueWords, confirmationWindow, participationWindowOpen } from "@/modules/registrations/domain/hold-deadlines";
import { LIST_STATE_KEYS, PUBLIC_LIST_GROUPS, type PublicListGroup } from "@/modules/registrations/domain/public-list-states";

/**
 * What each state word on the public participant list means (§396; the owner, 2026-09-29, of a
 * list reading «Confirmat» and «Înscris, în așteptarea confirmării»: «Acum trebuie să explic ce
 * înseamnă „în așteptarea confirmării”»). One sentence per state, in the catalogue's words, drawn
 * as the legend under the list and as the «?» beside each word.
 *
 * **The deadlines are the event's and the club's, never a number of this file.** The pending
 * sentence follows the event's phase at render time, as `computeDeclarationHoldExpiry` does: before
 * the event's participation window opens (§104, §407) it says the window — «cu o săptămână» and
 * «cu 2 zile înainte de start», or «la start»; inside the window, or on an event with none, it says
 * the club's declaration hold («Termene», §377), which is what a late registration gets; the waiting list's sentence says the club's offer window. So
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
    /** The render's moment: which phase the event is in. */
    now: Date;
  },
): ListStateLegendLine[] {
  const hold = minutesPhrase(locale, params.deadlines.holdMinutes);
  const offer = hoursPhrase(locale, params.deadlines.offerHours);
  const window = confirmationWindow(params.event);
  const explanation = (group: PublicListGroup): string => {
    if (group === "CONFIRMED") return say("startList.legend.confirmed");
    if (group === "WAITLISTED") return say("startList.legend.waitlisted", { offer });
    const beforeWindow =
      window !== null && !participationWindowOpen(params.event.startsAt, params.event.confirmationOpensDaysBefore, params.now);
    if (!beforeWindow) return say("startList.legend.pendingHold", { hold });
    return say("startList.legend.pendingWindow", {
      opens: daysPhrase(locale, params.event.confirmationOpensDaysBefore ?? 0),
      due: confirmationDueWords(locale, params.event.confirmationDeadlineDaysBefore ?? 0),
    });
  };
  return PUBLIC_LIST_GROUPS.filter((group) => params.groups.includes(group)).map((group) => ({
    group,
    sentence: say("startList.legend.line", {
      word: say(`startList.states.${LIST_STATE_KEYS[group]}`),
      explanation: explanation(group),
    }),
  }));
}
