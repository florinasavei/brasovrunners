"use client";

import Box from "@mui/material/Box";
import { useRouter } from "next/navigation";
import { useRef, type ReactNode } from "react";

/**
 * How long a finger has to rest on the badge before it counts as "open the staff entrance".
 * Long enough that a scroll that happens to start on the badge does not open it; short enough
 * that nobody wonders whether it is working. Browsers use 500ms for their own long-press menus.
 */
const LONG_PRESS_MS = 600;

/**
 * The badge as the staff entrance: a double-click, `Enter` when focused, or — on a phone, where a
 * double-tap is unreliable and zooms — a long press (the owner's ask, 2026-09-17). A single tap
 * still does nothing, so a tap that lands on it in the open fold stays inert (§365).
 */
export default function BuildBadgeLink({
  href,
  label,
  title,
  children,
  sx,
}: {
  href: string;
  label: string;
  title: string;
  children: ReactNode;
  sx: Record<string, unknown>;
}) {
  const router = useRouter();
  const open = () => router.push(href);

  const pressTimer = useRef<number | null>(null);
  const cancelPress = () => {
    if (pressTimer.current !== null) {
      window.clearTimeout(pressTimer.current);
      pressTimer.current = null;
    }
  };
  const startPress = () => {
    cancelPress();
    pressTimer.current = window.setTimeout(open, LONG_PRESS_MS);
  };

  return (
    <Box
      component="p"
      role="button"
      tabIndex={0}
      aria-label={label}
      title={title}
      onDoubleClick={open}
      onPointerDown={startPress}
      onPointerUp={cancelPress}
      onPointerLeave={cancelPress}
      onPointerCancel={cancelPress}
      // A long press is what opens the browser's own context menu on a phone; that menu would
      // land on top of the navigation this press is for.
      onContextMenu={(event) => event.preventDefault()}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          open();
        }
      }}
      // `auto` overrides the `none` the inert badge carries: this one has to receive the
      // double-click and the press. `userSelect` and the touch callout are off so a long press
      // selects no text and offers no "copy" bubble instead of opening the door. Everything else
      // about the box — its place in the footer's fold, its size — is the same, and the comment
      // in `BuildBadge.tsx` explains why each of those matters.
      sx={{
        ...sx,
        pointerEvents: "auto",
        cursor: "default",
        userSelect: "none",
        WebkitTouchCallout: "none",
        touchAction: "manipulation",
      }}
    >
      {children}
    </Box>
  );
}
