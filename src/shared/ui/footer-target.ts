/**
 * The footer bar's tap targets (§372), the one place outside BR-REQ-041-01 criterion 6's 44
 * pixels, and only on a phone.
 *
 * The owner, 2026-09-24: the bar keeps every item but not every word. Eight items with their
 * words need about 370 pixels and a phone has 288 to 328, so on a phone the privacy notice is the
 * short word "GDPR" (§385; a lock, then a question mark, until 2026-09-25) and the languages are
 * flags, and every item on the bar is a smaller target — a square, but for the summary and the
 * word — 24 pixels below 360 (WCAG 2.2 SC 2.5.8, AA, is 24), 28 from 360, and the ordinary 44
 * from `sm` up.
 *
 * The 360-pixel step is not one of the theme's breakpoints — adding a key there would give every
 * responsive value on the site a new band to think about — so it is a media query of its own,
 * used only by the bar's items: the switch, the fold's summary, the privacy mark, the social marks
 * and the languages. It is a band, 360 up to `sm`, closed at both ends: MUI emits its own breakpoints'
 * media queries ahead of any other key in an `sx`, so an open-ended `min-width:360px` rule lands
 * after the `sm` one and wins from `sm` up (the unit test caught exactly that, 28px on a desktop).
 */
export const FOOTER_TARGET = { xs: 24, phoneWide: 28, sm: 44 } as const;

/**
 * The space between two neighbouring items on a phone's bar, in pixels, by the same two bands as
 * the targets: 4 below 360, 6 from 360 (§378, the owner, 2026-09-25: "the mobile footer icons can
 * be a bit more spaced out"; §385, the same day: "GDPR" instead of the question mark, and a rule
 * before the languages). §372 set none, to fit the words. §378 measured 6 as the largest whole gap
 * at which the row was one line at 320 pixels in both languages. The word is 13.6 pixels wider
 * than the glyph and the rule adds an item and a gap, so below 360 the gap is 4 — the largest at
 * which "About the club" is still whole at 320, and only with the summary's padding cut to 2
 * pixels a side — and from 360 it stays 6, with the same cut. Measured in headless
 * Chromium on the built listing, fold closed and open; the numbers are in `SiteFooter.tsx`. The
 * same gap between the marks, around the rule and between the two flags, so the row reads as
 * evenly spaced. From `sm` the bar keeps its own spacing, as before.
 */
export const FOOTER_GAP = { xs: 4, phoneWide: 6 } as const;

/**
 * The given properties set to the phone's gap (`FOOTER_GAP`): 4px, 6px from 360, and `smValue`
 * (an MUI spacing value, the bar's own spacing from `sm`) from 600. Pixel strings on a phone, so
 * the gap is exactly the measured one rather than a multiple of the theme's spacing unit.
 *
 * The `sm` value is a breakpoint object, not an `SM_UP` key: an `sx` with a breakpoint object
 * for another property (`display: { xs: "flex", sm: "none" }`, `ml: { sm: 1 }`) writes its own
 * `@media (min-width:600px)` entry, and a literal `SM_UP` key after it replaces that entry
 * rather than merging with it — the language box showed on a desktop in the first draft of
 * §385. MUI emits its breakpoint queries first, so the closed 360 band still comes after the
 * `xs` one and wins inside it (the unit test checks the order).
 */
export function footerGapSx(properties: readonly string[], smValue: number | string) {
  return {
    ...Object.fromEntries(properties.map((property) => [property, { xs: `${FOOTER_GAP.xs}px`, sm: smValue }])),
    [PHONE_WIDE]: Object.fromEntries(properties.map((property) => [property, `${FOOTER_GAP.phoneWide}px`])),
  };
}

/** The phone's second size (§372): 360px up to, not including, `sm` — MUI's own `down("sm")` bound. */
export const PHONE_WIDE = "@media (min-width:360px) and (max-width:599.95px)";

/** The theme's `sm` (600px), the same string MUI emits for `theme.breakpoints.up("sm")`. */
export const SM_UP = "@media (min-width:600px)";

/**
 * The given properties set to the bar's target at each width: 24px, then 28px from 360, then
 * 44px from `sm`. Pixel strings, not numbers — `lineHeight: 24` would be 24 times the font size.
 */
export function footerTargetSx(properties: readonly string[]) {
  const at = (pixels: number) => Object.fromEntries(properties.map((property) => [property, `${pixels}px`]));
  return {
    ...at(FOOTER_TARGET.xs),
    [PHONE_WIDE]: at(FOOTER_TARGET.phoneWide),
    [SM_UP]: at(FOOTER_TARGET.sm),
  };
}
