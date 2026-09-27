"use client";

import { useEffect, useRef } from "react";

/** `setTimeout` takes a signed 32-bit delay; the club's window is at most an hour, far below it. */
const MAX_DELAY_MS = 2_147_483_647;

/**
 * Presses «Gata» by itself when the family sitting's window ends while its screen is still open
 * (§NNN; the review of 2026-09-27: the email must leave when the screen says it does).
 *
 * The held email leaves the outbox on its own only at the outbox job's next run, which an external
 * pinger starts — every quarter of an hour by day, hourly at night and on QA. A screen left open
 * would otherwise wait for that. Pressed here, the release sends it after its own response, as «Gata»
 * pressed by hand does (`releaseFamilySitting`, `drainOutboxAfterResponse`). With the page closed, or
 * JavaScript off, the pinger's run is what sends it, and the screen's sentence says so.
 *
 * The delay is the server's arithmetic (the window's end less the render's instant), so a browser
 * clock set wrong does not move it. Guarded against firing twice (React mounts effects twice in
 * development); a second press would release nothing anyway.
 */
export default function PressWhenWindowEnds({ delayMs }: { delayMs: number }) {
  const anchor = useRef<HTMLSpanElement>(null);
  const fired = useRef(false);

  useEffect(() => {
    const form = anchor.current?.closest("form");
    if (!form) return;
    const timer = window.setTimeout(
      () => {
        if (fired.current) return;
        fired.current = true;
        // `requestSubmit`, never `submit`: React's form action listens for the submit event.
        form.requestSubmit();
      },
      Math.min(Math.max(0, delayMs), MAX_DELAY_MS),
    );
    return () => window.clearTimeout(timer);
  }, [delayMs]);

  return <span ref={anchor} hidden />;
}
