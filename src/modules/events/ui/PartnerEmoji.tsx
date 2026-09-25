import Box from "@mui/material/Box";
import type { BoxProps } from "@mui/material/Box";
import type { SvgIconProps } from "@mui/material/SvgIcon";
import { forwardRef } from "react";

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
 * `forwardRef`, and every prop but `sx`/`fontSize` spread onto the `Box`: `PartnerMark`'s
 * `Tooltip` clones its child with a `ref` and `onMouseEnter`/`onFocus` handlers of its own,
 * the way it would any icon — dropped, the mark never opened a tooltip on hover.
 *
 * The default size, 1.5rem, is `SvgIcon`'s own "medium" — what `HandshakeIcon` rendered at
 * inside `GlyphChip`'s chip icon, which set no size of its own.
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
      {...(rest as BoxProps)}
      sx={{
        display: "inline-flex",
        alignItems: "center",
        lineHeight: 1,
        fontSize: fontSize ?? "1.5rem",
        ...(sx && typeof sx === "object" && !Array.isArray(sx) ? sx : {}),
      }}
    >
      🤝
    </Box>
  );
});

export default PartnerEmoji;
