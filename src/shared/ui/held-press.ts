/**
 * One held press per form (§502).
 *
 * The registration form carries two send buttons that wait for Cloudflare's token — the main one
 * and, after a too-fast refusal, «Retrimite» at the top (§324). Each used to hold its own press,
 * and when the token landed each one's watcher replayed its own: two `requestSubmit` calls on one
 * form, two POSTs of one registration — a success on the screen, then the second one's refusal.
 *
 * So the hold belongs to the form, not to the button: the first press claims it and names the
 * button that was pressed; any other press on that form while it is held is swallowed; and the
 * release — the token, the valve or the button going away — submits at most once, from the
 * pressed button, and only if that button still owns the hold.
 *
 * Structural types rather than the DOM's own, so the unit suite (Node, no DOM) drives it with two
 * plain objects standing in for the buttons.
 */

/** Dispatched on the form when its held press is over, sent or dropped: the other buttons stop echoing it. */
export const HELD_PRESS_OVER_EVENT = "br-held-press-over";

type HoldingForm = { requestSubmit(submitter?: HTMLElement | null): void; dispatchEvent(event: Event): boolean };

const heldBy = new WeakMap<object, object>();

/** Hold `button`'s press on `form`, unless a press is already held there — then nothing, and `false`. */
export function holdPress(form: object, button: object): boolean {
  if (heldBy.has(form)) return false;
  heldBy.set(form, button);
  return true;
}

/** Whether a press is held on this form, by any of its buttons. */
export function isPressHeld(form: object): boolean {
  return heldBy.has(form);
}

/**
 * End `button`'s held press on `form`, and submit it from that button when `submit` says so.
 * A button that does not own the hold changes nothing and sends nothing, and a second release of
 * the same press finds it gone: one held press, one request at most.
 */
export function releaseHeldPress(form: HoldingForm, button: HTMLElement, submit: boolean): boolean {
  if (heldBy.get(form) !== button) return false;
  heldBy.delete(form);
  form.dispatchEvent(new Event(HELD_PRESS_OVER_EVENT));
  if (submit) form.requestSubmit(button);
  return true;
}
