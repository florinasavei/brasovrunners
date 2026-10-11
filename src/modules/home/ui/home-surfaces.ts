import { GRADIENT } from "@/theme/brand";
import { LOOK_ACCENT_TINT, UNDER_LOOK } from "@/theme/look";

/**
 * The home page's sections' surfaces (§714), as plain `sx` objects a Server Component can spread
 * (§166: never a function of the theme, which cannot cross into MUI's client components). Colour
 * comes from `brand.ts`'s tokens only (§694); every pair of words on these fills is held at AA by
 * `tests/unit/theme/brand.test.ts` (`HERO_PAIRS` for today's look) and, for every accent the club may
 * choose, by `tests/unit/appearance/look-accent.test.ts`.
 *
 * Today's look and the new one, by the scope (`theme/look.ts`), never by reading the setting: under
 * «Aspectul nou» the band turns the accent's pale band (`accentTint`, pink by default) the plan gives
 * it, light or dark by the variable the layout's stylesheet sets. The words on a band are
 * `text.primary` / `text.secondary`; a glyph or a figure is the palette's primary, the blue today
 * and the club's accent under the look.
 */

/**
 * A band across the page — «Prima dată», the numbers: the hero's tint today, the accent's pale band
 * under the look — the club's accent (§723), whose stylesheet sets the variable light and dark, so the
 * one rule serves both schemes (it outranks the `[data-dark]` rule by its scope).
 */
export const HOME_BAND_SX = {
  bgcolor: GRADIENT.heroTint,
  "[data-dark] &": { bgcolor: GRADIENT.heroTintDark },
  [UNDER_LOOK]: { bgcolor: LOOK_ACCENT_TINT },
} as const;

/** The round seat of a step's or a reason's glyph: the card colour, the glyph in the primary, 48 pixels. */
export const GLYPH_SEAT_SX = {
  width: 48,
  height: 48,
  borderRadius: "50%",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  flexShrink: 0,
  bgcolor: "background.paper",
  color: "primary.main",
  border: 1,
  borderColor: "divider",
} as const;

/** The radius of a home card or tile: the plan's 16 pixels under both looks. */
export const HOME_RADIUS_PX = 16;

/** Read by a screen reader, not drawn: a heading the eye does not need (the numbers band's). */
export const VISUALLY_HIDDEN_SX = {
  position: "absolute",
  width: "1px",
  height: "1px",
  p: 0,
  m: "-1px",
  overflow: "hidden",
  clip: "rect(0 0 0 0)",
  whiteSpace: "nowrap",
  border: 0,
} as const;

/** A section's own heading: the theme's `h2` (Inter 800 under the look), sized for a phone first. */
export const HOME_HEADING_SX = { fontSize: { xs: "1.5rem", md: "2rem" }, mb: 1 } as const;
