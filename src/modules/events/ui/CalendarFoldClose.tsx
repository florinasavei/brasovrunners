"use client";

import { useEffect } from "react";
import { CALENDAR_PILL_LEFT_VAR } from "./share-pill";

/**
 * What the event page's «Adaugă în calendar» dropdown (`DECISIONS.md` §NNN, amending §772) does once there is
 * a script. The fold itself is a native `<details>` whose panel is plain CSS, so it opens and closes with the
 * pill and works with scripts off; this island adds three things a dropdown is expected to do, and draws nothing:
 *
 * - Escape closes it, and returns focus to the pill when it was inside the panel — a keyboard user is not
 *   dropped at the top of the page;
 * - a click outside it closes it (`click`, not `pointerdown`: a swipe that starts outside to scroll the panel
 *   into view fires no click, so it does not close the panel under the finger);
 * - the panel's left edge is the pill's: the pill's offset in the share row goes into
 *   `CALENDAR_PILL_LEFT_VAR` on the row, now and whenever the row or a pill in it changes size or a pill
 *   arrives (a wrap, a font, the phone's own share button once the browser has said it can), and the
 *   panel's own CSS pulls it back inside the row's width. Written ahead of any opening, so the panel never
 *   jumps when it appears.
 *
 * It finds the fold by its id; the row is the fold's parent.
 */
export default function CalendarFoldClose({ foldId }: { foldId: string }) {
  useEffect(() => {
    const fold = document.getElementById(foldId);
    if (!(fold instanceof HTMLDetailsElement)) return;
    const row = fold.parentElement;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !fold.open) return;
      const inside = fold.contains(document.activeElement);
      fold.open = false;
      if (inside) fold.querySelector<HTMLElement>(":scope > summary")?.focus();
    };
    const onClick = (event: Event) => {
      if (fold.open && event.target instanceof Node && !fold.contains(event.target)) fold.open = false;
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("click", onClick);
    let resizes: ResizeObserver | undefined;
    let arrivals: MutationObserver | undefined;
    if (row) {
      const place = () => row.style.setProperty(CALENDAR_PILL_LEFT_VAR, `${fold.offsetLeft}px`);
      const watch = () => {
        place();
        resizes?.disconnect();
        resizes?.observe(row);
        for (const child of Array.from(row.children)) resizes?.observe(child);
      };
      if (typeof ResizeObserver === "function") resizes = new ResizeObserver(place);
      if (typeof MutationObserver === "function") arrivals = new MutationObserver(watch);
      arrivals?.observe(row, { childList: true });
      watch();
    }
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("click", onClick);
      resizes?.disconnect();
      arrivals?.disconnect();
      row?.style.removeProperty(CALENDAR_PILL_LEFT_VAR);
    };
  }, [foldId]);
  return null;
}
