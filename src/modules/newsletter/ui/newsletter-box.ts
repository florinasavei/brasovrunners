/**
 * The contact page's newsletter pop-up (§445): its ids, and the outcome the action's redirect puts
 * in `?newsletter=` — kept out of the action's module because a "use server" file may export only
 * async functions, and out of the component so the action and the page read one list.
 */
/** The section's anchor, `/ro/contact#abonare` — the address the club can share for "subscribe here". */
export const NEWSLETTER_SECTION_ID = "abonare";
export const NEWSLETTER_DIALOG_ID = "newsletter-dialog";
export const NEWSLETTER_TRIGGER_ID = "newsletter-open";
export const NEWSLETTER_ERROR_SUMMARY_ID = "newsletter-errors";

/** `open`: the button without a script. The rest are the action's answers. */
export type NewsletterOutcome = "open" | "sent" | "invalid" | "captcha" | "limited" | "unavailable";

const OUTCOMES: readonly NewsletterOutcome[] = ["open", "sent", "invalid", "captcha", "limited", "unavailable"];

export function parseNewsletterOutcome(value: string | undefined): NewsletterOutcome | null {
  return OUTCOMES.find((outcome) => outcome === value) ?? null;
}

/** Whether the page arrives with the pop-up open: asked for without a script, or a refusal to fix in it. */
export function newsletterDialogOpen(outcome: NewsletterOutcome | null): boolean {
  return outcome === "open" || outcome === "invalid" || outcome === "captcha" || outcome === "limited";
}

/** «Vreau să mă dezabonez» (§550): the fold's anchor, `/ro/contact#newsletter-leave`. */
export const NEWSLETTER_LEAVE_ID = "newsletter-leave";

/** Its action's answers, in `?nleave=`: `sent` whatever the address was; the rest a refusal to fix. */
export type NewsletterLeaveOutcome = "sent" | "invalid" | "captcha" | "limited";

const LEAVE_OUTCOMES: readonly NewsletterLeaveOutcome[] = ["sent", "invalid", "captcha", "limited"];

export function parseNewsletterLeaveOutcome(value: string | undefined): NewsletterLeaveOutcome | null {
  return LEAVE_OUTCOMES.find((outcome) => outcome === value) ?? null;
}

/** Whether the fold arrives open: a refusal to fix in it. `sent` arrives closed, with the answer above it. */
export function newsletterLeaveRefused(outcome: NewsletterLeaveOutcome | null): boolean {
  return outcome === "invalid" || outcome === "captcha" || outcome === "limited";
}

/**
 * Move the focus to a refusal drawn on arrival (§47, §553) — «Vreau să mă dezabonez»'s alert after a
 * failed check or the hour's limit — opening the fold round it first, since an element inside a
 * closed `<details>` cannot take the focus. False when there is nothing to focus.
 */
export function focusRefusal(page: { getElementById(id: string): HTMLElement | null }, id: string | null | undefined): boolean {
  if (!id) return false;
  const refusal = page.getElementById(id);
  if (!refusal) return false;
  const fold = refusal.closest("details");
  if (fold && !fold.open) fold.open = true;
  refusal.focus();
  return true;
}

/** The boxes the pop-up's form has, in the order it shows them — the order a refusal lists them in (§47). */
export const NEWSLETTER_BOXES = ["email", "topics", "consent"] as const;
export type NewsletterBox = (typeof NEWSLETTER_BOXES)[number];

/** The boxes a refusal names, from `?nfields=` — only the ones the form has. */
export function parseNewsletterFields(value: string | undefined): NewsletterBox[] {
  const names = (value ?? "").split(",");
  return NEWSLETTER_BOXES.filter((name) => names.includes(name));
}
