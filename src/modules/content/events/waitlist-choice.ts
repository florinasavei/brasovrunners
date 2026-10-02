/**
 * «Lista de așteptare» in the editor (§633, amending §348 and §350's box): how long the waiting list
 * may grow is a choice **in words**, never a number that means two things.
 *
 * Until now the box «Lungimea maximă a listei de așteptare» stored an empty box as "no limit" and
 * 0 as "no waiting list at all". The owner typed 0 believing it meant unlimited — on the race whose
 * line already held twenty people — and the list would have closed. Now the select says which of
 * three answers it is, and each is the value the column already holds (`events.waitlist_capacity`,
 * no migration): «Nelimitată» null, «Limitată la un număr de locuri» the number typed, «Fără listă
 * de așteptare» 0. A 0 is stored **only** by that third answer: under «Limitată», a 0 or an empty
 * box means the limit was taken away, which is «Nelimitată» — on the screen (`WaitlistLimitOnly`
 * switches the select as the box is left) and on the server without JavaScript
 * (`service.ts#ignoreHiddenFields`, through `waitlistLengthPosted` below).
 *
 * A plain module, with no import, so the client island and the service read the same rule.
 */

/** The select's three answers, in the order the editor lists them. */
export const WAITLIST_CHOICES = ["UNLIMITED", "LIMITED", "NONE"] as const;

export type WaitlistChoice = (typeof WAITLIST_CHOICES)[number];

/** The name the select posts; `admin/actions.ts#eventFieldsFrom` reads it as `waitlistMode`. */
export const WAITLIST_CHOICE_FIELD = "event.waitlistMode";

/** The name the number under «Limitată» posts — the box the length always had. */
export const WAITLIST_LENGTH_FIELD = "event.waitlistCapacity";

export function isWaitlistChoice(value: unknown): value is WaitlistChoice {
  return (WAITLIST_CHOICES as readonly unknown[]).includes(value);
}

/** The answer the select opens on, from what is stored: null no limit, 0 no list, a count a limit. */
export function waitlistChoiceOf(stored: number | null | undefined): WaitlistChoice {
  if (stored === null || stored === undefined) return "UNLIMITED";
  return stored === 0 ? "NONE" : "LIMITED";
}

/**
 * Whether what is typed under «Limitată» takes the limit away: an empty box, or nought however
 * written ("0", "00", " 0 "). Anything else — a count, or text the schema will refuse — stays a limit.
 */
export function typedMeansNoLimit(typed: string): boolean {
  return /^\s*0*\s*$/.test(typed);
}

/**
 * The answer once the number box is left (`WaitlistLimitOnly`): «Limitată» with the box empty or at
 * 0 becomes «Nelimitată»; anything else stays as it was. A box the browser cannot read as a number
 * (`badInput`: its value reads "" then) is not taken for an empty one — the browser refuses it.
 */
export function choiceAfterTyping(choice: string, typed: string, badInput = false): string {
  return choice === "LIMITED" && !badInput && typedMeansNoLimit(typed) ? "UNLIMITED" : choice;
}

/**
 * The length as the schema should read it, from the answer and the box: «Nelimitată» an empty box
 * (null), «Fără listă» "0", «Limitată» the box as typed — or an empty box when it holds nothing or
 * nought, so a «Limitată» with 0 saves as unlimited and never as no list. What the box holds under
 * the other two answers is never read: the box is hidden then (§350's hidden-fields rule).
 */
export function waitlistLengthPosted(choice: WaitlistChoice, typed: unknown): unknown {
  if (choice === "UNLIMITED") return "";
  if (choice === "NONE") return "0";
  if (typed === undefined || typed === null) return "";
  return typeof typed === "string" && typedMeansNoLimit(typed) ? "" : typed;
}
