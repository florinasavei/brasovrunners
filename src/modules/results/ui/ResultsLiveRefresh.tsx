"use client";

import Typography from "@mui/material/Typography";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { RESULTS_REFRESH_MS } from "../domain/live-window";
import { startLiveRefresh } from "./live-refresh";

/**
 * «Se actualizează singur la 30 de secunde» (§NNN; the owner, 2026-11-18: «pe site live trebuie sa vad lista de finish», and, asked,
 * «LIVE» — the public list refreshes itself every 30 seconds while the page is open, and does nothing after the race).
 *
 * Drawn by `ResultsSection` only with the section and only inside the race's window (`live-window.ts#resultsLiveAt`): a period of
 * `router.refresh()` — the page's own server render again, through the public cache, so an unchanged page is one request and a result
 * saved since (it expires the page's tags, §333) is a render and one read — while the tab is visible, at once when it becomes visible
 * again with a refresh due, and nothing at all from `until` on, when the line goes too. The clock is `live-refresh.ts`, unit-tested.
 *
 * Plain props only (§370): the window's end in milliseconds and the line's words. No icon, nothing from `action-icons.ts` (§318).
 */
export default function ResultsLiveRefresh({ until, line }: { until: number; line: string }) {
  const router = useRouter();
  // The server drew the line inside the window; the browser takes it away once the window is over (a page kept past it says nothing).
  const [live, setLive] = useState(true);
  useEffect(() => {
    const clock = startLiveRefresh(
      {
        now: () => Date.now(),
        visible: () => document.visibilityState === "visible",
        refresh: () => router.refresh(),
        setTimeout: (callback, ms) => window.setTimeout(callback, ms),
        clearTimeout: (handle) => window.clearTimeout(handle as number),
      },
      { until, everyMs: RESULTS_REFRESH_MS, onEnd: () => setLive(false) },
    );
    document.addEventListener("visibilitychange", clock.onVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", clock.onVisibilityChange);
      clock.stop();
    };
  }, [router, until]);
  if (!live) return null;
  return (
    <Typography variant="body2" color="text.secondary" data-testid="results-live" sx={{ pb: 1 }}>
      {line}
    </Typography>
  );
}
