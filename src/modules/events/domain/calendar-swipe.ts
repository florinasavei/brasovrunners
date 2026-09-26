/**
 * The calendar's swipe (`DECISIONS.md` §NNN): a thumb drawn sideways across the month on a phone
 * steps to the next or the previous one, the way Google Calendar does. The two arrows stay — the
 * swipe is a second way to press them, never the only one.
 *
 * Pure, so the thresholds are tested without a DOM: the island (`CalendarSwipe`) measures the
 * finger and asks these two questions.
 */

/** Which arrow a gesture presses. */
export type SwipeStep = "previous" | "next";

/** How far a finger may wander before the gesture is read as one direction or the other. */
export const SWIPE_SLOP = 10;

/** The shortest drag that is a swipe, in pixels, whatever the width… */
const MIN_DISTANCE = 48;
/** …or a fifth of the calendar's width, when that is more. */
const WIDTH_SHARE = 0.2;
/** A quick flick counts from a shorter drag: this far, at this speed (pixels per millisecond). */
const FLICK_DISTANCE = 30;
const FLICK_SPEED = 0.4;
/** Sideways means sideways: the horizontal travel must be this many times the vertical. */
const HORIZONTAL_RATIO = 1.5;

/**
 * Once the finger has moved past the slop, is this a sideways drag (the calendar's) or an
 * up-and-down one (the page's scroll)? `null` while it is still too small to say.
 */
export function swipeAxis(dx: number, dy: number): "x" | "y" | null {
  if (Math.hypot(dx, dy) < SWIPE_SLOP) return null;
  return Math.abs(dx) > Math.abs(dy) ? "x" : "y";
}

/**
 * The finger has lifted: `dx`, `dy` from where it landed, `ms` since, `width` of the calendar.
 * A drag to the left turns the page forward, as paper does — the next month comes in from the
 * right — and a drag to the right goes back. Anything short, slow or diagonal is no swipe.
 */
export function readSwipe({ dx, dy, ms, width }: { dx: number; dy: number; ms: number; width: number }): SwipeStep | null {
  const distance = Math.abs(dx);
  if (distance < HORIZONTAL_RATIO * Math.abs(dy)) return null;
  const far = distance >= Math.max(MIN_DISTANCE, WIDTH_SHARE * width);
  const flick = distance >= FLICK_DISTANCE && ms > 0 && distance / ms >= FLICK_SPEED;
  if (!far && !flick) return null;
  return dx < 0 ? "next" : "previous";
}
