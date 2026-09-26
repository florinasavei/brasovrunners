/**
 * When somebody may say they have read the race's conditions (`DECISIONS.md` §195).
 *
 * Pure, and separate from the panel that draws it, because the interesting part is not the
 * dialog: it is that a scroll position is a *measurement of a browser*, not of a person, and the
 * rule has to be written so that being wrong about the measurement never traps somebody who has
 * genuinely read the text.
 *
 * Three cases, and the last is the one that matters:
 *
 * - The text is longer than its box: the button opens when the scroll reaches the end.
 * - The text is shorter than its box — a short set of rules on a tall screen — and there is
 *   nothing to scroll. It is already all on screen, so the button is open from the start. A gate
 *   that waited for a scroll that can never happen would be a gate nobody could pass.
 * - The measurement has not arrived yet (the panel has just opened, nothing has been measured).
 *   Treated as "not yet", because the honest default before knowing anything is to wait.
 *
 * `TOLERANCE` exists because these numbers are fractional and browsers disagree about the last
 * pixel: a zoomed page, a high-density screen and a scrollbar that overlays rather than occupies
 * all produce a `scrollTop + clientHeight` that lands a pixel or two short of `scrollHeight`
 * while the reader is looking at the last line. Somebody who has read to the end and cannot say
 * so is exactly the failure this whole feature exists to avoid.
 */
export const SCROLL_END_TOLERANCE_PX = 8;

export type ScrollMeasurement = {
  scrollTop: number;
  clientHeight: number;
  scrollHeight: number;
};

export function hasReachedEnd(measurement: ScrollMeasurement | null): boolean {
  if (!measurement) return false;
  const { scrollTop, clientHeight, scrollHeight } = measurement;
  // Nothing to scroll: the whole text is already on screen.
  if (scrollHeight <= clientHeight + SCROLL_END_TOLERANCE_PX) return true;
  // Rounded up (§NNN): at 125 % or a 90 % zoom `scrollTop` stops a fraction short of the last
  // device pixel, and a fraction must never be the difference between read and not read.
  return Math.ceil(scrollTop + clientHeight) >= scrollHeight - SCROLL_END_TOLERANCE_PX;
}
