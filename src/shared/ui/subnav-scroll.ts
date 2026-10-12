/**
 * The measurement behind `SubNavCurrent` (§731), pure so a test can feed it numbers.
 *
 * Both take client rects (`getBoundingClientRect()`), so they are right wherever the row sits on
 * the page: a page gutter, a padded container or any positioned ancestor cancels out. Never
 * `offsetLeft`, which is measured from the entry's `offsetParent`, not from the row.
 */
export type Span = { left: number; right: number };

/** Whether the entry lies inside the row, with a pixel of slack for sub-pixel layout. */
export function currentInView(scroller: Span, current: Span): boolean {
  return current.left >= scroller.left - 1 && current.right <= scroller.right + 1;
}

/** The `scrollLeft` that centres the entry in the row, from the rect difference. */
export function centredScrollLeft(scroller: Span, current: Span, scrollLeft: number, clientWidth: number): number {
  const width = current.right - current.left;
  return scrollLeft + (current.left - scroller.left) - (clientWidth - width) / 2;
}
