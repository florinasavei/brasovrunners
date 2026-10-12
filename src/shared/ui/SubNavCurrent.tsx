"use client";

import { useEffect, useRef } from "react";
import { centredScrollLeft, currentInView } from "./subnav-scroll";

/**
 * Brings `SubNav`'s current entry into view when the row is wider than the screen (§NNN).
 *
 * It draws nothing: it sits inside the row's `<nav>`, and once the page has hydrated it sets the
 * scroller's own `scrollLeft` so the `aria-current` entry is centred. Never `scrollIntoView`, which
 * also scrolls the page (the reason `AdminTabs` does the same). The entry is measured against the
 * row by client rects, never `offsetLeft` (the row is not positioned, so that would include the
 * page gutter). It runs again when the row's size changes — a late font swap, a rotation — and
 * returns early whenever the entry is already inside the row, so a member's swipe is never undone.
 */
export default function SubNavCurrent() {
  const marker = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const scroller = marker.current?.closest("nav");
    if (!scroller) return;
    const centre = () => {
      const current = scroller.querySelector<HTMLElement>('[aria-current="page"]');
      if (!current || scroller.scrollWidth <= scroller.clientWidth) return;
      const bar = scroller.getBoundingClientRect();
      const box = current.getBoundingClientRect();
      if (currentInView(bar, box)) return;
      scroller.scrollLeft = centredScrollLeft(bar, box, scroller.scrollLeft, scroller.clientWidth);
    };
    centre();
    const observer = new ResizeObserver(centre);
    observer.observe(scroller);
    return () => observer.disconnect();
  }, []);
  return <span ref={marker} hidden />;
}
