"use client";

import Box from "@mui/material/Box";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";

/**
 * The build badge, when the deployment has a staff sign-in behind it.
 *
 * The badge replaced a "Staff" link in the footer, which was a permanent invitation on a page
 * every visitor reads. This is the same door with no signpost: a double-click opens sign-in, and
 * `Enter` does too when the badge has focus, so it is not a mouse-only gesture. A single click
 * does nothing at all — the corner it sits in is where a thumb lands on a 320px screen, and a
 * badge that navigated on one tap would be a trap rather than a shortcut.
 *
 * The one thing this is not is a security measure. The backoffice is guarded on the server on
 * every request (BR-REQ-060-01 criterion 4), and `robots.txt` disallows the path; making the
 * entrance quiet is about what the club's public site advertises, not about who can get in.
 * The accessible name says what the gesture does, because a control only a sighted mouse user
 * can find is a worse answer than a discreet one everybody can.
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

  return (
    <Box
      component="p"
      role="button"
      tabIndex={0}
      aria-label={label}
      title={title}
      onDoubleClick={open}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          open();
        }
      }}
      // `auto` overrides the `none` the inert badge carries: this one has to receive the
      // double-click. Everything else about the box — the corner, the size, the layer below
      // MUI's modal — is the same, and the comment in `BuildBadge.tsx` explains why each of
      // those matters.
      sx={{ ...sx, pointerEvents: "auto", cursor: "default" }}
    >
      {children}
    </Box>
  );
}
