"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useLayoutEffect } from "react";

/** Where the pressed row stood on screen, kept for the one navigation its press makes. */
const KEY = "br.registrations.row-place";
/** A press answers in a second or two; anything older is not this press's place. */
const FRESH_MS = 20_000;

/** How long the list is watched for the router's scroll after it comes back. */
const WATCH_MS = 2_500;

type Kept = { id: string; top: number; at: number };

/**
 * The row as it is on screen now: its row of the wide table (`id`), or, on a phone, the block that stands for it
 * (`data-row-anchor`, `AdminTable`) — whichever is displayed. The address is letters, digits and hyphens.
 */
function shownRow(anchor: string): HTMLElement | null {
  if (!/^[A-Za-z0-9-]+$/.test(anchor)) return null;
  const drawn = [document.getElementById(anchor), ...document.querySelectorAll<HTMLElement>(`[data-row-anchor="${anchor}"]`)];
  return drawn.find((element): element is HTMLElement => element !== null && element.getClientRects().length > 0) ?? null;
}

/** Ends the watch under way, when a second press starts another. */
let endWatch: (() => void) | null = null;

/**
 * The router answers the row's address by scrolling the row to the top of the window — in the list's own redraw, or a
 * moment after it, once its rows have arrived; on a phone, where the row's address is not on screen, nothing scrolls
 * but the outcome's alert at the top of the page pushes the blocks down. So the row is looked at in the first frame
 * after the list came back and at the first scroll after that: found off the place it was pressed at, it is scrolled
 * back by the difference, once, and the watch ends. Both happen before the frame is painted, so the row is never
 * seen anywhere else. After `WATCH_MS` nothing is watched: a later scroll is a hand's.
 */
function watchForTheRoutersScroll(id: string, top: number): void {
  endWatch?.();
  let frame = 0;
  let timer = 0;
  const stop = () => {
    window.removeEventListener("scroll", settle);
    window.clearTimeout(timer);
    cancelAnimationFrame(frame);
    endWatch = null;
  };
  const settle = () => {
    // Only on the row's own address: a refusal landed on the alert, and that is where the reader should be.
    if (window.location.hash !== `#${id}`) return;
    const row = shownRow(id);
    if (!row) return;
    const off = row.getBoundingClientRect().top - top;
    // Still where it was pressed: the router has not scrolled yet.
    if (Math.abs(off) <= 1) return;
    stop();
    window.scrollBy({ top: off, behavior: "instant" });
  };
  endWatch = stop;
  window.addEventListener("scroll", settle, { passive: true });
  frame = requestAnimationFrame(settle);
  timer = window.setTimeout(stop, WATCH_MS);
}

/**
 * A press on a row of the registrations list leaves the row where it was on screen (§943; the owner, 2026-11-12: «Mă
 * disperă în general că atunci când fac un edit gen „aleg partenerul” și navighezi»).
 *
 * The press comes back to the row's own address (`listReturnAnchor`), and a browser answers a fragment by putting its
 * target at the top of the window — the row under the hand jumped up the screen. So: when a form that names a row
 * (`registrationId`) and the list (`listQuery`) is sent, this notes how far down the window that row stands; when the
 * list comes back on that row's address and the router scrolls to it, that scroll is undone in the same frame.
 * One press, one use: the note is dropped as it is read, and a stale one is ignored.
 *
 * It receives one string — the prefix of a row's address — and no row, no name; it reads two hidden fields of the form
 * being sent, in the browser. With scripts off, or when the row is not on the page that comes back (another page of
 * the list, a filter it left), the fragment alone decides: the row at the top of the window, or the list's alert.
 */
export default function KeepRowPlace({ anchorPrefix }: { anchorPrefix: string }) {
  const search = useSearchParams();

  useEffect(() => {
    const onSubmit = (event: Event) => {
      const form = event.target;
      if (!(form instanceof HTMLFormElement) || !form.elements.namedItem("listQuery")) return;
      const field = form.elements.namedItem("registrationId");
      const id = field instanceof HTMLInputElement ? field.value : "";
      const row = id ? shownRow(`${anchorPrefix}${id}`) : null;
      if (!row) return;
      try {
        window.sessionStorage.setItem(KEY, JSON.stringify({ id: `${anchorPrefix}${id}`, top: row.getBoundingClientRect().top, at: Date.now() } satisfies Kept));
      } catch {
        // Storage refused: the fragment alone decides.
      }
    };
    // Capture, on the document: the dialogs' forms are drawn outside the table.
    document.addEventListener("submit", onSubmit, true);
    return () => document.removeEventListener("submit", onSubmit, true);
  }, [anchorPrefix]);

  useLayoutEffect(() => {
    let kept: Kept | null = null;
    try {
      const raw = window.sessionStorage.getItem(KEY);
      if (raw === null) return;
      window.sessionStorage.removeItem(KEY);
      kept = JSON.parse(raw) as Kept;
    } catch {
      return;
    }
    if (!kept || typeof kept.id !== "string" || typeof kept.top !== "number" || Date.now() - kept.at > FRESH_MS) return;
    // Not this effect's to end: the list is drawn more than once on its way back, and the watch must outlive each draw.
    watchForTheRoutersScroll(kept.id, kept.top);
  }, [search]);

  return null;
}
