"use client";

import Box from "@mui/material/Box";
import { useLayoutEffect, useRef } from "react";
import { watchScrollRow } from "@/shared/ui/scroll-row";
import { TOP_SCROLLBAR_SX } from "@/shared/ui/top-scrollbar";

/**
 * A second horizontal scrollbar right above a frame that scrolls sideways (§NNN), so a long, wide table moves sideways
 * from wherever the reader is rather than from its bottom edge. It receives the frame's address, a string (§370), finds
 * the frame by it and watches it with the chips rows' own watcher (`watchScrollRow`) — the one watcher that frame has,
 * which also keeps the frame's `data-more-*` edge cue (§943's fading verbs) — given this bar as its `mirror`: shown while
 * the frame overflows, as far-reaching as the frame, the two kept in step both ways.
 *
 * Decoration for a pointer: `aria-hidden` and out of the tab order (a scrollable box is otherwise focusable in current
 * Chrome) — the frame itself stays the keyboard's and the screen reader's. The server draws it as nothing to see
 * (`TOP_SCROLLBAR_SX`'s `display: none` until `data-shown`), so with JavaScript off, or before hydration, the frame's own
 * scrollbar at the bottom is the only one, as before.
 */
export default function TopScrollbar({ frameId }: { frameId: string }) {
  const ref = useRef<HTMLDivElement>(null);
  // In the hydration commit, before the browser paints it: an overflowing table shows its bar from its first painted frame.
  useLayoutEffect(() => {
    const frame = document.getElementById(frameId);
    const bar = ref.current;
    if (!frame || !bar) return;
    return watchScrollRow(
      frame,
      typeof ResizeObserver === "undefined" ? undefined : ResizeObserver,
      typeof MutationObserver === "undefined" ? undefined : MutationObserver,
      undefined,
      bar,
    );
  }, [frameId]);
  return (
    <Box ref={ref} aria-hidden="true" tabIndex={-1} data-top-scrollbar={frameId} sx={TOP_SCROLLBAR_SX}>
      <span />
    </Box>
  );
}
