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
 * The press posts `field` as "1" (a press by hand posts it empty), so the action can tell it apart:
 * the browser's half outlives the window by a short grace for this press, and should a slow phone
 * still arrive without it, the automatic press does nothing — the server releases the sitting at the
 * window's end anyway (the review of 2026-09-27).
 *
 * The delay is the server's arithmetic (the window's end less the render's instant), so a browser
 * clock set wrong does not move it. Guarded against firing twice (React mounts effects twice in
 * development); a second press would release nothing anyway.
 */
export default function PressWhenWindowEnds({ delayMs, field }: { delayMs: number; field: string }) {
  const marker = useRef<HTMLInputElement>(null);
  const fired = useRef(false);

  useEffect(() => {
    const input = marker.current;
    const form = input?.closest("form");
    if (!input || !form) return;
    const timer = window.setTimeout(
      () => {
        if (fired.current) return;
        fired.current = true;
        input.value = "1";
        // `requestSubmit`, never `submit`: React's form action listens for the submit event.
        form.requestSubmit();
      },
      Math.min(Math.max(0, delayMs), MAX_DELAY_MS),
    );
    return () => window.clearTimeout(timer);
  }, [delayMs]);

  return <input ref={marker} type="hidden" name={field} defaultValue="" />;
}
