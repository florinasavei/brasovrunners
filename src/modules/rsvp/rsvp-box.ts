/**
 * The id of the «Vii?» box on the event page (§811, «Vin!» part 1): the anchor the action's redirect lands on, the one
 * the calendar's feed, the listing card and the «Vii?» message link (lanes 57 and 58), and what the box's result sentence
 * is read under. Kept out of the action's module because a "use server" file may export only async functions.
 */
export const RSVP_BOX_ID = "vin";

/**
 * The id of the fold «Cine vine (N)» right under that box (§812, amended by §NNN — the owner, 2026-10-19: «„Cine vine" trebuie să fie
 * mai vizibil»): the names of those who ticked, in a closed fold of its own beside the box rather than inside it. The anchor the facts'
 * line «N vin · vezi cine» links to, and the fold the browser — or `OpenFoldFromHash` — opens around it.
 */
export const RSVP_WHO_ID = "cine-vine";

/** What the page says after the typed form, read from `?vin=`; anything else is nothing. */
export type RsvpOutcome = "sent" | "invalid" | "captcha" | "withdrawSent";

export function parseRsvpOutcome(value: string | undefined): RsvpOutcome | null {
  if (value === "1") return "sent";
  if (value === "retras") return "withdrawSent";
  if (value === "invalid" || value === "captcha") return value;
  return null;
}

/** The `?vin=` value an outcome travels as: names only, never a value of the person's (§14.5). */
export const RSVP_OUTCOME_QUERY: Record<RsvpOutcome, string> = { sent: "1", invalid: "invalid", captcha: "captcha", withdrawSent: "retras" };
