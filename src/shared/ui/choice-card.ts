import { HOVER_OK } from "@/theme/motion";

/**
 * The house's selectable card, written once (§676 step 1, §NNN): the feedback page's branch cards (`BranchChoice`, a native radio)
 * and the volunteers' page's role tiles (`VolunteerRoleTile`, a native checkbox) are the same surface — a bordered, rounded tile
 * whose outline and tint follow the native input's `:checked` and whose keyboard ring follows its `:focus-visible`, in CSS alone
 * (`:has`), so the keyboard, a screen reader and a page with no script behave exactly as with a plain input.
 *
 * Only the surface is shared here; what is inside (a glyph tile, a name, a hint, a description) is each caller's. Theme tokens
 * only, through the CSS variables, so both looks («Tema v1», «Tema v2») and both colour schemes follow.
 */

/** A wash of a palette colour, through its CSS variable so it follows the colour scheme (`theme/surfaces.ts`'s way). */
export const paletteWash = (colour: "primary" | "secondary", percent: number) => `color-mix(in srgb, var(--mui-palette-${colour}-main) ${percent}%, transparent)`;

/**
 * The card's surface: two pixels of border always, so choosing a card never moves its words; the primary border and a light
 * tint when its input is checked (the border and the input's own mark say it, never the colour alone); the keyboard's ring on the
 * whole card, not only the input. Put it on the element that contains the input.
 */
export const CHOICE_CARD_SX = {
  border: 2,
  borderColor: "divider",
  borderRadius: 2,
  transition: "border-color 120ms, background-color 120ms",
  // Only where a pointer hovers: on a phone `:hover` sticks after a tap, and an unticked tile would keep the ticked border.
  [HOVER_OK]: { "&:hover": { borderColor: "primary.main" } },
  "&:has(input:checked)": { borderColor: "primary.main", bgcolor: paletteWash("primary", 8) },
  "&:has(input:focus-visible)": { outline: "2px solid var(--mui-palette-primary-main)", outlineOffset: "2px" },
} as const;

/** The native input a card carries, painted in the primary colour (`accent-color`) at a size a thumb can aim at. */
export const CHOICE_INPUT_SX = { flex: "none", width: 22, height: 22, m: 0, accentColor: "var(--mui-palette-primary-main)", cursor: "pointer" } as const;
