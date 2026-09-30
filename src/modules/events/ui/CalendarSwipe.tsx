"use client";

import Box from "@mui/material/Box";
import { useRouter } from "next/navigation";
import { type PointerEvent, type ReactNode, useEffect, useRef, useTransition } from "react";
import { readSwipe, type SwipeStep, swipeAxis } from "../domain/calendar-swipe";

/**
 * The month follows the thumb (`DECISIONS.md` §475): on a touch screen a sideways drag across the
 * calendar pulls it along under the finger, and a drag far or quick enough steps to the next month
 * (to the left) or the previous one (to the right) — Google Calendar's gesture. In the year view
 * the same drag steps a year, because it presses whatever the header's arrows press.
 *
 * What it is not: the only way. The header's arrows, the selects and «Azi» are untouched, the grid
 * is server-rendered HTML inside `children` (a child is the one channel an element may cross into
 * a client component, §370), and with scripts off this is a plain box. A mouse never swipes — a
 * drag with a mouse selects text — so only touch and pen pointers are read.
 *
 * `touch-action: pan-y pinch-zoom` hands the vertical scroll and the pinch to the browser and keeps
 * the sideways drag for the calendar; an up-and-down drag is the page's, and the browser cancels
 * ours. A swipe that began on an event's chip does not also open the event: a click that follows
 * the lift is swallowed.
 *
 * The step is `router.push` with the address the arrow carries, `scroll: false` so the reader stays
 * where they are on the page, inside a transition so the month on screen stays — dimmed, `aria-busy`
 * — until the next one is ready (§166, §413). Nothing is prefetched here, and since §549 the arrows'
 * own links are not either: a stepped address is a period's own static page since §NNN
 * (`/calendar/2026-10`), but a month nobody has opened today is a render, and a prefetch of it a
 * function started on a visit the CDN answers alone (and a database awake, §327). Under reduced motion nothing
 * slides; the swipe still steps.
 *
 * The addresses are paths, never `?month=` (§NNN): on the static calendar a query was answered by
 * Next's router from the bare page's prefetched copy, so a swipe changed the address and the same
 * month stayed on screen.
 */
export default function CalendarSwipe({
  previousHref,
  nextHref,
  children,
}: {
  /** Already localized, already carrying the period and every filter it keeps — the arrows' own. */
  previousHref: string;
  nextHref: string;
  children: ReactNode;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const box = useRef<HTMLDivElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const gesture = useRef<{ id: number; x: number; y: number; at: number; axis: "x" | "y" | null } | null>(null);
  const swallowClick = useRef(false);
  const lastStep = useRef<SwipeStep | null>(null);

  // The step has landed (or come to nothing): the new period comes in a short way from the side the
  // thumb pushed towards and settles — or simply appears under reduced motion.
  useEffect(() => {
    if (pending) return;
    const step = lastStep.current;
    lastStep.current = null;
    if (step) arriving = null;
    return settle(track.current, step);
  }, [pending, previousHref, nextHref]);

  // Each period is a page of its own path since §NNN (`/calendar/2026-10`), so the next period
  // usually arrives as a new calendar rather than as this one re-rendered: the step is handed over
  // through `arriving`, and the calendar that mounts with it slides in the same way.
  useEffect(() => {
    const handed = arriving && performance.now() - arriving.at < ARRIVAL_WINDOW_MS ? arriving.step : null;
    arriving = null;
    return settle(track.current, handed);
  }, []);

  const end = (event: PointerEvent<HTMLDivElement>, cancelled: boolean) => {
    const start = gesture.current;
    if (!start || start.id !== event.pointerId) return;
    gesture.current = null;
    if (start.axis !== "x") return;
    // A sideways drag is never also a tap on the chip it began on — for the next moment only, so a
    // keyboard press later is never eaten.
    swallowClick.current = true;
    window.setTimeout(() => {
      swallowClick.current = false;
    }, 400);
    const width = box.current?.clientWidth ?? 0;
    const step = cancelled
      ? null
      : readSwipe({ dx: event.clientX - start.x, dy: event.clientY - start.y, ms: event.timeStamp - start.at, width });
    if (!step) {
      slide(track.current, 0, !reducedMotion());
      return;
    }
    lastStep.current = step;
    arriving = { step, at: performance.now() };
    if (!reducedMotion()) slide(track.current, step === "next" ? -width * 0.35 : width * 0.35, true, 0.4);
    startTransition(() => router.push(step === "next" ? nextHref : previousHref, { scroll: false }));
  };

  return (
    <Box
      ref={box}
      aria-busy={pending || undefined}
      // `clip`, not `hidden`: nothing is cut while the month is still, and no scroll box is made.
      sx={{ overflowX: "clip", touchAction: "pan-y pinch-zoom" }}
      onPointerDown={(event) => {
        if (event.pointerType === "mouse" || !event.isPrimary) return;
        swallowClick.current = false;
        gesture.current = { id: event.pointerId, x: event.clientX, y: event.clientY, at: event.timeStamp, axis: null };
      }}
      onPointerMove={(event) => {
        const start = gesture.current;
        if (!start || start.id !== event.pointerId) return;
        const dx = event.clientX - start.x;
        if (start.axis === null) start.axis = swipeAxis(dx, event.clientY - start.y);
        if (start.axis === "x" && !reducedMotion()) slide(track.current, dx, false);
      }}
      onPointerUp={(event) => end(event, false)}
      onPointerCancel={(event) => end(event, true)}
      onClickCapture={(event) => {
        if (!swallowClick.current) return;
        swallowClick.current = false;
        event.preventDefault();
        event.stopPropagation();
      }}
    >
      <Box ref={track} sx={{ opacity: pending ? 0.6 : undefined }}>
        {children}
      </Box>
    </Box>
  );
}

/**
 * The step a swipe has just pressed, for the calendar that arrives with the next period (§NNN): a
 * period's path is a page of its own, so that calendar is a new instance and cannot read the old
 * one's refs. One per tab, cleared by whoever reads it, and believed only for a few seconds, so a
 * swipe whose navigation came to nothing never slides a calendar met later.
 */
let arriving: { step: SwipeStep; at: number } | null = null;
const ARRIVAL_WINDOW_MS = 10_000;

/** Brings the calendar in from the side `step` pushed towards and settles it; with no step, or under reduced motion, it simply stands. */
function settle(element: HTMLDivElement | null, step: SwipeStep | null): (() => void) | undefined {
  if (!step || reducedMotion()) {
    slide(element, 0, false);
    return undefined;
  }
  slide(element, step === "next" ? 24 : -24, false);
  const frame = requestAnimationFrame(() => slide(element, 0, true));
  return () => cancelAnimationFrame(frame);
}

function reducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}

/** Moves the month sideways by `offset` pixels — at once under the finger, eased when it lets go. */
function slide(element: HTMLDivElement | null, offset: number, animate: boolean, opacity = 1) {
  if (!element) return;
  element.style.transition = animate ? "transform 200ms cubic-bezier(0.2, 0, 0, 1), opacity 200ms linear" : "none";
  element.style.transform = offset === 0 ? "" : `translateX(${offset}px)`;
  element.style.opacity = opacity === 1 ? "" : String(opacity);
}
