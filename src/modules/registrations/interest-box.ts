/**
 * The id of the "tell me when registration opens" box on the event page (§146): where the
 * action's redirect lands, and what its result sentence is read under. Kept out of the
 * action's module because a "use server" file may export only async functions.
 */
export const INTEREST_BOX_ID = "registration-interest";

/** What the page says after the action, read from `?interest=`; anything else is nothing. */
export type InterestOutcome = "done" | "invalid" | "captcha";

export function parseInterestOutcome(value: string | undefined): InterestOutcome | null {
  if (value === "1") return "done";
  if (value === "invalid" || value === "captcha") return value;
  return null;
}

/**
 * When the form the person is correcting was first rendered, carried back through the
 * `invalid` redirect as `?since=` — a timestamp, never a value of theirs. Without it the
 * re-rendered box would be timed from the redirect, and a one-field form retyped in under
 * three seconds is answered as a bot (`looksLikeSpam`). Anything unparseable, or ahead of the
 * clock, is ignored and the render's own time stands.
 */
export function parseInterestSince(value: string | undefined, now: Date): Date | null {
  if (!value) return null;
  const since = new Date(value);
  if (Number.isNaN(since.getTime()) || since.getTime() > now.getTime()) return null;
  return since;
}
