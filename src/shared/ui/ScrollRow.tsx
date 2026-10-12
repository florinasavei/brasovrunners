"use client";

import Box from "@mui/material/Box";
import type { SxProps, Theme } from "@mui/material/styles";
import { useEffect, useRef, type ReactNode } from "react";
import { SCROLL_ROW_SX } from "@/shared/ui/scroll-row";

/**
 * A row that scrolls sideways and shows it (§720 amended): `SCROLL_ROW_SX`'s visible scrollbar,
 * and an edge fade only while there is more to see that way — `data-more-start` / `data-more-end`
 * set from the scroller's own position.
 *
 * Why a small island and not CSS scroll-driven animations: a mask's gradient stop cannot be
 * animated without a registered custom property, scroll timelines are missing from Safari 17 and
 * Firefox, and iOS shows no scrollbar until one scrolls, so the cue is what matters there. The
 * attributes are written straight onto the element (no state, no re-render); with scripts off
 * the scrollbar alone carries the cue and nothing is ever masked. Strings and children only
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
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => {
      const left = Math.abs(el.scrollLeft);
      el.toggleAttribute("data-more-start", left > 1);
      el.toggleAttribute("data-more-end", el.scrollWidth - el.clientWidth - left > 1);
    };
    update();
    el.addEventListener("scroll", update, { passive: true });
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    observer?.observe(el);
    return () => {
      el.removeEventListener("scroll", update);
      observer?.disconnect();
    };
  }, []);
  return (
    <Box ref={ref} role={role} aria-label={ariaLabel} data-testid={testId} sx={[SCROLL_ROW_SX, ...(Array.isArray(sx) ? sx : [sx])]}>
      {children}
    </Box>
  );
}
