"use client";

import Typography from "@mui/material/Typography";
import { useEffect, useState } from "react";
import { formatResultTime } from "../domain/result-time";

/**
 * «De la start: 0:45:12» (§NNN): the time since the gun, ticking every second on the finish line's page, so the volunteer sees
 * the clock the next press will stamp. The one island of the page: a clock cannot be a Server Component. The server draws the
 * same sentence with its own `now`, so the page says the time with no script and the island only keeps it moving; the first paint
 * may differ by the request's seconds, hence `suppressHydrationWarning`. The press itself stamps the server's clock, never this one.
 */
export default function FinishClock({ gunAtMs, nowMs, label }: { gunAtMs: number; nowMs: number; label: string }) {
  const [elapsed, setElapsed] = useState(Math.max(0, nowMs - gunAtMs));
  useEffect(() => {
    // The client's clock from here on: the server's `now` plus what has passed since the paint.
    const paintedAt = Date.now();
    const tick = () => setElapsed(Math.max(0, nowMs - gunAtMs + (Date.now() - paintedAt)));
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [gunAtMs, nowMs]);
  return (
    <Typography variant="h4" component="p" sx={{ fontVariantNumeric: "tabular-nums" }} suppressHydrationWarning data-testid="finish-clock">
      {label.replace("{time}", formatResultTime(Math.floor(elapsed / 1000) * 1000))}
    </Typography>
  );
}
