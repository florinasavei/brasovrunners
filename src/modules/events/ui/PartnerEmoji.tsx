import Box from "@mui/material/Box";
import type { BoxProps } from "@mui/material/Box";
import type { SvgIconProps } from "@mui/material/SvgIcon";
import { forwardRef } from "react";

/** `SvgIcon`'s keyword sizes, mapped to the `rem` values Material draws them at, since `fontSize`
 * here reaches raw CSS rather than `SvgIcon`'s own size table. */
const FONT_SIZE: Record<"small" | "medium" | "large" | "inherit", string> = {
  small: "1.25rem",
  medium: "1.5rem",
  large: "2.1875rem",
  inherit: "inherit",
};

/**
 * The partner marker's glyph, 🤝 rendered as text rather than an SVG (§NNN; the owner,
 * 2026-09-25: "I hate the partnership handshake icon, use the emoji 🤝" — a change to §367's
 * "handshake icon" and §375, kept to the same generic label and the same box). Shaped like
 * `Glyph` (`ComponentType<SvgIconProps>`, `glyphs.ts`), so it drops straight into
 * `GLYPHS.partner` and every caller that read the handshake by name — `GlyphChip`,
 * `PartnerMark`, `PartnerOverline`, the calendar's grid and agenda mark — needs no change of its
 * own: `sx.fontSize` still sets the box, and `role`, `aria-label`, `aria-hidden`, `className`
 * and the rest of an icon's usual props still pass straight through.
 *
 * `aria-hidden` defaults to `true`, matching `SvgIcon`'s own default: a caller that names the
 * glyph — `aria-label` or `role`, the way `PartnerMark` does with its own `aria-hidden={false}` —
 * is read out loud; a bare glyph beside a label of its own (`GlyphChip`'s chip label, the
 * overline's and the calendar's own visible words) is not, so a screen reader is never told
 * "handshake" ahead of the sentence naming it. Set ahead of `{...rest}` so an explicit
 * `aria-hidden` from the caller always wins.
 *
 * `forwardRef`, and every prop but `sx`/`fontSize` spread onto the `Box`: `PartnerMark`'s
 * `Tooltip` clones its child with a `ref` and `onMouseEnter`/`onFocus` handlers of its own,
 * the way it would any icon — dropped, the mark never opened a tooltip on hover.
 *
 * The default size, 1.5rem, is `SvgIcon`'s own "medium" — used only outside a chip. Inside
 * `GlyphChip`'s small chip, MUI's own `.MuiChip-icon` rule (18px) wins over both this default
 * and `sx.fontSize`, which is what `HandshakeIcon` rendered at there too.
 *
 * Pinned to a 1em square (`width`/`height`), the SVG's own footprint — an emoji glyph is
 * otherwise wider than its font size (measured ~1.37× on Windows Segoe UI Emoji) and would
 * widen every chip and mark it sits in. `sx` merges as an array, so a caller's array or
 * function `sx` is honoured rather than dropped, and `textDecoration: none` keeps a struck-
 * through line (a cancelled calendar entry) off the emoji glyph, matching the SVG it replaces.
 *
 * A `.tsx` file of its own: `glyphs.ts` carries no JSX, and every other glyph there is a
 * component `@mui/icons-material` already built.
 */
const PartnerEmoji = forwardRef<HTMLSpanElement, SvgIconProps>(function PartnerEmoji({ sx, fontSize, ...rest }, ref) {
  return (
    <Box
      ref={ref}
      component="span"
      data-testid="PartnerEmoji"
      aria-hidden={"aria-label" in rest || "role" in rest ? undefined : true}
      {...(rest as BoxProps)}
      sx={[
        {
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          lineHeight: 1,
          fontSize: fontSize ? (FONT_SIZE[fontSize as keyof typeof FONT_SIZE] ?? fontSize) : FONT_SIZE.medium,
          width: "1em",
          height: "1em",
          overflow: "visible",
          textDecoration: "none",
        },
        ...(Array.isArray(sx) ? sx : sx ? [sx] : []),
      ]}
    >
      🤝
    </Box>
  );
});

export default PartnerEmoji;
