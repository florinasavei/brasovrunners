"use client";

import Button, { type ButtonProps } from "@mui/material/Button";
import type { SvgIconProps } from "@mui/material/SvgIcon";
import type { ComponentType } from "react";

/**
 * A button that does something in the page — opens a dialog, downloads what the browser drew — for a client
 * island on a public page (§855). The house's other buttons go somewhere (`ButtonLink`) or send a form
 * (`SubmitButton`); this one runs its `onClick`. It always wears its glyph before the words (§498), handed
 * in as the icon component itself — one file per glyph, never the barrel (§90) — and is a 44-pixel target.
 */
export default function PressButton({
  icon: Glyph,
  children,
  sx,
  ...props
}: Omit<ButtonProps, "startIcon" | "href"> & { icon: ComponentType<SvgIconProps> }) {
  return (
    <Button type="button" sx={[{ minHeight: 44, gap: 0.5 }, ...(Array.isArray(sx) ? sx : [sx])]} {...props}>
      <Glyph aria-hidden="true" sx={{ fontSize: 18 }} />
      {children}
    </Button>
  );
}
