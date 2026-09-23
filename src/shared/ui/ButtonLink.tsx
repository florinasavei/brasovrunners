"use client";

import Button, { type ButtonProps } from "@mui/material/Button";
import type { ComponentProps } from "react";
import { Link } from "@/i18n/navigation";
import { ACTION_ICONS, type ActionIconName } from "./action-icons";

// MUI's own `href` is a plain string. It is dropped so the locale-aware one wins: an
// intersection of the two is a type nothing can satisfy, which surfaces as an error at the
// first call site that passes a route object rather than here. `startIcon` is dropped because a
// Server Component cannot hand an element across; `icon` is the name it can hand instead.
type Props = Omit<ButtonProps, "href" | "startIcon"> &
  Pick<ComponentProps<typeof Link>, "href"> & {
    /** The verb's glyph before the label, by name — never an element (`action-icons.ts`, §NNN). */
    icon?: ActionIconName;
  };

/**
 * A locale-aware MUI Button that renders as a link.
 *
 * This exists because `component={Link}` cannot be written in a Server Component: passing a
 * component across the server/client boundary fails at prerender with "Functions cannot be
 * passed directly to Client Components". Both halves are client-side in here, so it is fine.
 */
export default function ButtonLink({ href, icon, children, ...props }: Props) {
  const Icon = icon ? ACTION_ICONS[icon] : null;
  return (
    // Every overload of MUI's Button types `href` as a plain string, so a locale-aware href
    // object cannot be passed through them however the props are declared. The cast is
    // confined to this one line and the prop above it is fully typed, so a wrong route or a
    // missing parameter is still a compile error at the call site — which is where it matters.
    <Button component={Link} href={href as never} startIcon={Icon ? <Icon fontSize="small" /> : undefined} {...props}>
      {children}
    </Button>
  );
}
