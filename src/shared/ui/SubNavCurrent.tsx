"use client";

import { useEffect, useRef } from "react";

/**
 * Brings `SubNav`'s current entry into view when the row is wider than the screen (§NNN).
 *
 * It draws nothing: it sits inside the row's `<nav>`, and once the page has hydrated it sets the
 * scroller's own `scrollLeft` so the `aria-current` entry is centred. Never `scrollIntoView`, which
 * also scrolls the page (the reason `AdminTabs` does the same). A row that fits is left alone, as
 * is an entry already inside it, so the swipe a member has made is never undone by a re-render.
 */
export default function SubNavCurrent() {
  const marker = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const scroller = marker.current?.closest("nav");
    const current = scroller?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!scroller || !current || scroller.scrollWidth <= scroller.clientWidth) return;
    const start = current.offsetLeft;
    const end = start + current.offsetWidth;
    if (start >= scroller.scrollLeft && end <= scroller.scrollLeft + scroller.clientWidth) return;
    scroller.scrollLeft = start - (scroller.clientWidth - current.offsetWidth) / 2;
  }, []);
  return <span ref={marker} hidden />;
}
