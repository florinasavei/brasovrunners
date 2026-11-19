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
 * Drawn by `ResultsSection` only inside the race's window, on a race whose results are ticked public (`live-window.ts#resultsLiveRefreshUntil`):
 * in the section, under «Publicat …», with its line — or, while the section is not drawn (the sheet still empty before the first finish,
 * or the database away at that render), alone in its place with no line (`line` null), so the first result saved, or the section back,
 * reaches a page opened then. A period of `router.refresh()` — the page's own server render again: for an anonymous visitor at the bare
 * address the static page, answered by the CDN while nothing changed and made again once a save expired its tags (§333, §549); for a
 * signed-in tab, or an address with a query the page reads, the live twin, a server render each time (§549, §577) — while the tab is
 * visible, at once when it becomes visible again with a refresh due, and nothing at all from `until` on, when the line goes too. The
 * clock is `live-refresh.ts`, unit-tested.
 *
 * Plain props only (§370): the window's end in milliseconds and the line's words. No icon, nothing from `action-icons.ts` (§318).
 */
export default function ResultsLiveRefresh({ until, line }: { until: number; line: string | null }) {
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
  // Alone, before the first finish: nothing to read and nothing seen — the clock only (`hidden` keeps it out of the page and the tree a reader hears).
  if (line === null) return <span hidden data-testid="results-live-quiet" />;
  return (
    <Typography variant="body2" color="text.secondary" data-testid="results-live" sx={{ pb: 1 }}>
      {line}
    </Typography>
  );
}
