"use client";

import Box from "@mui/material/Box";
import type { SxProps, Theme } from "@mui/material/styles";
import { useEffect, useRef, type ReactNode } from "react";
import { SCROLL_BAR_SX, SCROLL_ROW_SX, watchScrollRow } from "@/shared/ui/scroll-row";

/**
 * A row that scrolls sideways and shows it (§720 amended): `SCROLL_ROW_SX`'s visible scrollbar,
 * and an edge fade only while there is more to see that way — `data-more-start` / `data-more-end`
 * set from the scroller's own position.
 *
 * Why a small island and not CSS scroll-driven animations: a mask's gradient stop cannot be
 * animated without a registered custom property, scroll timelines are missing from Safari 17 and
 * Firefox, and iOS shows no scrollbar until one scrolls, so the cue is what matters there. The
 * attributes are written straight onto the element (no state, no re-render); with scripts off
 * the browser's scrollbar alone carries the cue and nothing is ever masked. With them, a bar of
 * its own under the row (`SCROLL_BAR_SX`) stays in sight while the row overflows — a phone draws
 * its scrollbar only mid-scroll — and the browser's is hidden so a desktop shows one, not two. Strings and children only
 * cross the boundary (§370): the `sx` is a plain object.
 */
export default function ScrollRow({
  children,
  sx,
  role,
  ariaLabel,
  testId,
}: {
  children: ReactNode;
  /** The row's own layout, merged after the shared style; plain values, no callbacks (§370). */
  sx?: SxProps<Theme>;
  role?: string;
  ariaLabel?: string;
  testId?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    return watchScrollRow(
      el,
      typeof ResizeObserver === "undefined" ? undefined : ResizeObserver,
      typeof MutationObserver === "undefined" ? undefined : MutationObserver,
      barRef.current ?? undefined,
    );
  }, []);
  return (
    <>
      <Box ref={ref} role={role} aria-label={ariaLabel} data-testid={testId} sx={[SCROLL_ROW_SX, ...(Array.isArray(sx) ? sx : [sx])]}>
        {children}
      </Box>
      {/* The drawn scrollbar (`SCROLL_BAR_SX`): a phone shows its own only mid-scroll. Shown by the island while the row overflows. */}
      <Box ref={barRef} aria-hidden="true" data-testid={testId ? `${testId}-bar` : undefined} sx={SCROLL_BAR_SX}>
        <span />
      </Box>
    </>
  );
}
