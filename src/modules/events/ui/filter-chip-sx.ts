import { TAP_TARGET } from "@/shared/ui/tap-target";

/**
 * The listing's «Filtre» button and its boxes, drawn as small chips (§NNN, amending §413's 44-pixel
 * outlined button and 32-pixel pills — the owner, 2026-09-26: "Butonul de filtre e mult prea mare").
 *
 * The same split §133 made for the kind chips: the **tap area** is 44 pixels tall (BR-REQ-041-01
 * criterion 6, what the e2e suite measures), the **pill** inside it is MUI's small chip — 24 pixels,
 * the 0.8125rem word, a 16-pixel glyph — the same size as the active-filter chips (`ChipLink`) that
 * follow the button while it is closed, so the button no longer outweighs the row it heads.
 *
 * Plain objects in a module of their own so a unit test can hold the two numbers apart without
 * rendering a Server Component.
 */

/** A small chip's height, MUI's own `size="small"`. */
export const FILTER_CHIP_HEIGHT = 24;

/** The `<summary>`: a transparent 44-pixel target around the button's small pill (`> span`). */
export const FILTER_BUTTON_SX = {
  ...TAP_TARGET,
  display: "inline-flex",
  alignItems: "center",
  cursor: "pointer",
  listStyle: "none",
  userSelect: "none",
  outline: "none",
  "&::-webkit-details-marker": { display: "none" },
  "&::marker": { content: '""' },
  "& > span": {
    display: "inline-flex",
    alignItems: "center",
    gap: 0.5,
    height: FILTER_CHIP_HEIGHT,
    pl: 0.75,
    pr: 0.5,
    border: 1,
    borderColor: "divider",
    borderRadius: `${FILTER_CHIP_HEIGHT / 2}px`,
    fontSize: "0.8125rem",
    fontWeight: 600,
    lineHeight: 1,
  },
  "& > span > svg": { fontSize: 16 },
  "&:hover > span": { bgcolor: "action.hover" },
  "&:focus-visible > span": { outline: 2, outlineColor: "primary.main", outlineOffset: 2 },
} as const;

/** A box's `<label>`: a 44-pixel target around a small pill that fills in when its box is ticked. */
export const FILTER_OPTION_SX = {
  ...TAP_TARGET,
  display: "inline-flex",
  alignItems: "center",
  cursor: "pointer",
  "& > span": {
    display: "inline-flex",
    alignItems: "center",
    gap: 0.5,
    height: FILTER_CHIP_HEIGHT,
    pl: 0.625,
    pr: 1,
    border: 1,
    borderColor: "divider",
    borderRadius: `${FILTER_CHIP_HEIGHT / 2}px`,
    fontSize: "0.8125rem",
    lineHeight: 1,
  },
  "& > span > svg": { fontSize: 16 },
  "& input": { m: 0, width: 14, height: 14, accentColor: "currentColor", cursor: "pointer" },
  "&:hover > span": { bgcolor: "action.hover" },
  "&:has(input:checked) > span": { bgcolor: "primary.main", color: "primary.contrastText", borderColor: "primary.main" },
  "&:has(input:focus-visible) > span": { outline: 2, outlineColor: "primary.main", outlineOffset: 2 },
} as const;
