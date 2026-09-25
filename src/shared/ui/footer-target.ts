/**
 * The footer bar's tap targets (§372), the one place outside BR-REQ-041-01 criterion 6's 44
 * pixels, and only on a phone.
 *
 * The owner, 2026-09-24: the bar keeps every item but not every word. Eight items with their
 * words need about 370 pixels and a phone has 288 to 328, so on a phone the privacy notice is a
 * question mark (§NNN; a lock until 2026-09-25) and the languages are flags, and every item on
 * the bar is a smaller square: 24 pixels
 * below 360 (WCAG 2.2 SC 2.5.8, AA, is 24), 28 from 360, and the ordinary 44 from `sm` up.
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
 * The space between two neighbouring items on a phone's bar, in pixels (§NNN, the owner,
 * 2026-09-25: "the mobile footer icons can be a bit more spaced out"). §372 set none, to fit the
 * words; this is the largest gap at which the bar is still one row with every item at 320 pixels,
 * in both languages, fold closed and open — measured in headless Chromium on the built listing,
 * the numbers in `SiteFooter.tsx`. The same gap between the marks and between the two flags, so
 * the row reads as evenly spaced. From `sm` the bar keeps its own spacing, as before.
 */
export const FOOTER_GAP_PHONE = 6;

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
