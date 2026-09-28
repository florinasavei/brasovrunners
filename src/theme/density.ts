/**
 * The public pages' phone density scale (§380, §480), in MUI spacing units (1 = 8px), used only
 * as the `xs` side: `{ xs: DENSITY.x, sm: <unchanged> }`. `tests/unit/theme/density.test.ts`
 * records every converted site.
 *
 * Deliberately not on the scale:
 * - `card-layout.ts`'s `LINE_GAP` and `GROUP_GAP`: every width, and §366's 44-px tap targets are
 *   measured against them.
 * - The listing card's horizontal padding and `EventFacts.tsx`'s row layout: the "when" row's
 *   width budget was measured against them (§366, §375).
 * - The error and not-found screens' `py: { xs: 4 }`, and all typography.
 */
export const DENSITY = {
  /** A page's `<Container>`, top and bottom, on every public page. Was 2. */
  pagePadY: 1.5,
  /** A listing card's top padding (`CARD_BODY_SX.pt`); vertical only. Was 2. */
  cardPadTop: 1.5,
  /** Between two cards in the listing's grid: 6px, the cards' borders marking the edge (§480). */
  cardGridGap: 0.75,
  /** The tightest step: between two lines of facts. 6px. */
  gapXs: 0.75,
  /** A short gap between one element and the next below it. 8px. */
  gapSm: 1,
  /** A section's separation from what precedes it; on an event page, the sections under the facts (§480). Was 3. */
  sectionGap: 2,
  /** A large section break — the past-events fold, the calendar's foot. Was 4. */
  sectionGapLg: 2.5,
} as const;
